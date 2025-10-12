import { useState, useRef, useCallback } from 'react';
import { useSafeAreas } from './useSafeAreas.js';

// Resize directions
export const RESIZE_DIRECTIONS = {
  N: 'n',    // North (top)
  S: 's',    // South (bottom)
  E: 'e',    // East (right)
  W: 'w',    // West (left)
  NW: 'nw',  // Northwest (top-left)
  NE: 'ne',  // Northeast (top-right)
  SW: 'sw',  // Southwest (bottom-left)
  SE: 'se'   // Southeast (bottom-right)
};

// Minimum window dimensions
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;

export const useResize = ({
  initialSize = { width: 800, height: 600 },
  initialPosition = { x: 100, y: 100 },
  onResizeStart,
  onResizeEnd,
  onSizeChange,
  disabled = false
}) => {
  const [size, setSize] = useState(initialSize);
  const [position, setPosition] = useState(initialPosition);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState(null);

  // Refs for resize state
  const resizeStateRef = useRef({
    isResizing: false,
    direction: null,
    startSize: initialSize,
    startPosition: initialPosition,
    startMousePos: { x: 0, y: 0 },
    constraints: { minX: 0, maxX: 800, minY: 0, maxY: 600 }
  });

  const { getBounds } = useSafeAreas();

  // RAF callback ref
  const rafRef = useRef(null);

  // Update constraints when safe areas change
  const constraints = getBounds();

  // Calculate new size and position based on resize direction
  const calculateResize = useCallback((mousePos, direction, currentSize, currentPosition) => {
    const deltaX = mousePos.x - resizeStateRef.current.startMousePos.x;
    const deltaY = mousePos.y - resizeStateRef.current.startMousePos.y;

    let newWidth = currentSize.width;
    let newHeight = currentSize.height;
    let newX = currentPosition.x;
    let newY = currentPosition.y;

    // Handle different resize directions
    switch (direction) {
      case RESIZE_DIRECTIONS.E:
        newWidth = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width + deltaX);
        break;
      case RESIZE_DIRECTIONS.W:
        const newWidthW = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width - deltaX);
        newX = resizeStateRef.current.startPosition.x + (resizeStateRef.current.startSize.width - newWidthW);
        newWidth = newWidthW;
        break;
      case RESIZE_DIRECTIONS.S:
        newHeight = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height + deltaY);
        break;
      case RESIZE_DIRECTIONS.N:
        const newHeightN = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height - deltaY);
        newY = resizeStateRef.current.startPosition.y + (resizeStateRef.current.startSize.height - newHeightN);
        newHeight = newHeightN;
        break;
      case RESIZE_DIRECTIONS.SE:
        newWidth = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width + deltaX);
        newHeight = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height + deltaY);
        break;
      case RESIZE_DIRECTIONS.SW:
        const newWidthSW = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width - deltaX);
        newX = resizeStateRef.current.startPosition.x + (resizeStateRef.current.startSize.width - newWidthSW);
        newWidth = newWidthSW;
        newHeight = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height + deltaY);
        break;
      case RESIZE_DIRECTIONS.NE:
        newWidth = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width + deltaX);
        const newHeightNE = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height - deltaY);
        newY = resizeStateRef.current.startPosition.y + (resizeStateRef.current.startSize.height - newHeightNE);
        newHeight = newHeightNE;
        break;
      case RESIZE_DIRECTIONS.NW:
        const newWidthNW = Math.max(MIN_WIDTH, resizeStateRef.current.startSize.width - deltaX);
        const newHeightNW = Math.max(MIN_HEIGHT, resizeStateRef.current.startSize.height - deltaY);
        newX = resizeStateRef.current.startPosition.x + (resizeStateRef.current.startSize.width - newWidthNW);
        newY = resizeStateRef.current.startPosition.y + (resizeStateRef.current.startSize.height - newHeightNW);
        newWidth = newWidthNW;
        newHeight = newHeightNW;
        break;
    }

    // Apply constraints
    const maxX = window.innerWidth - constraints.right - newWidth;
    const maxY = window.innerHeight - constraints.bottom - newHeight;

    newX = Math.max(constraints.minX, Math.min(maxX, newX));
    newY = Math.max(constraints.minY, Math.min(maxY, newY));

    return {
      size: { width: newWidth, height: newHeight },
      position: { x: newX, y: newY }
    };
  }, [constraints]);

  // Schedule resize update with RAF
  const scheduleResizeUpdate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const mousePos = { x: resizeStateRef.current.currentMousePos.x, y: resizeStateRef.current.currentMousePos.y };
      const result = calculateResize(mousePos, resizeStateRef.current.direction, size, position);

      setSize(result.size);
      setPosition(result.position);
      onSizeChange?.(result.size, result.position);

      rafRef.current = null;
    });
  }, [calculateResize, size, position, onSizeChange]);

  // Pointer event handlers
  const handlePointerDown = useCallback((e, direction) => {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();

    // Only allow resizing from left mouse button or touch
    if (e.button !== 0 && e.pointerType !== 'touch') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const mousePos = { x: e.clientX, y: e.clientY };

    resizeStateRef.current = {
      isResizing: true,
      direction,
      startSize: { ...size },
      startPosition: { ...position },
      startMousePos: mousePos,
      currentMousePos: mousePos
    };

    setIsResizing(true);
    setResizeDirection(direction);
    onResizeStart?.(direction);

    // Add global event listeners
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    // Prevent text selection during resize
    document.body.style.userSelect = 'none';
    document.body.style.cursor = getResizeCursor(direction);

    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [disabled, size, position, onResizeStart]);

  const handlePointerMove = useCallback((e) => {
    if (!resizeStateRef.current.isResizing) return;

    e.preventDefault();
    resizeStateRef.current.currentMousePos = { x: e.clientX, y: e.clientY };
    scheduleResizeUpdate();
  }, [scheduleResizeUpdate]);

  const handlePointerUp = useCallback((e) => {
    if (!resizeStateRef.current.isResizing) return;

    e.preventDefault();

    // Get the final resize values (either from pending RAF or current state)
    const finalMousePos = { x: e.clientX, y: e.clientY };
    const finalResult = calculateResize(finalMousePos, resizeStateRef.current.direction, size, position);

    // Update hook state with final values
    setSize(finalResult.size);
    setPosition(finalResult.position);

    // Clean up event listeners
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerUp);

    // Restore text selection and cursor
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    setIsResizing(false);
    setResizeDirection(null);

    // Call onResizeEnd with the FINAL calculated values, not hook state
    onResizeEnd?.(finalResult.size, finalResult.position);

    // Cancel any pending RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Release pointer capture if element still exists
    try {
      e.target.releasePointerCapture?.(e.pointerId);
    } catch (error) {
      // Ignore errors if element is no longer available
    }
  }, [size, position, onResizeEnd]);

  // Generate resize handlers for each direction
  const resizeHandlers = Object.values(RESIZE_DIRECTIONS).reduce((handlers, direction) => {
    handlers[direction] = {
      onPointerDown: (e) => handlePointerDown(e, direction),
      style: {
        cursor: getResizeCursor(direction),
        touchAction: 'none'
      }
    };
    return handlers;
  }, {});

  return {
    size,
    position,
    isResizing,
    resizeDirection,
    resizeHandlers,
    setSize: (newSize) => setSize(newSize),
    setPosition: (newPosition) => setPosition(newPosition)
  };
};

// Helper function to get appropriate cursor for resize direction
function getResizeCursor(direction) {
  switch (direction) {
    case RESIZE_DIRECTIONS.N:
    case RESIZE_DIRECTIONS.S:
      return 'ns-resize';
    case RESIZE_DIRECTIONS.E:
    case RESIZE_DIRECTIONS.W:
      return 'ew-resize';
    case RESIZE_DIRECTIONS.NE:
    case RESIZE_DIRECTIONS.SW:
      return 'nesw-resize';
    case RESIZE_DIRECTIONS.NW:
    case RESIZE_DIRECTIONS.SE:
      return 'nwse-resize';
    default:
      return 'default';
  }
}
