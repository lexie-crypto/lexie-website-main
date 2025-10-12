import { useState, useEffect, useCallback, useRef } from 'react';

// Hook to measure safe areas for window positioning
export const useSafeAreas = () => {
  const [safeAreas, setSafeAreas] = useState({
    top: 0,      // Navbar height
    bottom: 40,  // Taskbar height
    left: 0,
    right: 0
  });

  // Use ref to store timeout ID for throttling
  const timeoutRef = useRef(null);

  const measureSafeAreas = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Throttle measurements to prevent excessive updates
    timeoutRef.current = setTimeout(() => {
      // Measure navbar height
      const navbar = document.querySelector('nav, [role="navigation"]');
      const topSafe = navbar ? navbar.offsetHeight : 0;

      // Measure taskbar height (our custom taskbar)
      const taskbar = document.querySelector('[role="toolbar"]');
      const bottomSafe = taskbar ? taskbar.offsetHeight : 40; // fallback to 40px

      // For mobile, add safe areas for notches, etc.
      const leftSafe = window.visualViewport?.offsetLeft || 0;
      const rightSafe = (window.innerWidth - (window.visualViewport?.width || window.innerWidth) - leftSafe);

      // Only update if values actually changed to prevent unnecessary re-renders
      setSafeAreas(prevSafeAreas => {
        if (
          prevSafeAreas.top === topSafe &&
          prevSafeAreas.bottom === bottomSafe &&
          prevSafeAreas.left === leftSafe &&
          prevSafeAreas.right === rightSafe
        ) {
          return prevSafeAreas;
        }

        return {
          top: topSafe,
          bottom: bottomSafe,
          left: leftSafe,
          right: rightSafe
        };
      });
    }, 100); // 100ms throttle
  }, []);

  // Measure on mount and when window resizes
  useEffect(() => {
    // Initial measurement
    measureSafeAreas();

    // Use ResizeObserver for navbar/taskbar changes (throttled)
    const resizeObserver = new ResizeObserver(() => {
      measureSafeAreas();
    });

    // Observe navbar
    const navbar = document.querySelector('nav, [role="navigation"]');
    if (navbar) {
      resizeObserver.observe(navbar);
    }

    // Observe taskbar
    const taskbar = document.querySelector('[role="toolbar"]');
    if (taskbar) {
      resizeObserver.observe(taskbar);
    }

    // Fallback: listen for window resize
    window.addEventListener('resize', measureSafeAreas);

    // Listen for custom events that might indicate layout changes
    window.addEventListener('layout-change', measureSafeAreas);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', measureSafeAreas);
      window.removeEventListener('layout-change', measureSafeAreas);
    };
  }, [measureSafeAreas]);

  // Get bounds for draggable windows
  const getBounds = useCallback((margin = 5) => {
    if (typeof window === 'undefined') {
      return { minX: 0, maxX: 800, minY: 0, maxY: 600 };
    }

    return {
      minX: safeAreas.left + margin,
      maxX: window.innerWidth - safeAreas.right - margin,
      minY: safeAreas.top, // No extra margin - allow positioning right at navbar
      maxY: window.innerHeight - safeAreas.bottom - margin
    };
  }, [safeAreas]);

  // Clamp position within safe bounds
  const clampPosition = useCallback((position, windowSize = { width: 0, height: 0 }) => {
    const bounds = getBounds();

    const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX - windowSize.width, position.x));
    const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY - windowSize.height, position.y));

    return { x: clampedX, y: clampedY };
  }, [getBounds]);

  return {
    ...safeAreas,
    getBounds,
    clampPosition,
    measureSafeAreas
  };
};
