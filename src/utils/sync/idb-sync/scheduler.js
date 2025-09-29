/**
 * IDB Sync Scheduler
 * Coordinates the sync process and manages concurrent operations
 */

// Dynamic imports to avoid circular dependencies
let stateModule = null;
let exporterModule = null;
let apiModule = null;

const getStateModule = async () => {
  if (!stateModule) {
    stateModule = await import('./state.js');
  }
  return stateModule;
};

const getExporterModule = async () => {
  if (!exporterModule) {
    exporterModule = await import('./exporter.js');
  }
  return exporterModule;
};

const getApiModule = async () => {
  if (!apiModule) {
    apiModule = await import('./api.js');
  }
  return apiModule;
};

// Prevent concurrent syncs
let isSyncing = false;
let activeController = null;

/**
 * Sync a single store
 */
const syncStore = async (walletId, dbName, storeName) => {
  try {
    console.log(`[IDB-Sync-Scheduler] Starting sync for ${storeName}`);

    const exporterMod = await getExporterModule();
    const syncData = await exporterMod.prepareSyncData(walletId, dbName, storeName);

    if (!syncData) {
      console.log(`[IDB-Sync-Scheduler] No data to sync for ${storeName}`);
      return;
    }

    const { chunks, manifest, lastKey } = syncData;

    // Upload all chunks
    for (let i = 0; i < chunks.length; i++) {
      if (activeController?.signal.aborted) {
        throw new Error('Sync aborted');
      }

      const chunk = chunks[i];
      const chunkHash = await calculateHash(chunk);

      const apiMod = await getApiModule();
      await apiMod.uploadChunk(
        walletId,
        storeName, // Use storeName as dbName for simplicity
        syncData.timestamp,
        i,
        chunks.length,
        chunk,
        chunkHash
      );

      console.debug(`[IDB-Sync-Scheduler] Uploaded chunk ${i + 1}/${chunks.length} for ${storeName}`);
    }

    // Finalize sync
    const apiMod = await getApiModule();
    await apiMod.finalizeSync(walletId, storeName, syncData.timestamp, manifest);

    // Update cursor and clear dirty flag
    const stateMod = await getStateModule();
    stateMod.setSyncCursor(`${dbName}:${storeName}`, lastKey);
    stateMod.setSyncHash(storeName, manifest.hash);

    console.log(`[IDB-Sync-Scheduler] Completed sync for ${storeName}`, {
      chunks: chunks.length,
      records: manifest.totalRecords
    });

  } catch (error) {
    console.error(`[IDB-Sync-Scheduler] Failed to sync ${storeName}:`, error);
    throw error;
  }
};

/**
 * Calculate SHA-256 hash
 */
const calculateHash = async (data) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Schedule a sync operation
 */
export const scheduleSync = async (walletId = null) => {
  // Prevent concurrent syncs
  if (isSyncing) {
    console.debug('[IDB-Sync-Scheduler] Sync already in progress, skipping');
    return;
  }

  // Get wallet ID if not provided
  if (!walletId) {
    walletId = window.__LEXIE_WALLET_ID_FOR_SYNC;

    if (!walletId) {
      console.debug('[IDB-Sync-Scheduler] No wallet ID available, skipping sync');
      return;
    }
  }

  isSyncing = true;
  activeController = new AbortController();
  const startTime = Date.now();

  try {
    console.log('[IDB-Sync-Scheduler] Starting sync operation', { walletId });

    const stateMod = await getStateModule();
    const dirtyFlags = stateMod.getDirtyFlags();
    const storesToSync = stateMod.SYNC_STORES.filter(store => dirtyFlags[store]);

    if (storesToSync.length === 0) {
      console.log('[IDB-Sync-Scheduler] No dirty stores to sync');
      return;
    }

    console.log(`[IDB-Sync-Scheduler] Syncing ${storesToSync.length} stores:`, storesToSync);

    // Sync each dirty store
    const results = [];
    for (const storeName of storesToSync) {
      try {
        await syncStore(walletId, 'railgun', storeName);
        stateMod.clearDirtyFlag(storeName);
        results.push({ store: storeName, success: true });
      } catch (error) {
        console.error(`[IDB-Sync-Scheduler] Store sync failed for ${storeName}:`, error);
        results.push({ store: storeName, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const duration = Date.now() - startTime;

    console.log('[IDB-Sync-Scheduler] Sync operation completed', {
      totalStores: storesToSync.length,
      successful: successCount,
      failed: storesToSync.length - successCount,
      duration: `${duration}ms`
    });

    // Process any queued chunks that may have failed during sync
    try {
      const { processQueue } = await import('./queue.js');
      await processQueue();
    } catch (error) {
      console.error('[IDB-Sync-Scheduler] Queue processing failed:', error);
    }

  } catch (error) {
    console.error('[IDB-Sync-Scheduler] Sync operation failed:', error);
  } finally {
    isSyncing = false;
    activeController = null;
  }
};

/**
 * Cancel current sync operation
 */
export const cancelSync = () => {
  if (activeController) {
    console.log('[IDB-Sync-Scheduler] Cancelling sync operation');
    activeController.abort();
    activeController = null;
    isSyncing = false;
  }
};

/**
 * Get sync status
 */
export const getSyncStatus = () => {
  return {
    isSyncing,
    canCancel: !!activeController
  };
};
