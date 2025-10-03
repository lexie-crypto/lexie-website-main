import { useState, useRef, useCallback, useEffect } from 'react';

// Utility to get viewport constraints with safe margins
const getViewportConstraints = (margin = 20) => {
  if (typeof window === 'undefined') {
    return { minX: 0, maxX: 800, minY: 0, maxY: 600 };
  }

  return {
    minX: margin,
    maxX: window.innerWidth - margin,
    minY: margin,
    maxY: window.innerHeight - margin - 40 // Account for taskbar height
  };
};

// Utility to clamp position within constraints
const clampPosition = (position, constraints, windowSize = { width: 0, height: 0 }) => {
  const clampedX = Math.max(constraints.minX, Math.min(constraints.maxX - windowSize.width, position.x));
  const clampedY = Math.max(constraints.minY, Math.min(constraints.maxY - windowSize.height, position.y));

  return { x: clampedX, y: clampedY };
};

export const useDraggable = ({
  initialPosition = { x: 100, y: 100 },
  bounds, // Can be: object {top, right, bottom, left} or function () => bounds
  windowSize = { width: 800, height: 600 },
  onDragStart,
  onDragEnd,
  onPositionChange,
  disabled = false
}) => {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);

  // Refs for drag state
  const dragStateRef = useRef({
    isDragging: false,
    startPosition: { x: 0, y: 0 },
    currentPosition: initialPosition,
    dragOffset: { x: 0, y: 0 }
  });

  // RAF callback ref
  const rafRef = useRef(null);

  // Get current bounds (supports both static objects and functions)
  const getCurrentBounds = useCallback(() => {
    if (typeof bounds === 'function') {
      return bounds();
    }
    if (bounds && typeof bounds === 'object') {
      return bounds;
    }
    // Fallback to default viewport constraints
    return getViewportConstraints();
  }, [bounds]);

  // Convert bounds to constraint format for backward compatibility
  const getCurrentConstraints = useCallback(() => {
    const currentBounds = getCurrentBounds();
    return {
      minX: currentBounds.left || 0,
      maxX: currentBounds.right || window.innerWidth,
      minY: currentBounds.top || 0,
      maxY: currentBounds.bottom || window.innerHeight
    };
  }, [getCurrentBounds]);

  // Re-clamp position when bounds change (but not during drag)
  useEffect(() => {
    if (!isDragging) {
      const constraints = getCurrentConstraints();
      setPosition(prevPos =>
        clampPosition(prevPos, constraints, windowSize)
      );
    }
  }, [bounds, windowSize, isDragging, getCurrentConstraints]);

  // Update position when initialPosition changes externally
  useEffect(() => {
    if (!isDragging) {
      setPosition(initialPosition);
      dragStateRef.current.currentPosition = initialPosition;
    }
  }, [initialPosition, isDragging]);

  // RAF-based position update
  const updatePosition = useCallback(() => {
    if (!dragStateRef.current.isDragging) return;

    const newPosition = clampPosition(
      dragStateRef.current.currentPosition,
      dragStateRef.current.constraints,
      windowSize
    );

    setPosition(newPosition);
    onPositionChange?.(newPosition);

    rafRef.current = null;
  }, [windowSize, onPositionChange]);

  // Schedule position update with RAF
  const schedulePositionUpdate = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(updatePosition);
  }, [updatePosition]);

  // Pointer event handlers
  const handlePointerDown = useCallback((e) => {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();

    // Only allow dragging from left mouse button or touch
    if (e.button !== 0 && e.pointerType !== 'touch') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    dragStateRef.current = {
      ...dragStateRef.current,
      isDragging: true,
      startPosition: { x: e.clientX, y: e.clientY },
      dragOffset,
      currentPosition: position
    };

    setIsDragging(true);
    onDragStart?.(position);

    // Add global event listeners
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    e.currentTarget.style.cursor = 'grabbing';
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [disabled, position, onDragStart]);

  const handlePointerMove = useCallback((e) => {
    if (!dragStateRef.current.isDragging) return;

    e.preventDefault();

    const deltaX = e.clientX - dragStateRef.current.startPosition.x;
    const deltaY = e.clientY - dragStateRef.current.startPosition.y;

    dragStateRef.current.currentPosition = {
      x: dragStateRef.current.startPosition.x + deltaX - dragStateRef.current.dragOffset.x,
      y: dragStateRef.current.startPosition.y + deltaY - dragStateRef.current.dragOffset.y
    };

    schedulePositionUpdate();
  }, [schedulePositionUpdate]);

  const handlePointerUp = useCallback((e) => {
    if (!dragStateRef.current.isDragging) return;

    e.preventDefault();

    // Clean up event listeners
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerUp);

    // Restore text selection and cursor
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    const finalPosition = clampPosition(
      dragStateRef.current.currentPosition,
      getCurrentConstraints(),
      windowSize
    );

    setPosition(finalPosition);
    setIsDragging(false);

    dragStateRef.current.isDragging = false;

    onDragEnd?.(finalPosition);

    // Cancel any pending RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Release pointer capture if element still exists
    try {
      e.target.releasePointerCapture(e.pointerId);
      e.target.style.cursor = '';
    } catch (error) {
      // Ignore errors if element is no longer available
    }
  }, [windowSize, onDragEnd]);

  // Drag handlers for the draggable element
  const dragHandlers = {
    onPointerDown: handlePointerDown,
    style: {
      cursor: isDragging ? 'grabbing' : 'grab',
      touchAction: 'none' // Prevent scrolling on touch devices
    }
  };

  return {
    position,
    isDragging,
    dragHandlers,
    setPosition: (newPosition) => {
      const constraints = getCurrentConstraints();
      const clampedPosition = clampPosition(newPosition, constraints, windowSize);
      setPosition(clampedPosition);
      dragStateRef.current.currentPosition = clampedPosition;
      onPositionChange?.(clampedPosition);
    }
  };
};
