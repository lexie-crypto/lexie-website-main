import { useState, useEffect, useCallback, useRef } from 'react';

// Hook to measure safe areas for window positioning
export const useSafeAreas = () => {
  const [safeAreas, setSafeAreas] = useState({
    top: 0,      // Navbar height
    bottom: 0,   // Taskbar height (responsive)
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

      // Measure taskbar height (our custom taskbar) - responsive to screen size
      const taskbar = document.querySelector('[role="toolbar"]');
      let bottomSafe = taskbar ? taskbar.offsetHeight : 0; // default to 0 for smaller screens

      // On larger screens (>1024px), ensure minimum taskbar space
      if (window.innerWidth > 1024 && !taskbar) {
        bottomSafe = 40; // fallback for larger screens
      }

      // For mobile/smaller screens, reduce safe areas
      if (window.innerWidth <= 768) {
        bottomSafe = Math.min(bottomSafe, 32); // cap at 32px on mobile
      }

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

  // Get responsive window sizes based on screen dimensions
  const getResponsiveWindowSize = useCallback((preferredSize = { width: 800, height: 600 }) => {
    if (typeof window === 'undefined') return preferredSize;

    const availableWidth = window.innerWidth - safeAreas.left - safeAreas.right;
    const availableHeight = window.innerHeight - safeAreas.top - safeAreas.bottom;

    // Calculate responsive sizes based on screen breakpoints
    let responsiveWidth, responsiveHeight;

    if (window.innerWidth <= 640) { // Mobile
      responsiveWidth = Math.min(availableWidth * 0.95, preferredSize.width * 0.7);
      responsiveHeight = Math.min(availableHeight * 0.8, preferredSize.height * 0.7);
    } else if (window.innerWidth <= 1024) { // Tablet/Small laptop
      responsiveWidth = Math.min(availableWidth * 0.9, preferredSize.width * 0.85);
      responsiveHeight = Math.min(availableHeight * 0.85, preferredSize.height * 0.85);
    } else { // Desktop
      responsiveWidth = Math.min(availableWidth * 0.8, preferredSize.width);
      responsiveHeight = Math.min(availableHeight * 0.8, preferredSize.height);
    }

    // Ensure minimum sizes
    const minWidth = window.innerWidth <= 640 ? 300 : 400;
    const minHeight = window.innerWidth <= 640 ? 250 : 300;

    return {
      width: Math.max(minWidth, responsiveWidth),
      height: Math.max(minHeight, responsiveHeight)
    };
  }, [safeAreas]);

  // Get responsive minimum window sizes
  const getResponsiveMinSize = useCallback(() => {
    if (typeof window === 'undefined') return { width: 400, height: 300 };

    if (window.innerWidth <= 640) { // Mobile
      return { width: 300, height: 250 };
    } else if (window.innerWidth <= 1024) { // Tablet/Small laptop
      return { width: 350, height: 280 };
    } else { // Desktop
      return { width: 400, height: 300 };
    }
  }, []);

  return {
    ...safeAreas,
    getBounds,
    clampPosition,
    getResponsiveWindowSize,
    getResponsiveMinSize,
    measureSafeAreas
  };
};
