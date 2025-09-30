/**
 * IDB Sync Scheduler
 * Coordinates the sync process and manages concurrent operations
 */

// Master wallet configuration
export const MASTER_WALLET_ID = 'da8d141cbda9645c4268ecd2775c709813a1efd473f9fe10cdd56f90b3ac1c5e';
const MASTER_EXPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes

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
let masterExportInterval = null;

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

      console.log(`[IDB-Sync-Scheduler] Uploaded chunk ${i + 1}/${chunks.length} (bytes=${chunk.length}) for ${storeName}`);
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

  // 🚫 NEW ARCHITECTURE: Only master wallet should sync/export
  // Regular wallets only hydrate once during creation, then work locally
  if (walletId !== MASTER_WALLET_ID) {
    console.debug('[IDB-Sync-Scheduler] Regular wallet sync disabled - only master wallet exports');
    return { success: false, reason: 'regular_wallet_sync_disabled' };
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
 * Export master wallet data to global Redis (bootstrap for all users)
 */
export const exportMasterWalletToRedis = async () => {
  if (isSyncing) {
    console.log('[MasterExport] Skipping - sync already in progress');
    return { success: false, reason: 'sync_in_progress' };
  }

  isSyncing = true;
  activeController = new AbortController();
  const startTime = Date.now();

  try {
    console.log(`[MasterExport] Starting master wallet chain-specific export for ${MASTER_WALLET_ID}`);

    const exporterMod = await getExporterModule();
    const apiMod = await getApiModule();
    const chainManager = await import('./chain-manager.js');

    // Get chains that master wallet has scanned
    let scannedChains = await chainManager.getScannedChainsForWallet(MASTER_WALLET_ID);
    console.log(`[MasterExport] Master wallet has scanned ${scannedChains.length} chains:`, scannedChains);

    // If master wallet hasn't scanned any chains yet, scan them now
    if (scannedChains.length === 0) {
      console.log('[MasterExport] Master wallet has no scanned chains, scanning supported chains now...');

      // Import Railgun SDK to scan chains
      const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
      const { refreshBalances } = await import('@railgun-community/wallet');

      // Scan all supported chains for the master wallet
      for (const chainId of chainManager.SUPPORTED_CHAIN_IDS) {
        try {
          console.log(`[MasterExport] Scanning chain ${chainId} for master wallet...`);

          // Find Railgun chain config
          let railgunChain = null;
          for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
            if (cfg.chain.id === chainId) {
              railgunChain = cfg.chain;
              break;
            }
          }

          if (!railgunChain) {
            console.warn(`[MasterExport] No Railgun chain config for chainId ${chainId}, skipping`);
            continue;
          }

          // Scan the chain
          await refreshBalances(railgunChain, [MASTER_WALLET_ID]);

          // Mark chain as scanned
          await chainManager.markChainAsScanned(MASTER_WALLET_ID, chainId);
          scannedChains.push(chainId);

          console.log(`[MasterExport] Successfully scanned chain ${chainId} for master wallet`);
        } catch (scanError) {
          console.error(`[MasterExport] Failed to scan chain ${chainId} for master wallet:`, scanError.message);
        }
      }

      console.log(`[MasterExport] Master wallet scanning complete, now has ${scannedChains.length} scanned chains:`, scannedChains);
    }

    if (scannedChains.length === 0) {
      console.log('[MasterExport] No chains could be scanned for master wallet');
      return { success: false, reason: 'no_scanned_chains' };
    }

    // Sort chains by priority (BSC first, then ETH, etc.)
    const prioritizedChains = chainManager.sortChainsByPriority(scannedChains);
    console.log(`[MasterExport] Processing chains in priority order:`, prioritizedChains);

    const results = [];
    let totalRecordCount = 0;
    let totalChunksUploaded = 0;

    // Export each chain separately
    for (const chainId of prioritizedChains) {
      if (activeController.signal.aborted) {
        throw new Error('Master export aborted');
      }

      try {
        console.log(`[MasterExport] Exporting chain ${chainId}...`);

        // Export chain-specific snapshot
        const chainSnapshot = await exporterMod.exportChainSnapshot(
          MASTER_WALLET_ID,
          chainId,
          activeController.signal
        );

        if (!chainSnapshot) {
          console.log(`[MasterExport] No data to export for chain ${chainId}, skipping`);
          continue;
        }

        const { manifest, chunks, timestamp, recordCount, totalBytes } = chainSnapshot;
        console.log(`[MasterExport] Chain ${chainId} exported ${recordCount} records, ${chunks.length} chunks`);

        // Upload chain-specific manifest
        const chainManifest = {
          ...manifest,
          masterWalletId: MASTER_WALLET_ID,
          isChainBootstrap: true,
          chainId,
          exportedAt: new Date().toISOString(),
          bootstrapVersion: '2.0' // Chain-specific version
        };

        await apiMod.uploadChainSnapshotManifest(MASTER_WALLET_ID, chainId, timestamp, chainManifest);
        console.log(`[MasterExport] Chain ${chainId} manifest uploaded`);

        // Upload chunks in parallel (6 concurrent)
        const uploadPromises = [];
        for (let batchStart = 0; batchStart < chunks.length; batchStart += 6) {
          if (activeController.signal.aborted) {
            throw new Error('Master export aborted during chunk upload');
          }

          const batchEnd = Math.min(batchStart + 6, chunks.length);
          const batchPromises = [];

          for (let i = batchStart; i < batchEnd; i++) {
            const uploadPromise = apiMod.uploadChainSnapshotChunk(
              MASTER_WALLET_ID,
              chainId,
              timestamp,
              i,
              chunks[i],
              chunks.length
            ).then(() => {
              console.log(`[MasterExport] Chain ${chainId} uploaded chunk ${i + 1}/${chunks.length}`);
            });
            batchPromises.push(uploadPromise);
          }

          await Promise.all(batchPromises);
        }

        // Finalize chain-specific upload
        await apiMod.finalizeChainSnapshotUpload(MASTER_WALLET_ID, chainId, timestamp, true);
        console.log(`[MasterExport] Chain ${chainId} upload finalized`);

        results.push({
          chainId,
          recordCount,
          totalBytes,
          chunks: chunks.length,
          timestamp
        });

        totalRecordCount += recordCount;
        totalChunksUploaded += chunks.length;

      } catch (chainError) {
        console.error(`[MasterExport] Failed to export chain ${chainId}:`, chainError.message);
        // Continue with other chains instead of failing completely
      }
    }

    if (results.length === 0) {
      console.log('[MasterExport] No chains successfully exported');
      return { success: false, reason: 'no_successful_exports' };
    }

    const duration = Date.now() - startTime;

    console.log('[MasterExport] Master wallet chain-specific export completed', {
      chainsProcessed: results.length,
      totalRecordCount,
      totalChunksUploaded,
      duration: `${duration}ms`,
      chainResults: results
    });

    return {
      success: true,
      chainsProcessed: results.length,
      totalRecordCount,
      totalChunksUploaded,
      duration,
      chainResults: results
    };

  } catch (error) {
    console.error('[MasterExport] Master wallet export failed:', error);
    return { success: false, error: error.message };
  } finally {
    isSyncing = false;
    activeController = null;
  }
};

/**
 * Start master wallet periodic exports
 */
export const startMasterWalletExports = () => {
  if (masterExportInterval) {
    console.log('[MasterExport] Master wallet exports already running');
    return;
  }

  console.log(`[MasterExport] Starting periodic master wallet exports every ${MASTER_EXPORT_INTERVAL / 1000}s`);

  // Run initial export immediately
  exportMasterWalletToRedis().catch(error => {
    console.error('[MasterExport] Initial master export failed:', error);
  });

  // Schedule periodic exports
  masterExportInterval = setInterval(() => {
    console.log('[MasterExport] ⏰ Periodic export timer triggered');
    exportMasterWalletToRedis().catch(error => {
      console.error('[MasterExport] Periodic master export failed:', error);
    });
  }, MASTER_EXPORT_INTERVAL);

  console.log('[MasterExport] ✅ Periodic timer set up successfully');
};

/**
 * Export a single chain snapshot for the master wallet immediately
 */
export const exportMasterWalletChain = async (chainId) => {
  if (isSyncing) {
    console.log(`[MasterExport] Chain export for ${chainId} already in progress, skipping`);
    return { success: false, reason: 'sync_in_progress' };
  }

  isSyncing = true;
  activeController = new AbortController();
  const startTime = Date.now();

  try {
    console.log(`👑 [MasterExport] Starting immediate chain ${chainId} export for master wallet ${MASTER_WALLET_ID}`);

    const exporterMod = await getExporterModule();
    const apiMod = await getApiModule();

    // Export chain-specific snapshot
    console.log(`[MasterExport] Exporting chain ${chainId}...`);

    const chainSnapshot = await exporterMod.exportChainSnapshot(
      MASTER_WALLET_ID,
      chainId,
      activeController.signal
    );

    if (!chainSnapshot) {
      console.log(`[MasterExport] No data to export for chain ${chainId}, skipping`);
      return { success: false, reason: 'no_data' };
    }

    const { manifest, chunks, timestamp, recordCount, totalBytes } = chainSnapshot;
    console.log(`[MasterExport] Chain ${chainId} exported: ${recordCount} records, ${chunks.length} chunks, ${totalBytes} bytes`);

    // Upload manifest
    await apiMod.uploadChainSnapshotManifest(MASTER_WALLET_ID, chainId, timestamp, manifest);

    // Upload chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunkData = chunks[i];
      await apiMod.uploadChainSnapshotChunk(MASTER_WALLET_ID, chainId, timestamp, i, chunkData, chunks.length, true);
      console.log(`[MasterExport] Uploaded chunk ${i + 1}/${chunks.length} for chain ${chainId}`);
    }

    // Finalize upload
    await apiMod.finalizeChainSnapshotUpload(MASTER_WALLET_ID, chainId, timestamp, true);

    const duration = Date.now() - startTime;
    console.log(`👑 [MasterExport] Chain ${chainId} export completed successfully in ${duration}ms`);

    return {
      success: true,
      chainId,
      recordCount,
      chunkCount: chunks.length,
      totalBytes,
      duration
    };

  } catch (error) {
    console.error(`👑 [MasterExport] Failed to export master wallet chain ${chainId}:`, error);
    throw error;
  } finally {
    isSyncing = false;
    activeController = null;
  }
};

/**
 * Stop master wallet periodic exports
 */
export const stopMasterWalletExports = () => {
  if (masterExportInterval) {
    console.log('[MasterExport] Stopping master wallet exports');
    clearInterval(masterExportInterval);
    masterExportInterval = null;
  }
};

/**
 * Get master wallet export status
 */
export const getMasterExportStatus = () => {
  return {
    isRunning: !!masterExportInterval,
    masterWalletId: MASTER_WALLET_ID,
    exportInterval: MASTER_EXPORT_INTERVAL,
    isCurrentlyExporting: isSyncing
  };
};

/**
 * Manual trigger for master wallet export (for testing/debugging)
 */
export const triggerMasterExport = () => {
  console.log('[MasterExport] Manual master export triggered');
  return exportMasterWalletToRedis();
};

/**
 * Get sync status
 */
export const getSyncStatus = () => {
  return {
    isSyncing,
    canCancel: !!activeController,
    masterExportsRunning: !!masterExportInterval,
    masterWalletId: MASTER_WALLET_ID
  };
};
