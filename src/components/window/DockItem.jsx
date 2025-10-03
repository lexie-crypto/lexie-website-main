import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWindowStore } from '../../contexts/windowStore.js';

const DockItemPreview = ({ item, isVisible, position }) => {
  if (!isVisible || !position) return null;

  const { closeWindow } = useWindowStore();

  const handleClose = (e) => {
    e.stopPropagation();
    closeWindow(item.id);
  };

  return createPortal(
    <div
      className="fixed z-50 pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%) translateY(-8px)'
      }}
      role="tooltip"
      aria-live="polite"
    >
      {/* Preview window mockup */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden w-48">
        {/* Mini header with traffic lights */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-800 border-b border-gray-700">
          <button
            onClick={handleClose}
            className="w-2 h-2 rounded-full bg-red-500 hover:bg-red-400 transition-colors cursor-pointer"
            aria-label="Close window"
          />
          <span className="text-xs text-gray-400 truncate ml-1">{item.title}</span>
        </div>

        {/* Content preview (simplified) */}
        <div className="p-2 text-xs text-gray-500 bg-black/50">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>{item.appType} • Minimized</span>
          </div>
        </div>
      </div>

      {/* Arrow pointing down */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-700"></div>
      </div>
    </div>,
    document.body
  );
};

const DockItem = ({ id, title, icon, appType, isActive, keyboardShortcut }) => {
  const { restoreWindow, closeWindow } = useWindowStore();
  const [isHovered, setIsHovered] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const itemRef = useRef(null);

  // Handle click to restore
  const handleClick = () => {
    restoreWindow(id);
  };

  // Handle middle click to toggle minimize/restore
  const handleMiddleClick = (e) => {
    e.preventDefault();
    if (isActive) {
      // If active, minimize it
      // Note: This would require adding a minimize action, but for now just restore
      restoreWindow(id);
    } else {
      restoreWindow(id);
    }
  };

  // Handle mouse enter for preview
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      setPreviewPosition({
        x: rect.left + rect.width / 2,
        y: rect.top
      });
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setPreviewPosition(null);
  };

  // Handle keyboard activation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!keyboardShortcut) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key === keyboardShortcut) {
        e.preventDefault();
        restoreWindow(id);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [keyboardShortcut, restoreWindow, id]);

  // Get display title (truncated if needed)
  const displayTitle = title.length > 12 ? `${title.slice(0, 10)}...` : title;

  // Get app icon or default
  const AppIcon = icon || (() => (
    <div className="w-4 h-4 rounded bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-xs text-white font-bold">
      {appType.charAt(0).toUpperCase()}
    </div>
  ));

  return (
    <>
      <button
        ref={itemRef}
        onClick={handleClick}
        onMouseDown={handleMiddleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`
          group relative flex flex-col items-center justify-center
          h-10 px-2 rounded-md transition-all duration-200
          hover:bg-white/10 hover:scale-105
          ${isActive
            ? 'bg-purple-500/20 border border-purple-400/50'
            : 'hover:bg-gray-700/30'
          }
          focus:outline-none focus:ring-2 focus:ring-purple-400/50
        `}
        aria-label={`Restore ${title} window${keyboardShortcut ? ` (Ctrl+${keyboardShortcut})` : ''}`}
        aria-pressed={isActive}
        title={`${title}${keyboardShortcut ? ` (Ctrl+${keyboardShortcut})` : ''}`}
      >
        {/* Icon */}
        <div className="mb-0.5">
          {typeof AppIcon === 'function' ? <AppIcon /> : AppIcon}
        </div>

        {/* Title */}
        <span className="text-xs text-gray-300 group-hover:text-white truncate max-w-full">
          {displayTitle}
        </span>

        {/* Active indicator */}
        {isActive && (
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-purple-400 rounded-full" />
        )}

        {/* Keyboard shortcut hint */}
        {keyboardShortcut && (
          <div className="absolute -top-1 -right-1 bg-gray-700 text-xs text-gray-300 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
            {keyboardShortcut}
          </div>
        )}
      </button>

      {/* Hover preview */}
      <DockItemPreview
        item={{ id, title, appType }}
        isVisible={isHovered}
        position={previewPosition}
      />
    </>
  );
};

export default DockItem;
