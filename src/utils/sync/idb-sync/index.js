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

// Main initialization
export const initializeSyncSystem = async (walletId) => {
  try {
    console.log('[IDB-Sync] Initializing continuous IndexedDB → Redis sync system');

    // Dynamically import scheduler to avoid circular dependencies
    const { scheduleSync, cancelSync, getSyncStatus } = await import('./scheduler.js');

    // Set up global scheduler reference for events.js
    window.__LEXIE_IDB_SYNC_SCHEDULER__ = scheduleSync;

    // Set up event listeners
    const eventsMod = await getEventsModule();
    eventsMod.initializeIDBSync();

    // Store wallet ID globally for sync operations
    if (walletId) {
      window.__LEXIE_WALLET_ID_FOR_SYNC = walletId;
      console.log(`[IDB-Sync] Using wallet ID: ${walletId.slice(0, 8)}...`);
    }

    // Process any queued items from previous sessions
    setTimeout(async () => {
      try {
        const { processQueue } = await import('./queue.js');
        await processQueue();
      } catch (error) {
        console.error('[IDB-Sync] Failed to process queued items:', error);
      }
    }, 5000); // Wait 5 seconds after init

    console.log('[IDB-Sync] Sync system initialized successfully');

  } catch (error) {
    console.error('[IDB-Sync] Failed to initialize sync system:', error);
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

// Debug utilities (available in console)
if (typeof window !== 'undefined') {
  window.__LEXIE_IDB_SYNC__ = {
    // Trigger manual sync
    triggerSync: () => {
      console.log('[IDB-Sync-Debug] Manual sync triggered');
      window.dispatchEvent(new CustomEvent('lexie-idb-sync-trigger'));
    },

    // Get sync status
    getStatus: async () => {
      const syncStatus = await getSyncStatus();
      const queueStats = await getQueueStats();
      const stateStatus = await getStateStatus();

      console.log('[IDB-Sync-Debug] Sync Status:', { syncStatus, queueStats, stateStatus });
      return { syncStatus, queueStats, stateStatus };
    },

    // Reset everything
    reset: async () => {
      console.log('[IDB-Sync-Debug] Resetting sync system');
      await clearQueue();
      await resetSyncState();
      console.log('[IDB-Sync-Debug] Sync system reset complete');
    },

    // Cancel current sync
    cancel: async () => {
      console.log('[IDB-Sync-Debug] Cancelling current sync');
      const { cancelSync } = await import('./scheduler.js');
      return cancelSync();
    }
  };

  console.log('🔄 [IDB-Sync] Debug utilities available:');
  console.log('   window.__LEXIE_IDB_SYNC__.triggerSync()  // Manual sync trigger');
  console.log('   window.__LEXIE_IDB_SYNC__.getStatus()    // Get sync status');
  console.log('   window.__LEXIE_IDB_SYNC__.reset()        // Reset sync system');
  console.log('   window.__LEXIE_IDB_SYNC__.cancel()       // Cancel current sync');
}
