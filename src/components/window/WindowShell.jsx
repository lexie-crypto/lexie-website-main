import React, { useEffect, useRef, useState } from 'react';
import TerminalWindow from '../ui/TerminalWindow.jsx';
import { useDraggable } from '../../hooks/useDraggable.js';
import { useSafeAreas } from '../../hooks/useSafeAreas.js';
import { useWindowStore } from '../../contexts/windowStore.jsx';

const TrafficLight = ({ type, onClick, disabled = false, isDragging = false }) => {
  const colors = {
    close: 'bg-red-500 hover:bg-red-400',
    minimize: 'bg-yellow-500 hover:bg-yellow-400',
    maximize: 'bg-green-500 hover:bg-green-400'
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (!disabled && onClick) onClick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isDragging}
      className={`
        w-3 h-3 rounded-full transition-colors duration-150
        ${colors[type]}
        ${disabled || isDragging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-110'}
        focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50
      `}
      aria-label={`${type} window`}
    />
  );
};

const WindowShell = ({
  id,
  title,
  icon,
  appType = 'default',
  children,
  statusLabel,
  statusTone,
  footerLeft,
  footerRight,
  variant,
  className = '',
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 800, height: 600 },
  minWidth = 400,
  minHeight = 300,
  maxWidth = 1200,
  maxHeight = 800,
  ...terminalProps
}) => {
  const {
    getWindowState,
    registerWindow,
    minimizeWindow,
    closeWindow,
    bringToFront,
    updatePosition,
    toggleMaximize,
    updateFocus
  } = useWindowStore();

  // Safe areas for positioning
  const { getBounds, clampPosition, top: topSafe, bottom: bottomSafe, left: leftSafe, right: rightSafe } = useSafeAreas();

  // Memoize default values to prevent re-registration
  const defaultPosition = React.useMemo(() => ({ x: 200, y: 100 }), []);
  const defaultSize = React.useMemo(() => ({ width: 900, height: 700 }), []);

  // Use defaults if props are not provided
  const stableInitialPosition = initialPosition ?? defaultPosition;
  const stableInitialSize = initialSize ?? defaultSize;

  const windowState = getWindowState(id);
  const windowRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);

  // Get current window dimensions for drag constraints
  const getCurrentSize = () => {
    if (!windowRef.current) return stableInitialSize;
    const rect = windowRef.current.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };

  // Draggable hook
  const { position, isDragging, dragHandlers, setPosition } = useDraggable({
    initialPosition: windowState?.position || stableInitialPosition,
    windowSize: getCurrentSize(),
    onDragStart: () => {
      bringToFront(id);
    },
    onDragEnd: (finalPosition) => {
      updatePosition(id, finalPosition);
    },
    onPositionChange: (newPosition) => {
      // Throttled position updates during drag
      updatePosition(id, newPosition);
    }
  });

  // Register window on mount (only once)
  useEffect(() => {
    // Guard against duplicate registration
    if (!getWindowState(id)) {
      registerWindow(id, {
        title,
        icon,
        appType,
        position: stableInitialPosition,
        size: stableInitialSize
      });
    }
  }, [id, title, icon, appType, stableInitialPosition, stableInitialSize, registerWindow, getWindowState]);

  // Handle initial positioning
  useEffect(() => {
    if (!windowState) return;

    // For first-time open, center horizontally and place below header
    if (!windowState.lastRestoredPosition) {
      const currentSize = getCurrentSize();
      const centerX = Math.max(leftSafe, (window.innerWidth - currentSize.width) / 2);
      const safeY = topSafe + 24; // 24px below header

      const centeredPosition = {
        x: Math.min(centerX, window.innerWidth - rightSafe - currentSize.width),
        y: Math.min(safeY, window.innerHeight - bottomSafe - currentSize.height)
      };

      setPosition(centeredPosition);
      updatePosition(id, centeredPosition);
    }
  }, [windowState, setPosition, updatePosition, id, topSafe, bottomSafe, leftSafe, rightSafe, getCurrentSize]);

  // Handle viewport changes - clamp position if window becomes invalid
  useEffect(() => {
    if (!windowState || isDragging) return;

    const currentSize = getCurrentSize();
    const clampedPosition = clampPosition(windowState.position, currentSize);

    // Only adjust if position is significantly out of bounds
    const tolerance = 10; // Allow some tolerance for smooth UX
    if (Math.abs(clampedPosition.x - windowState.position.x) > tolerance ||
        Math.abs(clampedPosition.y - windowState.position.y) > tolerance) {
      setPosition(clampedPosition);
      updatePosition(id, clampedPosition);
    }
  }, [windowState, isDragging, clampPosition, setPosition, updatePosition, id]);

  // Handle window focus
  const handleWindowClick = () => {
    bringToFront(id);
    updateFocus(id);
  };

  // Traffic light handlers
  const handleClose = () => {
    closeWindow(id);
  };

  const handleMinimize = () => {
    minimizeWindow(id);
  };

  const handleMaximize = () => {
    // Maximize should respect safe areas
    const maximizedSize = {
      width: window.innerWidth - leftSafe - rightSafe,
      height: window.innerHeight - topSafe - bottomSafe
    };
    toggleMaximize(id, maximizedSize);
  };

  // Don't render if window is closed or minimized
  if (windowState?.isClosed || windowState?.isMinimized) {
    return null;
  }

  const currentSize = getCurrentSize();
  const isMaximized = windowState?.isMaximized || false;
  const zIndex = windowState?.zIndex || 1000;
  const isFocused = windowState?.isFocused || false;

  return (
    <div
      ref={windowRef}
      className={`
        fixed transition-shadow duration-200
        ${isDragging ? '' : 'transition-all duration-300 ease-out'}
        ${isFocused ? 'shadow-2xl shadow-purple-500/20' : 'shadow-lg'}
        ${isDragging ? 'shadow-3xl shadow-blue-500/30' : ''}
        ${className}
      `}
      style={{
        left: isMaximized ? leftSafe : position.x,
        top: isMaximized ? topSafe : position.y,
        width: isMaximized ? `calc(100vw - ${leftSafe + rightSafe}px)` : currentSize.width,
        height: isMaximized ? `calc(100vh - ${topSafe + bottomSafe}px)` : currentSize.height,
        zIndex,
        transform: 'translateZ(0)', // Force hardware acceleration
      }}
      onClick={handleWindowClick}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`window-title-${id}`}
      aria-describedby={`window-content-${id}`}
    >
      {/* Custom Header with Traffic Lights */}
      <div
        className={`
          flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800
          ${isMaximized ? 'cursor-default' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}
          select-none
        `}
        {...(isMaximized ? {} : dragHandlers)}
        role="banner"
        aria-grabbed={isDragging}
      >
        {/* Traffic Lights */}
        <div className="flex items-center gap-2">
          <TrafficLight
            type="close"
            onClick={handleClose}
            isDragging={isDragging}
          />
          <TrafficLight
            type="minimize"
            onClick={handleMinimize}
            isDragging={isDragging}
          />
          <TrafficLight
            type="maximize"
            onClick={handleMaximize}
            isDragging={isDragging}
          />
          <span
            id={`window-title-${id}`}
            className="ml-4 font-mono text-sm text-gray-400 select-none"
          >
            {title}
          </span>
        </div>

        {/* Status Section */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full animate-pulse ${statusTone === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`} />
          <span className={`font-mono text-xs ${statusTone === 'online' ? 'text-green-400' : 'text-yellow-300'}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Window Content */}
      <div
        id={`window-content-${id}`}
        className="relative bg-black overflow-hidden"
        style={{
          height: isMaximized ? 'calc(100vh - 52px)' : `calc(${currentSize.height}px - 52px)`
        }}
      >
        <div className="px-8 pt-4 pb-6 h-full overflow-auto">
          {children}
        </div>

        {/* Background overlay */}
        {variant === 'connect' ? (
          <div className="absolute inset-0 bg-gradient-to-b from-blue-600/15 via-blue-600/10 to-blue-700/8 blur-sm pointer-events-none"></div>
        ) : (
          <div className="absolute inset-0 bg-blue-900/15 pointer-events-none"></div>
        )}
      </div>

      {/* Footer */}
      {(footerLeft || footerRight) && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800 font-mono text-xs">
          <div className="truncate text-gray-400">{footerLeft}</div>
          <div className={`truncate ${statusTone === 'online' ? 'text-green-400' : 'text-yellow-300'}`}>
            {footerRight}
          </div>
        </div>
      )}
    </div>
  );
};

export default WindowShell;
