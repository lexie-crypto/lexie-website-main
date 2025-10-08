import React, { useEffect, useRef, useState } from 'react';
import TerminalWindow from '../ui/TerminalWindow.jsx';
import { useDraggable } from '../../hooks/useDraggable.js';
import { useSafeAreas } from '../../hooks/useSafeAreas.js';
import { useResize, RESIZE_DIRECTIONS } from '../../hooks/useResize.js';
import { useWindowStore } from '../../contexts/windowStore.jsx';
import { useChatStore } from '../../lib/store';
import { toast } from 'react-hot-toast';

const DegenModeButton = () => {
  const { personalityMode, setPersonalityMode } = useChatStore();
  const [isSending, setIsSending] = useState(false);

  const handleClick = async () => {
    const newMode = personalityMode === 'degen' ? 'normal' : 'degen';
    setPersonalityMode(newMode);

    // If enabling degen mode, send confirmation message to chat
    if (newMode === 'degen') {
      setIsSending(true);
      try {
        // Import ChatService and send confirmation message
        const { ChatService } = await import('../../lib/api');
        await ChatService.sendMessage(
          'Hey Lexie! I just enabled degen mode. Can you acknowledge this with your full degen personality?',
          { personalityMode: 'degen' }
        );
      } catch (error) {
        console.error('Error sending degen mode confirmation:', error);
        // Show user feedback on error
        toast.custom((t) => (
          <div className="font-mono pointer-events-auto">
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Failed to activate degen mode</div>
                  <div className="text-xs text-red-400/80">Try again or check your connection</div>
                </div>
              </div>
            </div>
          </div>
        ), { duration: 3000 });
      } finally {
        setIsSending(false);
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isSending}
      className={`px-3 py-1.5 rounded border text-xs ${
        personalityMode === 'degen'
          ? 'border-pink-400 text-pink-300'
          : 'border-green-400 text-green-300'
      } hover:bg-white/5 transition-colors ${
        isSending ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      title="Toggle Degen Mode"
    >
      {isSending
        ? 'Activating...'
        : personalityMode === 'degen'
          ? 'Disable Degen Mode'
          : 'Enable Degen Mode'
      }
    </button>
  );
};

const TrafficLight = ({ type, onClick }) => {
  const colors = {
    close: 'bg-red-500 hover:bg-red-400',
    minimize: 'bg-yellow-500 hover:bg-yellow-400',
    maximize: 'bg-green-500 hover:bg-green-400'
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) onClick();
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      className={`
        w-3 h-3 rounded-full transition-colors duration-150
        ${colors[type]}
        cursor-pointer hover:scale-110
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
    updateSize,
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

  // Resize hook
  const { size: resizeSize, position: resizePosition, isResizing: isWindowResizing, resizeDirection, resizeHandlers, setSize, setPosition: setResizePosition } = useResize({
    initialSize: windowState?.size || stableInitialSize,
    initialPosition: windowState?.position || stableInitialPosition,
    onResizeStart: (direction) => {
      bringToFront(id);
    },
    onResizeEnd: (newSize, newPosition) => {
      // Update both size and position after resize
      updatePosition(id, newPosition);
      updateSize(id, newSize);
    },
    onSizeChange: (newSize, newPosition) => {
      // Update position during resize
      updatePosition(id, newPosition);
      // Size is managed through the current window dimensions
    }
  });

  // Use resize size/position when resizing, otherwise use drag values
  const currentPosition = isWindowResizing ? resizePosition : position;

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

    // For first-time open, center horizontally and place below headers
    // Check if position is still at default initial position
    if (windowState.position.x === stableInitialPosition.x && windowState.position.y === stableInitialPosition.y) {
      const currentSize = windowState.size;
      const centerX = Math.max(leftSafe, (window.innerWidth - currentSize.width) / 2);
      const safeY = topSafe + 24; // 24px below header

      const centeredPosition = {
        x: Math.min(centerX, window.innerWidth - rightSafe - currentSize.width),
        y: Math.min(safeY, window.innerHeight - bottomSafe - currentSize.height)
      };

      setPosition(centeredPosition);
      updatePosition(id, centeredPosition);
    }
  }, [windowState, setPosition, updatePosition, id, topSafe, bottomSafe, leftSafe, rightSafe, stableInitialPosition]);

  // Handle viewport changes - clamp position if window becomes invalid
  useEffect(() => {
    if (!windowState || isDragging) return;

    const currentSize = windowState.size;
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

          // For closed/minimized windows, render but hide visually to preserve iframe state
          const isClosed = windowState?.isClosed || false;
          const isMinimized = windowState?.isMinimized || false;

          const currentSize = isWindowResizing ? resizeSize : (windowState?.size || stableInitialSize);
          const isMaximized = windowState?.isMaximized || false;
          const zIndex = windowState?.zIndex || 1000;
          const isFocused = windowState?.isFocused || false;

          // Calculate heights for proper content fitting
          const headerHeight = 52; // Header with padding and border
          const footerHeight = (footerLeft || footerRight) ? 38 : 0; // Footer height when present
          const totalChromeHeight = headerHeight + footerHeight;

  return (
    <div
      ref={windowRef}
      className={`
        fixed transition-shadow duration-200
        ${isDragging || isWindowResizing ? '' : 'transition-all duration-300 ease-out'}
        ${isFocused ? 'shadow-2xl shadow-purple-500/20' : 'shadow-lg'}
        ${isDragging ? 'shadow-3xl shadow-blue-500/30' : ''}
        ${isWindowResizing ? 'ring-2 ring-blue-400/50' : ''}
        ${(isMinimized || isClosed) ? 'opacity-0 pointer-events-none' : ''}
        ${className}
      `}
      style={{
        left: isMaximized ? leftSafe : currentPosition.x,
        top: isMaximized ? topSafe : currentPosition.y,
        width: isMaximized ? `calc(100vw - ${leftSafe + rightSafe}px)` : currentSize.width,
        height: isMaximized ? `calc(100vh - ${topSafe + bottomSafe}px)` : currentSize.height,
        zIndex: isClosed ? -1 : zIndex,
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
                  ${isMaximized ? 'cursor-default' : isDragging ? 'cursor-grabbing' : isWindowResizing ? 'cursor-wait' : 'cursor-grab'}
                  select-none
                `}
        {...(isMaximized || isMinimized || isClosed ? {} : dragHandlers)}
        role="banner"
        aria-grabbed={isDragging}
      >
        {/* Traffic Lights */}
        <div className="flex items-center gap-2" data-nodrag>
          <TrafficLight
            type="close"
            onClick={handleClose}
          />
          <TrafficLight
            type="minimize"
            onClick={handleMinimize}
          />
          <TrafficLight
            type="maximize"
            onClick={handleMaximize}
          />
          <span
            id={`window-title-${id}`}
            className="ml-4 font-mono text-sm text-gray-400 select-none"
          >
            {title}
          </span>
        </div>

        {/* Status Section */}
        <div className="flex items-center gap-3">
          {statusLabel === 'Enable Degen Mode' ? (
            <DegenModeButton />
          ) : (
            <>
              <div className={`w-2 h-2 rounded-full animate-pulse ${statusTone === 'online' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className={`font-mono text-xs ${statusTone === 'online' ? 'text-green-400' : 'text-yellow-300'}`}>
                {statusLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Window Content */}
      <div
        id={`window-content-${id}`}
        className="relative bg-black overflow-hidden scrollbar-terminal"
        style={{
          height: appType === 'game'
            ? (isMaximized
                ? `calc(100vh - ${topSafe + bottomSafe + totalChromeHeight}px)`
                : `calc(${currentSize.height}px - ${totalChromeHeight}px)`
              )
            : (isMaximized ? 'calc(100vh - 52px)' : `calc(${currentSize.height}px - 52px)`)
        }}
      >
        {appType === 'game' ? (
          <div className="h-full w-full">
            {children}
          </div>
        ) : (
          <div className="px-8 pt-4 pb-6 h-full overflow-auto scrollbar-terminal">
            {children}
          </div>
        )}

        {/* Background overlay */}
        {variant === 'connect' ? (
          <div className="absolute inset-0 bg-gradient-to-b from-blue-600/15 via-blue-600/10 to-blue-700/8 blur-sm pointer-events-none"></div>
        ) : (
          <div className="absolute inset-0 bg-blue-900/15 pointer-events-none"></div>
        )}
      </div>

      {/* Footer with resize handle */}
      <div className="relative">
        {(footerLeft || footerRight) && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800 font-mono text-xs">
            <div className="truncate text-gray-400">{footerLeft}</div>
            <div className={`truncate ${statusTone === 'online' ? 'text-green-400' : 'text-yellow-300'}`}>
              {footerRight}
            </div>
          </div>
        )}

        {/* Bottom resize handles - positioned relative to footer */}
        {!isMaximized && (
          <>
            <div
              className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize"
              {...resizeHandlers[RESIZE_DIRECTIONS.S]}
            />
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize"
              {...resizeHandlers[RESIZE_DIRECTIONS.SW]}
            />
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize"
              {...resizeHandlers[RESIZE_DIRECTIONS.SE]}
            />
          </>
        )}
      </div>

      {/* Resize handles - only show when not maximized and not closed */}
      {!isMaximized && !isClosed && (
        <>
          {/* Top edge handle */}
          <div
            className="absolute top-[-3px] left-0 right-0 h-3 cursor-ns-resize"
            {...resizeHandlers[RESIZE_DIRECTIONS.N]}
          />

          {/* Side edge handles */}
          <div
            className="absolute top-0 bottom-0 left-[-3px] w-3 cursor-ew-resize"
            {...resizeHandlers[RESIZE_DIRECTIONS.W]}
          />
          <div
            className="absolute top-0 bottom-0 right-[-3px] w-3 cursor-ew-resize"
            {...resizeHandlers[RESIZE_DIRECTIONS.E]}
          />

          {/* Top corner handles */}
          <div
            className="absolute top-[-3px] left-[-3px] w-3 h-3 cursor-nwse-resize"
            {...resizeHandlers[RESIZE_DIRECTIONS.NW]}
          />
          <div
            className="absolute top-[-3px] right-[-3px] w-3 h-3 cursor-nesw-resize"
            {...resizeHandlers[RESIZE_DIRECTIONS.NE]}
          />
        </>
      )}
    </div>
  );
};

export default WindowShell;
