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
  constraints: customConstraints,
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
    dragOffset: { x: 0, y: 0 },
    constraints: getViewportConstraints()
  });

  // RAF callback ref
  const rafRef = useRef(null);

  // Update constraints on resize
  useEffect(() => {
    const handleResize = () => {
      const newConstraints = customConstraints || getViewportConstraints();
      dragStateRef.current.constraints = newConstraints;

      // Re-clamp current position if needed
      if (!dragStateRef.current.isDragging) {
        setPosition(prevPos =>
          clampPosition(prevPos, newConstraints, windowSize)
        );
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [customConstraints, windowSize]);

  // Initialize constraints
  useEffect(() => {
    dragStateRef.current.constraints = customConstraints || getViewportConstraints();
  }, [customConstraints]);

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
      dragStateRef.current.constraints,
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
      const clampedPosition = clampPosition(newPosition, dragStateRef.current.constraints, windowSize);
      setPosition(clampedPosition);
      dragStateRef.current.currentPosition = clampedPosition;
      onPositionChange?.(clampedPosition);
    }
  };
};
