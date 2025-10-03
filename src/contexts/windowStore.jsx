import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';

// Action types
const WINDOW_ACTIONS = {
  REGISTER_WINDOW: 'REGISTER_WINDOW',
  MINIMIZE_WINDOW: 'MINIMIZE_WINDOW',
  RESTORE_WINDOW: 'RESTORE_WINDOW',
  CLOSE_WINDOW: 'CLOSE_WINDOW',
  BRING_TO_FRONT: 'BRING_TO_FRONT',
  UPDATE_POSITION: 'UPDATE_POSITION',
  UPDATE_SIZE: 'UPDATE_SIZE',
  TOGGLE_MAXIMIZE: 'TOGGLE_MAXIMIZE',
  LOAD_PERSISTED_STATE: 'LOAD_PERSISTED_STATE',
  UPDATE_FOCUS: 'UPDATE_FOCUS'
};

// Initial state
const initialState = {
  windows: {}, // id -> window state
  dockItems: [], // array of { id, title, icon, appType, lastPosition, lastSize }
  activeWindowId: null,
  nextZIndex: 1000,
  isInitialized: false
};

// Window state shape - NEVER reads from localStorage, only uses provided initialData
const createWindowState = (id, initialData = {}) => {
  // CRITICAL: No localStorage access here - only use provided initialData for clean starts
  const initialSize = initialData.size || { width: 800, height: 600 };
  const initialPosition = initialData.position || { x: 100, y: 100 };

  return {
    id,
    title: initialData.title || 'Window',
    icon: initialData.icon || null,
    appType: initialData.appType || 'default',
    isMinimized: false,
    isMaximized: false,
    isClosed: false,
    position: initialPosition,
    size: initialSize,
    lastRestoredPosition: initialPosition,
    lastRestoredSize: initialSize,
    zIndex: initialData.zIndex || 1000,
    isFocused: false
  };
};

// Reducer
function windowReducer(state, action) {
  switch (action.type) {
    case WINDOW_ACTIONS.REGISTER_WINDOW: {
      const { id, ...windowData } = action.payload;
      const existingWindow = state.windows[id];

      if (existingWindow) {
        // Update existing window
        return {
          ...state,
          windows: {
            ...state.windows,
            [id]: {
              ...existingWindow,
              ...windowData,
              // Preserve persisted state
              isMinimized: existingWindow.isMinimized,
              isMaximized: existingWindow.isMaximized,
              isClosed: existingWindow.isClosed,
              position: existingWindow.position,
              size: existingWindow.size,
              lastRestoredPosition: existingWindow.lastRestoredPosition,
              lastRestoredSize: existingWindow.lastRestoredSize
            }
          }
        };
      }

      // Create new window
      const newWindow = createWindowState(id, windowData);
      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: newWindow
        }
      };
    }

    case WINDOW_ACTIONS.MINIMIZE_WINDOW: {
      const { id } = action.payload;
      console.log('windowStore reducer: MINIMIZE_WINDOW for', id);
      const window = state.windows[id];
      if (!window) {
        console.log('windowStore reducer: Window not found for minimize:', id);
        return state;
      }

      // Save window size to localStorage when minimizing
      const windowSizeData = {
        width: window.lastRestoredSize.width,
        height: window.lastRestoredSize.height
      };
      try {
        localStorage.setItem(`lexie:window-size:${id}`, JSON.stringify(windowSizeData));
      } catch (e) {
        console.warn(`Failed to save window size for ${id}:`, e);
      }

      const dockItem = {
        id,
        title: window.title,
        icon: window.icon,
        appType: window.appType,
        lastPosition: window.lastRestoredPosition,
        lastSize: window.lastRestoredSize
      };

      // Remove from dock if already there, then add to front (LRU)
      const filteredDock = state.dockItems.filter(item => item.id !== id);

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            isMinimized: true,
            isFocused: false,
            position: window.lastRestoredPosition,
            size: window.lastRestoredSize
          }
        },
        dockItems: [dockItem, ...filteredDock],
        activeWindowId: state.activeWindowId === id ? null : state.activeWindowId
      };
    }

    case WINDOW_ACTIONS.RESTORE_WINDOW: {
      const { id } = action.payload;
      const window = state.windows[id];
      if (!window) return state;

      // Load window size from localStorage
      let restoredSize = window.lastRestoredSize;
      try {
        const savedSizeData = localStorage.getItem(`lexie:window-size:${id}`);
        if (savedSizeData) {
          const parsedSize = JSON.parse(savedSizeData);
          restoredSize = {
            width: parsedSize.width || window.lastRestoredSize.width,
            height: parsedSize.height || window.lastRestoredSize.height
          };
        }
      } catch (e) {
        console.warn(`Failed to load window size for ${id}:`, e);
      }

      // Remove from dock
      const filteredDock = state.dockItems.filter(item => item.id !== id);

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            isMinimized: false,
            isFocused: true,
            zIndex: state.nextZIndex,
            position: window.lastRestoredPosition,
            size: restoredSize,
            lastRestoredSize: restoredSize
          }
        },
        dockItems: filteredDock,
        activeWindowId: id,
        nextZIndex: state.nextZIndex + 1
      };
    }

    case WINDOW_ACTIONS.CLOSE_WINDOW: {
      const { id } = action.payload;
      console.log('windowStore reducer: CLOSE_WINDOW for', id);
      const window = state.windows[id];
      if (!window) {
        console.log('windowStore reducer: Window not found for close:', id);
        return state;
      }

      // Remove from dock
      const filteredDock = state.dockItems.filter(item => item.id !== id);

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            isClosed: true,
            isMinimized: false,
            isFocused: false
          }
        },
        dockItems: filteredDock,
        activeWindowId: state.activeWindowId === id ? null : state.activeWindowId
      };
    }

    case WINDOW_ACTIONS.BRING_TO_FRONT: {
      const { id } = action.payload;
      const window = state.windows[id];
      if (!window || window.isMinimized || window.isClosed) return state;

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            isFocused: true,
            zIndex: state.nextZIndex
          }
        },
        activeWindowId: id,
        nextZIndex: state.nextZIndex + 1
      };
    }

    case WINDOW_ACTIONS.UPDATE_POSITION: {
      const { id, position } = action.payload;
      const window = state.windows[id];
      if (!window) return state;

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            position: window.isMaximized ? window.position : position,
            lastRestoredPosition: window.isMaximized ? window.lastRestoredPosition : position
          }
        }
      };
    }

    case WINDOW_ACTIONS.UPDATE_SIZE: {
      const { id, size } = action.payload;
      const window = state.windows[id];
      if (!window) return state;

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            size: window.isMaximized ? window.size : size,
            lastRestoredSize: window.isMaximized ? window.lastRestoredSize : size
          }
        }
      };
    }

    case WINDOW_ACTIONS.TOGGLE_MAXIMIZE: {
      const { id, viewportSize } = action.payload;
      console.log('windowStore reducer: TOGGLE_MAXIMIZE for', id, 'viewportSize:', viewportSize);
      const window = state.windows[id];
      if (!window) {
        console.log('windowStore reducer: Window not found for maximize:', id);
        return state;
      }

      const willBeMaximized = !window.isMaximized;
      const maxSize = viewportSize || { width: 800, height: 600 };

      return {
        ...state,
        windows: {
          ...state.windows,
          [id]: {
            ...window,
            isMaximized: willBeMaximized,
            // Store/restore position and size
            position: willBeMaximized ? { x: 0, y: 0 } : window.lastRestoredPosition,
            size: willBeMaximized ? maxSize : window.lastRestoredSize,
            // Bring to front when maximizing
            zIndex: willBeMaximized ? state.nextZIndex : window.zIndex,
            isFocused: willBeMaximized
          }
        },
        activeWindowId: willBeMaximized ? id : state.activeWindowId,
        nextZIndex: willBeMaximized ? state.nextZIndex + 1 : state.nextZIndex
      };
    }

    case WINDOW_ACTIONS.LOAD_PERSISTED_STATE: {
      const { persistedWindows, persistedDock } = action.payload;

      // Merge persisted state with current windows
      const mergedWindows = { ...state.windows };

      Object.entries(persistedWindows).forEach(([id, persistedWindow]) => {
        if (mergedWindows[id]) {
          // Update existing window with persisted state
          mergedWindows[id] = {
            ...mergedWindows[id],
            ...persistedWindow,
            // Override with persisted values
            isMinimized: persistedWindow.isMinimized,
            isMaximized: persistedWindow.isMaximized,
            isClosed: persistedWindow.isClosed,
            position: persistedWindow.position,
            size: persistedWindow.size,
            lastRestoredPosition: persistedWindow.lastRestoredPosition,
            lastRestoredSize: persistedWindow.lastRestoredSize
          };
        } else {
          // Create window from persisted state
          mergedWindows[id] = createWindowState(id, persistedWindow);
        }
      });

      return {
        ...state,
        windows: mergedWindows,
        dockItems: persistedDock || [],
        isInitialized: true
      };
    }

    case WINDOW_ACTIONS.UPDATE_FOCUS: {
      const { focusedId } = action.payload;

      const updatedWindows = Object.fromEntries(
        Object.entries(state.windows).map(([id, window]) => [
          id,
          {
            ...window,
            isFocused: id === focusedId && !window.isMinimized && !window.isClosed
          }
        ])
      );

      return {
        ...state,
        windows: updatedWindows,
        activeWindowId: focusedId
      };
    }

    default:
      return state;
  }
}

// Context
const WindowContext = createContext();

// Persistence helpers
const getStorageKey = (windowId) => `lexie:windows:${windowId}`;
const getDockStorageKey = () => 'lexie:dock';

const clearPersistedState = () => {
  if (typeof window === 'undefined') return;

  try {
    // Clear all window states from localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('lexie:windows:') || key === 'lexie:dock') {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('Failed to clear persisted window state:', e);
  }
};

const loadPersistedState = () => {
  if (typeof window === 'undefined') return { windows: {}, dock: [] };

  try {
    // Only load dock state (minimized windows) - windows reset on page refresh
    const dock = JSON.parse(localStorage.getItem(getDockStorageKey()) || '[]');

    return { windows: {}, dock };
  } catch (e) {
    console.warn('Failed to load persisted dock state:', e);
    return { windows: {}, dock: [] };
  }
};

const saveWindowState = (windowId, windowState) => {
  // For page refresh reset behavior, don't persist state
  // This ensures every page load starts fresh
  return;
};

const saveDockState = (dockItems) => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(getDockStorageKey(), JSON.stringify(dockItems));
  } catch (e) {
    console.warn('Failed to save dock state:', e);
  }
};

// Provider component
export const WindowProvider = ({ children }) => {
  const [state, dispatch] = useReducer(windowReducer, initialState);

  // Load persisted state on mount (dock state persists, windows reset)
  useEffect(() => {
    const { windows, dock } = loadPersistedState();
    dispatch({
      type: WINDOW_ACTIONS.LOAD_PERSISTED_STATE,
      payload: { persistedWindows: windows, persistedDock: dock }
    });
  }, []);

  // Persist dock state changes (for minimize/restore across refreshes)
  useEffect(() => {
    if (!state.isInitialized) return;
    saveDockState(state.dockItems);
  }, [state.dockItems, state.isInitialized]);

  // Actions
  const actions = {
    registerWindow: useCallback((id, windowData) => {
      dispatch({ type: WINDOW_ACTIONS.REGISTER_WINDOW, payload: { id, ...windowData } });
    }, []),

    minimizeWindow: useCallback((id) => {
      console.log('windowStore: minimizeWindow called for', id);
      dispatch({ type: WINDOW_ACTIONS.MINIMIZE_WINDOW, payload: { id } });
    }, []),

    restoreWindow: useCallback((id) => {
      dispatch({ type: WINDOW_ACTIONS.RESTORE_WINDOW, payload: { id } });
    }, []),

    closeWindow: useCallback((id) => {
      console.log('windowStore: closeWindow called for', id);
      dispatch({ type: WINDOW_ACTIONS.CLOSE_WINDOW, payload: { id } });
    }, []),

    bringToFront: useCallback((id) => {
      dispatch({ type: WINDOW_ACTIONS.BRING_TO_FRONT, payload: { id } });
    }, []),

    updatePosition: useCallback((id, position) => {
      dispatch({ type: WINDOW_ACTIONS.UPDATE_POSITION, payload: { id, position } });
    }, []),

    updateSize: useCallback((id, size) => {
      dispatch({ type: WINDOW_ACTIONS.UPDATE_SIZE, payload: { id, size } });
    }, []),

    toggleMaximize: useCallback((id, viewportSize) => {
      console.log('windowStore: toggleMaximize called for', id, 'with viewportSize:', viewportSize);
      dispatch({ type: WINDOW_ACTIONS.TOGGLE_MAXIMIZE, payload: { id, viewportSize } });
    }, []),

    updateFocus: useCallback((focusedId) => {
      dispatch({ type: WINDOW_ACTIONS.UPDATE_FOCUS, payload: { focusedId } });
    }, [])
  };

  // Computed values
  const getWindowState = useCallback((id) => state.windows[id], [state.windows]);
  const getVisibleWindows = useCallback(() =>
    Object.values(state.windows).filter(w => !w.isMinimized && !w.isClosed),
    [state.windows]
  );
  const getMinimizedWindows = useCallback(() => state.dockItems, [state.dockItems]);
  const getActiveWindowId = useCallback(() => state.activeWindowId, [state.activeWindowId]);

  const contextValue = {
    ...state,
    ...actions,
    getWindowState,
    getVisibleWindows,
    getMinimizedWindows,
    getActiveWindowId
  };

  return (
    <WindowContext.Provider value={contextValue}>
      {children}
    </WindowContext.Provider>
  );
};

// Hook to use the window store
export const useWindowStore = () => {
  const context = useContext(WindowContext);
  if (!context) {
    throw new Error('useWindowStore must be used within a WindowProvider');
  }
  return context;
};

// Export action types for external use
export { WINDOW_ACTIONS };
