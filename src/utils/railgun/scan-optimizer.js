/**
 * Merkletree Scan Start Point Optimizer
 * Modifies LevelDB to set scan start blocks to creation blocks instead of ancient blocks
 */

/**
 * @typedef {Object} ScanStartConfig
 * @property {number} chainId - The chain ID
 * @property {string} walletId - The wallet ID
 * @property {number} creationBlock - The creation block number
 */

import LevelJS from 'level-js';

/**
 * Set the merkletree scan start point for a specific chain and wallet
 * This prevents the first scan from starting from ancient blocks
 * @param {LevelJS} db - The LevelDB database instance
 * @param {ScanStartConfig} config - Configuration object
 */
export async function setMerkletreeScanStartPoint(db, config) {
  const { chainId, walletId, creationBlock } = config;

  try {
    console.log(`[ScanOptimizer] Setting scan start point for chain ${chainId}, wallet ${walletId.slice(0, 8)}... at block ${creationBlock}`);

    // The LevelDB uses namespaced keys for different chains and wallets
    // Format: namespacePrefix:chainId:additionalKeys

    // Try to find and update existing merkletree state
    const namespacesToCheck = [
      // TXID merkletree namespace pattern
      `0000000000000000000000000000000000000000000000000chain_sync_info:00000000000000000000000000000000000000000000000last_synced_block:00000000000000000000000000000000000000000000000v2_poseidonmerkle:${chainId.toString(16).padStart(64, '0')}`,
      // UTXO merkletree namespace pattern
      `000000000000000000000000000000006d65726b6c65747265652d6572633230:${chainId.toString(16).padStart(64, '0')}:${chainId.toString(16).padStart(64, '0')}`,
      // Wallet-specific namespace
      `000000000000000000000000000000000000000000000000000077616c6c6574:${walletId}:${chainId.toString(16).padStart(64, '0')}`
    ];

    let updated = false;

    for (const namespace of namespacesToCheck) {
      try {
        // Look for last synced block keys in this namespace
        const lastSyncedKey = `${namespace}:lastSyncedBlock`;
        const startScanningKey = `${namespace}:startScanningBlockSlowScan`;

        // Try to update the last synced block to creation block
        // This should make subsequent scans start from the creation block
        await db.put(lastSyncedKey, creationBlock.toString());
        console.log(`[ScanOptimizer] Set ${lastSyncedKey} to ${creationBlock}`);

        // Also try to set the slow scan start point
        await db.put(startScanningKey, creationBlock.toString());
        console.log(`[ScanOptimizer] Set ${startScanningKey} to ${creationBlock}`);

        updated = true;
      } catch (error) {
        // Key doesn't exist yet, which is expected for fresh wallets
        // We'll continue and let the scan create the keys
        console.log(`[ScanOptimizer] Key not found in namespace ${namespace}, will be created during scan`);
      }
    }

    // Also try to set global chain sync info
    try {
      const globalKey = `0000000000000000000000000000000000000000000000000chain_sync_info:00000000000000000000000000000000000000000000000last_synced_block:00000000000000000000000000000000000000000000000v2_poseidonmerkle:${chainId.toString(16).padStart(64, '0')}`;
      await db.put(globalKey, creationBlock.toString());
      console.log(`[ScanOptimizer] Set global chain sync info to ${creationBlock}`);
    } catch (error) {
      console.log(`[ScanOptimizer] Could not set global chain sync info:`, error.message);
    }

    if (updated) {
      console.log(`[ScanOptimizer] ✅ Successfully set scan start points to creation block ${creationBlock}`);
    } else {
      console.log(`[ScanOptimizer] ⚠️ No existing keys found, scan will use default start points`);
    }

  } catch (error) {
    console.error(`[ScanOptimizer] Failed to set scan start point:`, error);
    // Don't throw - this is an optimization, not a critical failure
  }
}

/**
 * Get current scan start point for debugging
 * @param {LevelJS} db - The LevelDB database instance
 * @param {number} chainId - The chain ID
 * @param {string} walletId - The wallet ID
 * @returns {Promise<{lastSyncedBlock?: number, startScanningBlock?: number, found: boolean}>}
 */
export async function getCurrentScanStartPoint(db, chainId, walletId) {
  try {
    const walletNamespace = `000000000000000000000000000000000000000000000000000077616c6c6574:${walletId}:${chainId.toString(16).padStart(64, '0')}`;

    const lastSyncedKey = `${walletNamespace}:lastSyncedBlock`;
    const startScanningKey = `${walletNamespace}:startScanningBlockSlowScan`;

    /** @type {number|undefined} */
    let lastSyncedBlock;
    /** @type {number|undefined} */
    let startScanningBlock;

    try {
      const lastSyncedValue = await db.get(lastSyncedKey);
      lastSyncedBlock = parseInt(lastSyncedValue, 10);
    } catch {
      // Key doesn't exist
    }

    try {
      const startScanningValue = await db.get(startScanningKey);
      startScanningBlock = parseInt(startScanningValue, 10);
    } catch {
      // Key doesn't exist
    }

    return {
      lastSyncedBlock,
      startScanningBlock,
      found: !!(lastSyncedBlock || startScanningBlock)
    };
  } catch (error) {
    console.error(`[ScanOptimizer] Failed to get current scan start point:`, error);
    return { found: false };
  }
}

/**
 * Optimize scan start point before initial balance refresh
 * This should be called right before refreshBalances() for new wallets
 * @param {LevelJS} db - The LevelDB database instance
 * @param {number} chainId - The chain ID
 * @param {string} walletId - The wallet ID
 * @param {number} creationBlock - The creation block number
 */
export async function optimizeInitialScanStartPoint(db, chainId, walletId, creationBlock) {
  console.log(`[ScanOptimizer] Optimizing initial scan for wallet ${walletId.slice(0, 8)} on chain ${chainId} from block ${creationBlock}`);

  // Set the scan start point
  await setMerkletreeScanStartPoint(db, {
    chainId,
    walletId,
    creationBlock
  });

  // Verify the optimization was applied
  const currentState = await getCurrentScanStartPoint(db, chainId, walletId);
  console.log(`[ScanOptimizer] Current scan state:`, currentState);

  if (currentState.lastSyncedBlock === creationBlock) {
    console.log(`[ScanOptimizer] ✅ Scan start point successfully optimized to creation block ${creationBlock}`);
  } else {
    console.log(`[ScanOptimizer] ⚠️ Scan start point optimization may not have taken effect (expected ${creationBlock}, got ${currentState.lastSyncedBlock})`);
  }
}
