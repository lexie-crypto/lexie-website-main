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
// Balance update callbacks are handled centrally in sdk-callbacks.js

/**
 * Scan status tracking
 */
let scanStatus = new Map(); // networkName -> status
let scanProgress = new Map(); // networkName -> { utxo: number, txid: number }
let lastScanTime = new Map(); // networkName -> timestamp

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
        
        // 🚀 BLOCK-RANGE SCANNING: Use optimized refresh with creation blocks
        if (railgunWalletIDs.length === 1) {
          // Single wallet - try to get creation blocks for optimization
          try {
            // We don't have wallet address here, so skip creation block optimization for rescans
            // Creation blocks are most important for initial scans, less critical for rescans
            console.log(`[ScanningService] Using standard refresh for ${networkName} (rescans don't use creation blocks)`);
            await refreshBalances(railgunChain, railgunWalletIDs);
          } catch (error) {
            console.warn(`[ScanningService] Standard refresh failed for ${networkName}:`, error.message);
            throw error;
          }
        } else {
          // Multiple wallets - use standard refresh
          console.log(`[ScanningService] Using standard refresh for ${networkName} (${railgunWalletIDs.length} wallets)`);
          await refreshBalances(railgunChain, railgunWalletIDs);
        }
        
        // Update status for this network
        scanStatus.set(networkName, ScanStatus.COMPLETE);
        scanProgress.set(networkName, { utxo: 100, txid: 100 });
        lastScanTime.set(networkName, Date.now());
        
        console.log(`[ScanningService] ✅ ${networkName} scan completed`);
        
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
    
    // 🚀 BLOCK-RANGE SCANNING: Use optimized refresh with creation blocks
    if (railgunWalletIDs.length === 1) {
      // Single wallet - could optimize with creation blocks if we had wallet address
      console.log(`[ScanningService] Using standard refresh for ${networkName} (single wallet rescan)`);
      await refreshBalances(railgunChain, railgunWalletIDs);
    } else {
      // Multiple wallets - use standard refresh
      console.log(`[ScanningService] Using standard refresh for ${networkName} (${railgunWalletIDs.length} wallets)`);
      await refreshBalances(railgunChain, railgunWalletIDs);
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
    // Handle completion status - treat 'Complete' as 100% progress
    const progressPercent = event.scanStatus === 'Complete'
      ? 100
      : (event.progress * 100 || 0);

    console.log(`[ScanningService] 📊 UTXO scan progress: ${progressPercent}%`);

    // Update internal progress tracking
    const networkName = event.chain?.name;
    if (networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        utxo: progressPercent,
      });

      // Update overall scan status if complete
      if (event.scanStatus === 'Complete') {
        scanStatus.set(networkName, ScanStatus.COMPLETE);
        lastScanTime.set(networkName, Date.now());
      }
    }

    // Dispatch custom event for UI compatibility
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: { networkName: event.chain?.name, scanData: event },
    }));
  });

  // ✅ Official TXID Merkle tree scan progress callback from Railgun SDK
  setOnTXIDMerkletreeScanCallback((event) => {
    // Handle completion status - treat 'Complete' as 100% progress
    const progressPercent = event.scanStatus === 'Complete'
      ? 100
      : (event.progress * 100 || 0);

    console.log(`[ScanningService] 📊 TXID scan progress: ${progressPercent}%`);

    // Update internal progress tracking
    const networkName = event.chain?.name;
    if (networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        txid: progressPercent,
      });

      // Update overall scan status if complete
      if (event.scanStatus === 'Complete') {
        scanStatus.set(networkName, ScanStatus.COMPLETE);
        lastScanTime.set(networkName, Date.now());

        // 🔓 Notify WalletContext that scan is complete for this chain
        if (progressPercent === 100 && event.chain?.id) {
          console.log(`[ScanningService] 🎯 TXID scan complete for chain ${event.chain.id}, notifying WalletContext`);

          // Set the global flag that WalletContext monitors for Redis persistence and modal unlocking
          if (typeof window !== 'undefined') {
            window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
            window.__RAILGUN_INITIAL_SCAN_DONE[event.chain.id] = true;

            // Dispatch event to notify WalletContext immediately
            window.dispatchEvent(new CustomEvent('railgun-txid-scan-complete', {
              detail: { chainId: event.chain.id, networkName }
            }));
          }
        }
      }
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
}; 