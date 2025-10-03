import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to detect header/taskbar heights and compute safe margins for window positioning
 * Ensures windows never appear under fixed UI elements
 */
export const useSafeAreas = () => {
  const [safeAreas, setSafeAreas] = useState({
    topSafe: 80,    // Default header height + gap
    bottomSafe: 60, // Default taskbar height + gap
    leftSafe: 8,
    rightSafe: 8
  });

  const [headerHeight, setHeaderHeight] = useState(72); // Default navbar height
  const [taskbarHeight, setTaskbarHeight] = useState(48); // Default taskbar height

  // Get computed CSS variable values (for mobile safe areas)
  const getCSSValue = useCallback((property) => {
    if (typeof window === 'undefined') return 0;

    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(property)
      .trim();

    // Handle CSS values like 'env(safe-area-inset-top)' or '20px'
    if (value.includes('px')) {
      return parseInt(value.replace('px', ''), 10) || 0;
    }

    // Handle numeric values
    const numValue = parseInt(value, 10);
    return isNaN(numValue) ? 0 : numValue;
  }, []);

  // Detect header height
  const detectHeaderHeight = useCallback(() => {
    if (typeof window === 'undefined') return 72;

    // Try common header selectors
    const headerSelectors = [
      '#site-header',
      '[data-testid="site-header"]',
      'nav[role="navigation"]',
      'header',
      '.navbar',
      '.site-header'
    ];

    let headerElement = null;
    for (const selector of headerSelectors) {
      headerElement = document.querySelector(selector);
      if (headerElement) break;
    }

    if (headerElement) {
      const rect = headerElement.getBoundingClientRect();
      return Math.ceil(rect.height);
    }

    // Fallback: assume standard header height
    return 72;
  }, []);

  // Detect taskbar height
  const detectTaskbarHeight = useCallback(() => {
    if (typeof window === 'undefined') return 48;

    // Try to find taskbar by class or data attribute
    const taskbarSelectors = [
      '.taskbar',
      '[data-testid="taskbar"]',
      '[role="toolbar"].fixed.bottom-0',
      '.dock'
    ];

    let taskbarElement = null;
    for (const selector of taskbarSelectors) {
      taskbarElement = document.querySelector(selector);
      if (taskbarElement) break;
    }

    if (taskbarElement) {
      const rect = taskbarElement.getBoundingClientRect();
      return Math.ceil(rect.height);
    }

    // Check for CSS custom property
    const cssTaskbarHeight = getCSSValue('--taskbar-height');
    if (cssTaskbarHeight > 0) return cssTaskbarHeight;

    // Fallback: assume standard taskbar height
    return 48;
  }, [getCSSValue]);

  // Update safe areas
  const updateSafeAreas = useCallback(() => {
    const newHeaderHeight = detectHeaderHeight();
    const newTaskbarHeight = detectTaskbarHeight();

    // Get mobile safe area insets
    const topInset = getCSSValue('safe-area-inset-top') || 0;
    const bottomInset = getCSSValue('safe-area-inset-bottom') || 0;
    const leftInset = getCSSValue('safe-area-inset-left') || 0;
    const rightInset = getCSSValue('safe-area-inset-right') || 0;

    const safeGap = 12; // Gap between UI elements and windows

    setHeaderHeight(newHeaderHeight);
    setTaskbarHeight(newTaskbarHeight);

    setSafeAreas({
      topSafe: newHeaderHeight + safeGap + topInset,
      bottomSafe: newTaskbarHeight + safeGap + bottomInset,
      leftSafe: 8 + leftInset,
      rightSafe: 8 + rightInset
    });
  }, [detectHeaderHeight, detectTaskbarHeight, getCSSValue]);

  // Initial detection and setup
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initial detection
    updateSafeAreas();

    // Set up ResizeObserver for header
    const headerSelectors = [
      '#site-header',
      '[data-testid="site-header"]',
      'nav[role="navigation"]',
      'header',
      '.navbar',
      '.site-header'
    ];

    let headerObserver = null;
    let headerElement = null;

    for (const selector of headerSelectors) {
      headerElement = document.querySelector(selector);
      if (headerElement) break;
    }

    if (headerElement && window.ResizeObserver) {
      headerObserver = new ResizeObserver(() => {
        updateSafeAreas();
      });
      headerObserver.observe(headerElement);
    }

    // Set up ResizeObserver for taskbar
    const taskbarSelectors = [
      '.taskbar',
      '[data-testid="taskbar"]',
      '[role="toolbar"].fixed.bottom-0',
      '.dock'
    ];

    let taskbarObserver = null;
    let taskbarElement = null;

    for (const selector of taskbarSelectors) {
      taskbarElement = document.querySelector(selector);
      if (taskbarElement) break;
    }

    if (taskbarElement && window.ResizeObserver) {
      taskbarObserver = new ResizeObserver(() => {
        updateSafeAreas();
      });
      taskbarObserver.observe(taskbarElement);
    }

    // Listen for orientation changes (mobile)
    const handleOrientationChange = () => {
      // Delay to allow for orientation change to complete
      setTimeout(updateSafeAreas, 100);
    };

    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', updateSafeAreas);

    // Cleanup
    return () => {
      if (headerObserver) headerObserver.disconnect();
      if (taskbarObserver) taskbarObserver.disconnect();
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', updateSafeAreas);
    };
  }, [updateSafeAreas]);

  return {
    ...safeAreas,
    headerHeight,
    taskbarHeight,
    // Computed bounds for useDraggable
    getBounds: () => ({
      top: safeAreas.topSafe,
      right: window.innerWidth - safeAreas.rightSafe,
      bottom: window.innerHeight - safeAreas.bottomSafe,
      left: safeAreas.leftSafe
    }),
    // Utility to clamp position within bounds
    clampPosition: (position, windowSize = { width: 800, height: 600 }) => {
      const bounds = {
        minX: safeAreas.leftSafe,
        maxX: window.innerWidth - safeAreas.rightSafe - windowSize.width,
        minY: safeAreas.topSafe,
        maxY: window.innerHeight - safeAreas.bottomSafe - windowSize.height
      };

      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, position.x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, position.y))
      };
    }
  };
};
