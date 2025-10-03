import { useEffect } from 'react';
import { useWindowStore } from '../contexts/windowStore.js';

export const useKeyboardShortcuts = () => {
  const {
    minimizeWindow,
    restoreWindow,
    closeWindow,
    getActiveWindowId,
    getMinimizedWindows
  } = useWindowStore();

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle shortcuts when not typing in an input
      const activeElement = document.activeElement;
      const isInputFocused = activeElement &&
        (activeElement.tagName === 'INPUT' ||
         activeElement.tagName === 'TEXTAREA' ||
         activeElement.contentEditable === 'true' ||
         activeElement.closest('[role="textbox"]'));

      if (isInputFocused) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const activeWindowId = getActiveWindowId();
      const dockItems = getMinimizedWindows();

      // Cmd/Ctrl + M: Minimize focused window
      if (isCmdOrCtrl && e.key === 'm') {
        e.preventDefault();
        if (activeWindowId) {
          minimizeWindow(activeWindowId);
        }
        return;
      }

      // Cmd/Ctrl + 1-9: Restore nth dock item
      if (isCmdOrCtrl && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (dockItems[index]) {
          restoreWindow(dockItems[index].id);
        }
        return;
      }

      // Escape: Close focused window or hide any open previews
      if (e.key === 'Escape') {
        e.preventDefault();

        // First, try to close any open modal or preview
        const openModal = document.querySelector('[role="dialog"][aria-modal="true"]');
        if (openModal) {
          const closeButton = openModal.querySelector('[aria-label*="close"], [aria-label*="Close"]');
          if (closeButton) {
            closeButton.click();
            return;
          }
        }

        // Then, close the active window if it exists
        if (activeWindowId) {
          closeWindow(activeWindowId);
        }
        return;
      }

      // Cmd/Ctrl + Enter: Toggle maximize focused window
      if (isCmdOrCtrl && e.key === 'Enter') {
        e.preventDefault();
        // This would require adding toggleMaximize to the store's actions
        // For now, we'll skip this as it's not in the current store
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [minimizeWindow, restoreWindow, closeWindow, getActiveWindowId, getMinimizedWindows]);
};
