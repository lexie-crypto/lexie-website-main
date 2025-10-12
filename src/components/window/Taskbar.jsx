import React, { useRef, useState, useEffect } from 'react';
import { useWindowStore } from '../../contexts/windowStore.jsx';
import DockItem from './DockItem.jsx';

const Taskbar = () => {
  const { getMinimizedWindows, getActiveWindowId } = useWindowStore();
  const dockItems = getMinimizedWindows();
  const activeWindowId = getActiveWindowId();

  const scrollContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Check if scrolling is needed
  useEffect(() => {
    const checkScroll = () => {
      if (!scrollContainerRef.current) return;

      const container = scrollContainerRef.current;
      setShowLeftArrow(container.scrollLeft > 0);
      setShowRightArrow(
        container.scrollLeft < container.scrollWidth - container.clientWidth
      );
    };

    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [dockItems]);

  // Update scroll indicators when content changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setShowLeftArrow(container.scrollLeft > 0);
      setShowRightArrow(
        container.scrollLeft < container.scrollWidth - container.clientWidth
      );
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [dockItems]);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // Don't render if no minimized windows
  if (dockItems.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[99] h-12 bg-black/80 backdrop-blur-md border-t border-gray-700/50"
      role="toolbar"
      aria-label="Minimized windows dock"
    >
      {/* Glass effect gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/20 via-transparent to-gray-800/10 pointer-events-none" />

      {/* Centered dock container */}
      <div className="relative h-full flex items-center justify-center">
        {/* Left scroll arrow */}
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="absolute left-2 z-10 h-full px-2 bg-gradient-to-r from-black/90 to-transparent hover:from-black text-gray-400 hover:text-white transition-colors"
            aria-label="Scroll dock left"
          >
            ‹
          </button>
        )}

        {/* Dock items container */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1 px-4 overflow-x-auto scrollbar-hide max-w-full"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {dockItems.map((item, index) => (
            <DockItem
              key={item.id}
              id={item.id}
              title={item.title}
              icon={item.icon}
              appType={item.appType}
              isActive={item.id === activeWindowId}
              keyboardShortcut={index < 9 ? (index + 1).toString() : null}
            />
          ))}
        </div>

        {/* Right scroll arrow */}
        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="absolute right-2 z-10 h-full px-2 bg-gradient-to-l from-black/90 to-transparent hover:from-black text-gray-400 hover:text-white transition-colors"
            aria-label="Scroll dock right"
          >
            ›
          </button>
        )}
      </div>

      {/* Mobile overflow menu (shown on small screens when many items) */}
      <div className="md:hidden absolute right-2 top-1/2 transform -translate-y-1/2">
        {dockItems.length > 5 && (
          <button
            className="w-8 h-8 rounded bg-gray-700/50 hover:bg-gray-600/50 flex items-center justify-center text-xs text-gray-300"
            aria-label="More minimized windows"
          >
            ⋯
          </button>
        )}
      </div>
    </div>
  );
};

export default Taskbar;
