/**
 * IDB Sync - Continuous IndexedDB → Redis Sync
 * Main entry point for the sync system
 */

// Dynamic imports to avoid circular dependencies
let eventsModule = null;
let queueModule = null;
let stateModule = null;

const getEventsModule = async () => {
  if (!eventsModule) {
    eventsModule = await import('./events.js');
  }
  return eventsModule;
};

const getQueueModule = async () => {
  if (!queueModule) {
    queueModule = await import('./queue.js');
  }
  return queueModule;
};

const getStateModule = async () => {
  if (!stateModule) {
    stateModule = await import('./state.js');
  }
  return stateModule;
};

// Main initialization - extremely defensive and minimal
export const initializeSyncSystem = async (walletId) => {
  try {
    console.log('[IDB-Sync] Starting minimal sync system initialization...');

    // Store wallet ID first (this is critical)
    if (walletId) {
      window.__LEXIE_WALLET_ID_FOR_SYNC = walletId;
      console.log(`[IDB-Sync] Wallet ID set: ${walletId.slice(0, 8)}...`);
    }

    // Set up a minimal scheduler reference
    window.__LEXIE_IDB_SYNC_SCHEDULER__ = async () => {
      console.log('[IDB-Sync] Scheduler triggered (minimal implementation)');
      try {
        // Lazy load the full scheduler only when needed
        const schedulerMod = await import('./scheduler.js');
        return await schedulerMod.scheduleSync();
      } catch (err) {
        console.warn('[IDB-Sync] Full scheduler not available:', err.message);
      }
    };

    // Try to set up event listeners (this is the most likely to fail)
    try {
      console.log('[IDB-Sync] Setting up event listeners...');
      const eventsMod = await getEventsModule();
      await eventsMod.initializeIDBSync();
      console.log('[IDB-Sync] Event listeners set up successfully');
    } catch (eventsError) {
      console.warn('[IDB-Sync] Event listeners setup failed:', eventsError.message);
      // Continue anyway - events can be set up later
    }

    // Optional: Try to process queue later
    setTimeout(async () => {
      try {
        console.log('[IDB-Sync] Attempting to process queue...');
        const queueMod = await import('./queue.js');
        if (queueMod.processQueue) {
          await queueMod.processQueue();
          console.log('[IDB-Sync] Queue processed successfully');
        }
      } catch (queueError) {
        console.warn('[IDB-Sync] Queue processing failed (optional):', queueError.message);
      }
    }, 10000); // Wait even longer for queue

    console.log('[IDB-Sync] Minimal sync system initialized successfully');

  } catch (error) {
    // Don't throw - just log and continue
    console.info('[IDB-Sync] Minimal initialization failed:', error.message);
    console.info('[IDB-Sync] System will operate in degraded mode');
  }
};

// Public API (with dynamic imports to avoid circular dependencies)
export const getQueueStats = async () => {
  const queueMod = await getQueueModule();
  return queueMod.getQueueStats();
};

export const clearQueue = async () => {
  const queueMod = await getQueueModule();
  return queueMod.clearQueue();
};

export const getStateStatus = async () => {
  const stateMod = await getStateModule();
  return stateMod.getSyncStatus();
};

export const resetSyncState = async () => {
  const stateMod = await getStateModule();
  return stateMod.resetSyncState();
};

export const initializeIDBSync = async () => {
  const eventsMod = await getEventsModule();
  return eventsMod.initializeIDBSync();
};

// Dynamic exports for scheduler functions
export const scheduleSync = async () => {
  const { scheduleSync } = await import('./scheduler.js');
  return scheduleSync();
};

export const cancelSync = async () => {
  const { cancelSync } = await import('./scheduler.js');
  return cancelSync();
};

export const getSyncStatus = async () => {
  const { getSyncStatus } = await import('./scheduler.js');
  return getSyncStatus();
};

// Manual full snapshot export (for debugging/testing)
export const exportFullSnapshot = async (walletId) => {
  const { exportFullSnapshot } = await import('./exporter.js');
  return exportFullSnapshot(walletId);
};

// Hydration functions (Redis → IDB sync)
export const startHydration = async (walletId, options = {}) => {
  const { startHydration } = await import('./hydration.js');
  return startHydration(walletId, options);
};

export const getHydrationStatus = async (walletId) => {
  const { getHydrationStatus } = await import('./hydration.js');
  return getHydrationStatus(walletId);
};

export const cancelHydration = async (walletId) => {
  const { cancelHydration } = await import('./hydration.js');
  return cancelHydration(walletId);
};

export const resetHydration = async (walletId) => {
  const { resetHydration } = await import('./hydration.js');
  return resetHydration(walletId);
};

export const checkHydrationNeeded = async (walletId) => {
  const { checkHydrationNeeded } = await import('./hydration.js');
  return checkHydrationNeeded(walletId);
};

// Debug utilities (available in console)
if (typeof window !== 'undefined') {
  window.__LEXIE_IDB_SYNC__ = {
    // Manual initialization (in case automatic fails)
    init: async () => {
      console.log('[IDB-Sync-Debug] Manual initialization triggered');
      try {
        await initializeSyncSystem(window.__LEXIE_WALLET_ID_FOR_SYNC);
        console.log('[IDB-Sync-Debug] Manual initialization successful');
      } catch (error) {
        console.error('[IDB-Sync-Debug] Manual initialization failed:', error);
      }
    },

    // Trigger manual sync
    triggerSync: () => {
      console.log('[IDB-Sync-Debug] Manual sync triggered');
      window.dispatchEvent(new CustomEvent('lexie-idb-sync-trigger'));
    },

    // Get sync status
    getStatus: async () => {
      try {
        const syncStatus = await getSyncStatus();
        const queueStats = await getQueueStats();
        const stateStatus = await getStateStatus();

        console.log('[IDB-Sync-Debug] Sync Status:', { syncStatus, queueStats, stateStatus });
        return { syncStatus, queueStats, stateStatus };
      } catch (error) {
        console.log('[IDB-Sync-Debug] Status check failed:', error.message);
        return { error: error.message };
      }
    },

    // Reset everything
    reset: async () => {
      console.log('[IDB-Sync-Debug] Resetting sync system');
      try {
        await clearQueue();
        await resetSyncState();
        console.log('[IDB-Sync-Debug] Sync system reset complete');
      } catch (error) {
        console.error('[IDB-Sync-Debug] Reset failed:', error);
      }
    },

    // Cancel current sync
    cancel: async () => {
      console.log('[IDB-Sync-Debug] Cancelling current sync');
      try {
        const { cancelSync } = await import('./scheduler.js');
        return await cancelSync();
      } catch (error) {
        console.warn('[IDB-Sync-Debug] Cancel failed:', error.message);
      }
    },

    // Manual full snapshot export
    exportSnapshot: async () => {
      console.log('[IDB-Sync-Debug] Manual snapshot export triggered');
      try {
        const result = await exportFullSnapshot(window.__LEXIE_WALLET_ID_FOR_SYNC);
        console.log('[IDB-Sync-Debug] Snapshot export result:', result);
        return result;
      } catch (error) {
        console.error('[IDB-Sync-Debug] Snapshot export failed:', error);
      }
    },

    // Check if system is initialized
    isReady: () => {
      const hasWalletId = !!window.__LEXIE_WALLET_ID_FOR_SYNC;
      const hasScheduler = !!window.__LEXIE_IDB_SYNC_SCHEDULER__;
      console.log('[IDB-Sync-Debug] System readiness:', { hasWalletId, hasScheduler });
      return { hasWalletId, hasScheduler };
    },

    // Hydration functions
    startHydration: async (walletId, options = {}) => {
      console.log('[IDB-Sync-Debug] Starting hydration for wallet:', walletId);
      try {
        const result = await startHydration(walletId, options);
        console.log('[IDB-Sync-Debug] Hydration started:', result);
        return result;
      } catch (error) {
        console.error('[IDB-Sync-Debug] Hydration start failed:', error);
      }
    },

    getHydrationStatus: (walletId) => {
      console.log('[IDB-Sync-Debug] Getting hydration status for wallet:', walletId);
      try {
        const status = getHydrationStatus(walletId);
        console.log('[IDB-Sync-Debug] Hydration status:', status);
        return status;
      } catch (error) {
        console.error('[IDB-Sync-Debug] Get hydration status failed:', error);
      }
    },

    cancelHydration: (walletId) => {
      console.log('[IDB-Sync-Debug] Cancelling hydration for wallet:', walletId);
      try {
        cancelHydration(walletId);
        console.log('[IDB-Sync-Debug] Hydration cancelled');
      } catch (error) {
        console.error('[IDB-Sync-Debug] Cancel hydration failed:', error);
      }
    },

    checkHydrationNeeded: async (walletId) => {
      console.log('[IDB-Sync-Debug] Checking if hydration needed for wallet:', walletId);
      try {
        const needed = await checkHydrationNeeded(walletId);
        console.log('[IDB-Sync-Debug] Hydration needed:', needed);
        return needed;
      } catch (error) {
        console.error('[IDB-Sync-Debug] Check hydration needed failed:', error);
      }
    }
  };

  console.log('🔄 [IDB-Sync] Debug utilities available:');
  console.log('   window.__LEXIE_IDB_SYNC__.init()         // Manual initialization');
  console.log('   window.__LEXIE_IDB_SYNC__.triggerSync()  // Manual sync trigger');
  console.log('   window.__LEXIE_IDB_SYNC__.exportSnapshot() // Manual full snapshot export');
  console.log('   window.__LEXIE_IDB_SYNC__.getStatus()    // Get sync status');
  console.log('   window.__LEXIE_IDB_SYNC__.isReady()      // Check if system is ready');
  console.log('   window.__LEXIE_IDB_SYNC__.reset()        // Reset sync system');
  console.log('   window.__LEXIE_IDB_SYNC__.cancel()       // Cancel current sync');
  console.log('   window.__LEXIE_IDB_SYNC__.startHydration(walletId)  // Start hydration');
  console.log('   window.__LEXIE_IDB_SYNC__.getHydrationStatus(walletId)  // Get hydration status');
  console.log('   window.__LEXIE_IDB_SYNC__.cancelHydration(walletId)  // Cancel hydration');
  console.log('   window.__LEXIE_IDB_SYNC__.checkHydrationNeeded(walletId)  // Check if hydration needed');
}
