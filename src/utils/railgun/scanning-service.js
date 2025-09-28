/**
 * RAILGUN Scanning Service
 * Manages Merkle tree scanning, sync status, and scan optimization
 * Based on official RAILGUN SDK patterns
 */

import {
  NetworkName,
  TXIDVersion,
  isDefined,
  RailgunBalancesEvent,
  MerkletreeScanUpdateEvent,
} from '@railgun-community/shared-models';
import {
  rescanFullUTXOMerkletreesAndWallets,
  refreshBalances,
  getUTXOMerkletreeHistoryVersion,
  getTXIDMerkletreeHistoryVersion,
  setOnUTXOMerkletreeScanCallback,
  setOnTXIDMerkletreeScanCallback,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';
import { isRedisMerkletreeAvailable, createRedisMerkletree } from './redis-merkletree-adapter.js';
// Post-transaction sync now handled directly with Redis
const executePostTransactionSyncRedis = async (chainId, transactionId) => {
  try {
    console.log(`[RedisOnly] 🔄 Executing post-transaction sync for chain ${chainId}, tx ${transactionId}`);

    // Check if merkletree data exists in Redis
    const response = await fetch(`/api/wallet-metadata/merkletree/keys?prefix=merkletree`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (response.ok) {
      const result = await response.json();
      const hasMerkletreeData = result.success && result.data.keys.length > 0;

      if (hasMerkletreeData) {
        console.log(`[RedisOnly] ✅ Post-transaction sync complete - ${result.data.keys.length} Merkletree entries in Redis`);
        return true;
      }
    }

    console.warn(`[RedisOnly] ⚠️ No Merkletree data found in Redis after transaction`);
    return false;

  } catch (error) {
    console.error('[RedisOnly] ❌ Post-transaction sync failed:', error);
    return false;
  }
};
// Balance update callbacks are handled centrally in sdk-callbacks.js

/**
 * Scan status tracking
 */
let scanStatus = new Map(); // networkName -> status
let scanProgress = new Map(); // networkName -> { utxo: number, txid: number }
let lastScanTime = new Map(); // networkName -> timestamp

/**
 * Centralized Merkletree configuration
 */
let useRedisMerkletrees = false; // Feature flag for Redis Merkletrees
let redisMerkletreeCache = new Map(); // chainId -> { utxo: adapter, txid: adapter }

/**
 * Network mapping for chain ID to Railgun network names
 * @param {number} chainId - Chain ID
 * @returns {string} Railgun network name
 */
export const getRailgunNetworkName = (chainId) => {
  // Return enum values from shared-models to match NETWORK_CONFIG keys exactly
  const mapping = {
    1: NetworkName.Ethereum,
    42161: NetworkName.Arbitrum,
    137: NetworkName.Polygon,
    56: NetworkName.BSC, // Important: SDK uses BSC, not BNBChain
  };
  return mapping[chainId] || NetworkName.Ethereum;
};

/**
 * Scan status enum
 */
export const ScanStatus = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * Get current scan status for network
 * @param {NetworkName} networkName - Network name
 * @returns {string} Current scan status
 */
export const getScanStatus = (networkName) => {
  return scanStatus.get(networkName) || ScanStatus.IDLE;
};

/**
 * Get scan progress for network
 * @param {NetworkName} networkName - Network name
 * @returns {Object} Scan progress details
 */
export const getScanProgress = (networkName) => {
  return scanProgress.get(networkName) || { utxo: 0, txid: 0 };
};

/**
 * Get last scan time for network
 * @param {NetworkName} networkName - Network name
 * @returns {number|null} Last scan timestamp
 */
export const getLastScanTime = (networkName) => {
  return lastScanTime.get(networkName) || null;
};

/**
 * Check if network needs scanning
 * @param {NetworkName} networkName - Network name
 * @param {number} maxAgeMinutes - Maximum age in minutes before considering stale
 * @returns {boolean} Whether network needs scanning
 */
export const needsScanning = (networkName, maxAgeMinutes = 30) => {
  const lastScan = getLastScanTime(networkName);
  
  if (!lastScan) {
    return true; // Never scanned
  }
  
  const ageMinutes = (Date.now() - lastScan) / (1000 * 60);
  return ageMinutes > maxAgeMinutes;
};

/**
 * Get Merkle tree history versions
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<Object>} History versions
 */
export const getMerkletreeHistoryVersions = async (networkName) => {
  try {
    await waitForRailgunReady();
    
    const utxoVersion = await getUTXOMerkletreeHistoryVersion(networkName);
    const txidVersion = await getTXIDMerkletreeHistoryVersion(networkName);
    
    const versions = {
      utxo: utxoVersion,
      txid: txidVersion,
      timestamp: Date.now(),
    };
    
    console.log(`[ScanningService] Merkle tree versions for ${networkName}:`, versions);
    return versions;
    
  } catch (error) {
    console.error(`[ScanningService] Failed to get Merkle tree versions for ${networkName}:`, error);
    return {
      utxo: 0,
      txid: 0,
      timestamp: Date.now(),
    };
  }
};

/**
 * Perform full rescan for all networks and wallets
 * @param {string[]} railgunWalletIDs - Wallet IDs to rescan
 * @returns {Promise<void>}
 */
export const performFullRescan = async (railgunWalletIDs = []) => {
  try {
    console.log('[ScanningService] Starting full rescan for all networks...');
    
    // Update status for all networks
    for (const networkName of Object.values(NetworkName)) {
      scanStatus.set(networkName, ScanStatus.SCANNING);
      scanProgress.set(networkName, { utxo: 0, txid: 0 });
    }
    
    // Dispatch scanning event
    window.dispatchEvent(new CustomEvent('railgun-scan-started', {
      detail: { type: 'full', walletIDs: railgunWalletIDs }
    }));
    
    await waitForRailgunReady();
    
    // ✅ Use proper chain-by-chain approach instead of the problematic rescanFullUTXOMerkletreesAndWallets
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    
    console.log('[ScanningService] Scanning each network individually with proper chain context...');
    
    // Scan each network individually to ensure proper chain context
    for (const networkName of Object.values(NetworkName)) {
      try {
        const networkConfig = NETWORK_CONFIG[networkName];
        if (!networkConfig) {
          console.warn(`[ScanningService] No network config found for ${networkName}, skipping...`);
          continue;
        }
        
        const railgunChain = networkConfig.chain;
        console.log(`[ScanningService] Scanning ${networkName} with chain ${railgunChain.type}:${railgunChain.id}...`);
        
        // Use refreshBalances for each chain individually 
        await refreshBalances(railgunChain, railgunWalletIDs);
        
        // Update status for this network
        scanStatus.set(networkName, ScanStatus.COMPLETE);
        scanProgress.set(networkName, { utxo: 100, txid: 100 });
        lastScanTime.set(networkName, Date.now());
        
        console.log(`[ScanningService] ✅ ${networkName} scan completed`);

        // 🚀 REDIS-ONLY SYNC: Execute post-transaction sync to ensure Merkletree updates are in Redis
        try {
          await executePostTransactionSyncRedis(chainId, `scan-${networkName}-${Date.now()}`);
        } catch (syncError) {
          console.warn(`[ScanningService] ⚠️ Post-transaction sync failed for ${networkName}:`, syncError);
        }

      } catch (networkError) {
        console.error(`[ScanningService] Failed to scan ${networkName}:`, networkError);
        scanStatus.set(networkName, ScanStatus.ERROR);
      }
    }
    
    console.log('[ScanningService] Full rescan completed');
    
    // Dispatch completion event
    window.dispatchEvent(new CustomEvent('railgun-scan-completed', {
      detail: { type: 'full', walletIDs: railgunWalletIDs }
    }));
    
  } catch (error) {
    console.error('[ScanningService] Full rescan failed:', error);
    
    // Update status to error for all networks
    for (const networkName of Object.values(NetworkName)) {
      scanStatus.set(networkName, ScanStatus.ERROR);
    }
    
    // Dispatch error event
    window.dispatchEvent(new CustomEvent('railgun-scan-error', {
      detail: { type: 'full', error: error.message }
    }));
    
    throw new Error(`Full rescan failed: ${error.message}`);
  }
};

/**
 * Perform rescan for specific network
 * @param {NetworkName} networkName - Network to rescan
 * @param {string[]} railgunWalletIDs - Wallet IDs to rescan
 * @returns {Promise<void>}
 */
export const performNetworkRescan = async (networkName, railgunWalletIDs = []) => {
  try {
    console.log(`[ScanningService] Starting rescan for ${networkName}...`);
    
    // Update status
    scanStatus.set(networkName, ScanStatus.SCANNING);
    scanProgress.set(networkName, { utxo: 0, txid: 0 });
    
    // Dispatch scanning event
    window.dispatchEvent(new CustomEvent('railgun-scan-started', {
      detail: { type: 'network', networkName, walletIDs: railgunWalletIDs }
    }));
    
    await waitForRailgunReady();
    
    // ✅ Use proper chain object as per official SDK pattern
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const networkConfig = NETWORK_CONFIG[networkName];
    
    if (!networkConfig) {
      throw new Error(`No network config found for ${networkName}`);
    }
    
    // Get the proper chain object from network config
    const railgunChain = networkConfig.chain;
    
    console.log(`[ScanningService] Using refreshBalances for ${networkName} with chain:`, {
      chainType: railgunChain.type,
      chainId: railgunChain.id,
      walletCount: railgunWalletIDs.length
    });
    
    // ✅ Use refreshBalances with proper chain context (following official SDK pattern)
    await refreshBalances(railgunChain, railgunWalletIDs);

    // 🚀 REDIS-ONLY: Verify Merkletree data was stored in Redis after successful scan
    if (useRedisMerkletrees && railgunWalletIDs.length > 0) {
      try {
        const chainId = railgunChain.id;
        // Check that Merkletree data exists in Redis (stored directly by LevelDB adapter)
        const hasData = await checkMerkletreeInRedis(chainId, railgunWalletIDs[0]);
        if (hasData) {
          console.log(`[ScanningService] ✅ Merkletree data confirmed in Redis for ${networkName}`);
        } else {
          console.warn(`[ScanningService] ⚠️ Merkletree data not found in Redis for ${networkName}`);
        }
      } catch (merkleError) {
        console.warn(`[ScanningService] Merkletree check in Redis failed for ${networkName}:`, merkleError.message);
        // Don't fail the scan if Merkletree check fails
      }
    }

    // Update status
    scanStatus.set(networkName, ScanStatus.COMPLETE);
    scanProgress.set(networkName, { utxo: 100, txid: 100 });
    lastScanTime.set(networkName, Date.now());

    console.log(`[ScanningService] Network rescan completed for ${networkName}`);
    
    // Dispatch completion event
    window.dispatchEvent(new CustomEvent('railgun-scan-completed', {
      detail: { type: 'network', networkName, walletIDs: railgunWalletIDs }
    }));
    
  } catch (error) {
    console.error(`[ScanningService] Network rescan failed for ${networkName}:`, error);
    
    // Update status to error
    scanStatus.set(networkName, ScanStatus.ERROR);
    
    // Dispatch error event
    window.dispatchEvent(new CustomEvent('railgun-scan-error', {
      detail: { type: 'network', networkName, error: error.message }
    }));
    
    throw new Error(`Network rescan failed for ${networkName}: ${error.message}`);
  }
};

/**
 * Perform smart rescan (only scan networks that need it)
 * @param {string[]} railgunWalletIDs - Wallet IDs to rescan
 * @param {number} maxAgeMinutes - Maximum age before considering stale
 * @returns {Promise<Object>} Results of smart rescan
 */
export const performSmartRescan = async (railgunWalletIDs = [], maxAgeMinutes = 30) => {
  try {
    console.log('[ScanningService] Starting smart rescan...');
    
    const results = {
      scanned: [],
      skipped: [],
      errors: [],
    };
    
    // Check which networks need scanning
    const networksToScan = [];
    for (const networkName of Object.values(NetworkName)) {
      if (needsScanning(networkName, maxAgeMinutes)) {
        networksToScan.push(networkName);
      } else {
        results.skipped.push(networkName);
      }
    }
    
    console.log(`[ScanningService] Networks to scan: ${networksToScan.length}, skipped: ${results.skipped.length}`);
    
    // Scan each network that needs it
    for (const networkName of networksToScan) {
      try {
        await performNetworkRescan(networkName, railgunWalletIDs);
        results.scanned.push(networkName);
      } catch (error) {
        console.error(`[ScanningService] Smart rescan failed for ${networkName}:`, error);
        results.errors.push({ networkName, error: error.message });
      }
    }
    
    console.log('[ScanningService] Smart rescan completed:', results);
    
    // Dispatch smart scan completion event
    window.dispatchEvent(new CustomEvent('railgun-smart-scan-completed', {
      detail: results
    }));
    
    return results;
    
  } catch (error) {
    console.error('[ScanningService] Smart rescan failed:', error);
    throw error;
  }
};

/**
 * Get scanning summary for all networks
 * @returns {Object} Scanning summary
 */
export const getScanningSummary = () => {
  const summary = {
    overall: {
      idle: 0,
      scanning: 0,
      complete: 0,
      error: 0,
    },
    networks: {},
  };
  
  for (const networkName of Object.values(NetworkName)) {
    const status = getScanStatus(networkName);
    const progress = getScanProgress(networkName);
    const lastScan = getLastScanTime(networkName);
    
    summary.networks[networkName] = {
      status,
      progress,
      lastScan,
      needsRescan: needsScanning(networkName),
    };
    
    // Update overall counts
    summary.overall[status] = (summary.overall[status] || 0) + 1;
  }
  
  return summary;
};

/**
 * Setup official Railgun SDK callbacks for balance updates and Merkle tree scan progress
 * ⚠️ IMPORTANT: Call this once during app startup after initializeEngine()
 * This ensures the SDK emits RailgunBalancesEvent and MerkletreeScanUpdateEvent directly into our app
 * Following official docs: https://docs.railgun.org/developer-guide/wallet/private-balances/balance-and-sync-callbacks
 */
export const setupScanningCallbacks = () => {
  console.log('[ScanningService] Setting up official Railgun SDK callbacks for real-time balance and scan updates...');
  
  // Balance update callbacks are handled centrally in sdk-callbacks.js to prevent duplicates

  // ✅ Official UTXO Merkle tree scan progress callback from Railgun SDK
  setOnUTXOMerkletreeScanCallback((event) => {
    console.log(`[ScanningService] 📊 UTXO scan progress: ${event.progress * 100}%`);
    
    // Update internal progress tracking
    const networkName = event.chain?.name;
    if (networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        utxo: event.progress * 100 || 0,
      });
    }
    
    // Dispatch custom event for UI compatibility
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: { networkName: event.chain?.name, scanData: event },
    }));
  });

  // ✅ Official TXID Merkle tree scan progress callback from Railgun SDK
  setOnTXIDMerkletreeScanCallback((event) => {
    console.log(`[ScanningService] 📊 TXID scan progress: ${event.progress * 100}%`);
    
    // Update internal progress tracking
    const networkName = event.chain?.name;
    if (networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        txid: event.progress * 100 || 0,
      });
    }
    
    // Dispatch custom event for UI compatibility
    window.dispatchEvent(new CustomEvent('railgun-txid-scan', {
      detail: { networkName: event.chain?.name, scanData: event },
    }));
  });
  
  console.log('[ScanningService] ✅ Official Railgun SDK callbacks registered - real-time balance and scan updates enabled');
};

/**
 * Reset scan status for network
 * @param {NetworkName} networkName - Network name
 */
export const resetScanStatus = (networkName) => {
  scanStatus.set(networkName, ScanStatus.IDLE);
  scanProgress.set(networkName, { utxo: 0, txid: 0 });
  lastScanTime.delete(networkName);
  
  console.log(`[ScanningService] Reset scan status for ${networkName}`);
};

/**
 * Reset all scan status
 */
export const resetAllScanStatus = () => {
  scanStatus.clear();
  scanProgress.clear();
  lastScanTime.clear();

  console.log('[ScanningService] Reset all scan status');
};

/**
 * Enable/disable centralized Redis Merkletrees
 * @param {boolean} enabled - Whether to use Redis Merkletrees
 */
export const setRedisMerkletreesEnabled = (enabled) => {
  useRedisMerkletrees = enabled;
  console.log(`[ScanningService] ${enabled ? 'Enabled' : 'Disabled'} Redis Merkletrees for proof generation`);

  if (!enabled) {
    // Clear Redis cache when disabled
    redisMerkletreeCache.clear();
  }
};

/**
 * Check if Redis Merkletrees are enabled
 * @returns {boolean} Whether Redis Merkletrees are enabled
 */
export const areRedisMerkletreesEnabled = () => {
  return useRedisMerkletrees;
};

/**
 * Get Redis Merkletree adapter for a chain and tree type
 * @param {number} chainId - Chain ID
 * @param {string} treeType - 'utxo' or 'txid'
 * @returns {Object|null} Redis Merkletree adapter or null if disabled/unavailable
 */
export const getRedisMerkletreeAdapter = async (chainId, treeType) => {
  if (!useRedisMerkletrees) {
    return null;
  }

  // Check cache first
  const chainCache = redisMerkletreeCache.get(chainId);
  if (chainCache && chainCache[treeType]) {
    return chainCache[treeType];
  }

  // Check if Redis Merkletree is available and synced
  const availability = await isRedisMerkletreeAvailable(chainId, treeType);
  if (!availability.available) {
    console.warn(`[ScanningService] Redis Merkletree not available for chain ${chainId} ${treeType}:`, availability);
    return null;
  }

  // Create and cache adapter
  const adapter = createRedisMerkletree(chainId, treeType);

  if (!chainCache) {
    redisMerkletreeCache.set(chainId, {});
  }

  redisMerkletreeCache.get(chainId)[treeType] = adapter;

  console.log(`[ScanningService] ✅ Created Redis Merkletree adapter for chain ${chainId} ${treeType}`);
  return adapter;
};

/**
 * Sync scanned Merkletree data to Redis (called after successful balance scan)
 * @param {number} chainId - Chain ID
 * @param {string} walletId - Wallet that triggered the scan
 * @returns {Promise<boolean>} Success status
 */
export const checkMerkletreeInRedis = async (chainId, walletId) => {
  if (!useRedisMerkletrees) {
    return false;
  }

  try {
    console.log(`[ScanningService] 🔍 Checking Merkletree in Redis for chain ${chainId}...`);

    // Since Redis is now primary storage, the balance scan already wrote directly to Redis
    // We just need to verify the data exists
    const redisAdapter = await getRedisMerkletreeAdapter(chainId, 'utxo');
    if (!redisAdapter) {
      console.warn(`[ScanningService] Redis adapter not available for chain ${chainId}`);
      return false;
    }

    // Check if tree has height > 0 (indicating it was populated)
    const height = await redisAdapter.getTreeLength();
    const hasData = height > 0;

    if (hasData) {
      console.log(`[ScanningService] ✅ Merkletree data found in Redis for chain ${chainId} (height: ${height})`);
    } else {
      console.log(`[ScanningService] 📝 Merkletree data not yet available in Redis for chain ${chainId}`);
    }

    return hasData;

  } catch (error) {
    console.error(`[ScanningService] ❌ Failed to check Merkletree in Redis for chain ${chainId}:`, error);
    return false;
  }
};

export default {
  ScanStatus,
  getRailgunNetworkName,
  getScanStatus,
  getScanProgress,
  getLastScanTime,
  needsScanning,
  getMerkletreeHistoryVersions,
  performFullRescan,
  performNetworkRescan,
  performSmartRescan,
  getScanningSummary,
  setupScanningCallbacks,
  resetScanStatus,
  resetAllScanStatus,
  // Centralized Merkletree functions
  setRedisMerkletreesEnabled,
  areRedisMerkletreesEnabled,
  getRedisMerkletreeAdapter,
  checkMerkletreeInRedis,
}; 