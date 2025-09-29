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

    const CONCURRENT_UPLOADS = 6; // Upload 6 chunks in parallel

    // Upload chunks in parallel batches
    for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENT_UPLOADS) {
      if (activeController?.signal.aborted) {
        throw new Error('Sync aborted');
      }

      const batchEnd = Math.min(batchStart + CONCURRENT_UPLOADS, chunks.length);
      const uploadPromises = [];

      // Start parallel uploads for this batch
      for (let i = batchStart; i < batchEnd; i++) {
        const uploadPromise = (async () => {
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

          console.log(`[IDB-Sync-Scheduler] Uploaded chunk ${i + 1}/${chunks.length} (bytes=${chunk.length}) for ${storeName}`);
        })();

        uploadPromises.push(uploadPromise);
      }

      // Wait for all uploads in this batch to complete
      await Promise.all(uploadPromises);

      // Small delay between batches to prevent overwhelming the server
      if (batchEnd < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
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
    return { success: false, reason: 'already_syncing' };
  }

  // Get wallet ID if not provided
  if (!walletId) {
    walletId = window.__LEXIE_WALLET_ID_FOR_SYNC;

    if (!walletId) {
      console.debug('[IDB-Sync-Scheduler] No wallet ID available, skipping sync');
      return { success: false, reason: 'no_wallet_id' };
    }
  }

  isSyncing = true;
  activeController = new AbortController();
  const startTime = Date.now();

  try {
    console.log('[IDB-Sync-Scheduler] Starting full snapshot sync operation', { walletId });

    const exporterMod = await getExporterModule();

    // Export full snapshot
    const snapshotData = await exporterMod.exportFullSnapshot(walletId, activeController.signal);

    if (!snapshotData) {
      console.log('[IDB-Sync-Scheduler] No data to export');
      return { success: true, exported: 0 };
    }

    const { manifest, chunks, timestamp, recordCount, totalBytes } = snapshotData;

    console.log(`[IDB-Sync-Scheduler] Exported ${recordCount} records, ${chunks.length} chunks`);

    // Upload to Redis
    const apiMod = await getApiModule();

    // Upload manifest first
    await apiMod.uploadSnapshotManifest(walletId, timestamp, manifest);
    console.log('[IDB-Sync-Scheduler] Manifest uploaded');

    // Upload chunks
    for (let i = 0; i < chunks.length; i++) {
      if (activeController.signal.aborted) {
        throw new Error('Sync aborted during chunk upload');
      }

      await apiMod.uploadSnapshotChunk(walletId, timestamp, i, chunks[i], chunks.length);
      console.log(`[IDB-Sync-Scheduler] Uploaded chunk ${i + 1}/${chunks.length}`);
    }

    // Finalize upload
    await apiMod.finalizeSnapshotUpload(walletId, timestamp);
    console.log('[IDB-Sync-Scheduler] Upload finalized');

    const duration = Date.now() - startTime;

    console.log('[IDB-Sync-Scheduler] Full snapshot sync completed', {
      recordCount,
      totalBytes,
      chunkCount: chunks.length,
      duration: `${duration}ms`
    });

    // Clear all dirty flags since we did a full snapshot
    const stateMod = await getStateModule();
    stateMod.SYNC_STORES.forEach(store => stateMod.clearDirtyFlag(store));

    return {
      success: true,
      recordCount,
      totalBytes,
      chunkCount: chunks.length,
      duration,
      timestamp
    };

  } catch (error) {
    console.error('[IDB-Sync-Scheduler] Sync operation failed:', error);
    return { success: false, error: error.message };
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
