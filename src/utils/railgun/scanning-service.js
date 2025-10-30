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
import { unlockModalOnce } from './modalUnlock.js';
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
 * Get human-readable network name for chain ID (like WalletContext)
 * @param {number} chainId - Chain ID
 * @returns {string} Human-readable network name
 */
export const getHumanNetworkName = (chainId) => {
  const networkNames = {
    1: 'Ethereum',
    137: 'Polygon',
    42161: 'Arbitrum',
    56: 'BNB Chain'
  };
  return networkNames[chainId] || `Chain ${chainId}`;
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
 * Check if a chain has been marked as scanned in Redis, and mark it if not
 * @param {number} chainId - Chain ID to check and mark
 * @param {string} networkName - Network name for logging
 * @returns {Promise<void>}
 */
const checkAndMarkChainScanned = async (chainId, networkName) => {
  try {
    // Get human-readable network name for logging (like WalletContext)
    const humanNetworkName = getHumanNetworkName(chainId);

    // Get current wallet info from global context
    const walletAddress = window.__LEXIE_WALLET_ADDRESS;
    const walletId = window.__LEXIE_WALLET_ID;
    const railgunAddress = window.__LEXIE_RAILGUN_ADDRESS;

    if (!walletAddress || !walletId || !railgunAddress) {
      console.warn('[ScanningService] ⚠️ Wallet info not available for Redis check, skipping scan marking');
      // Still unlock modal as scan completed
      unlockModalOnce(chainId, 'scan complete (wallet info unavailable)');
      return;
    }

    console.log(`[ScanningService] 🔍 Checking if chain ${chainId} (${humanNetworkName}) has been marked as scanned in Redis...`);

    // First, try to get current wallet metadata to check scannedChains
    try {
      const metadataResp = await fetch(`/api/wallet-metadata?action=get-wallet-metadata&walletAddress=${encodeURIComponent(walletAddress)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (metadataResp.ok) {
        const metadata = await metadataResp.json();
        const scannedChains = metadata?.scannedChains || [];

        console.log(`[ScanningService] 📊 Current scannedChains from Redis:`, scannedChains);

        // Check if chain is already marked as scanned
        if (scannedChains.includes(chainId)) {
          console.log(`[ScanningService] ✅ Chain ${chainId} (${humanNetworkName}) already marked as scanned, unlocking modal`);
          unlockModalOnce(chainId, 'scan complete (already marked)');
          return;
        }

        console.log(`[ScanningService] 📝 Chain ${chainId} (${humanNetworkName}) not yet marked as scanned, marking now...`);
      } else {
        console.warn(`[ScanningService] ⚠️ Failed to get wallet metadata (${metadataResp.status}), proceeding with marking`);
      }
    } catch (metadataError) {
      console.warn('[ScanningService] ⚠️ Error fetching wallet metadata:', metadataError.message);
      console.log('[ScanningService] 📝 Proceeding with marking chain as scanned despite metadata fetch error');
    }

    // Mark chain as scanned in Redis
    console.log(`[ScanningService] 💾 Marking chain ${chainId} (${humanNetworkName}) as scanned in Redis...`);

    const scanResp = await fetch('/api/wallet-metadata?action=persist-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        walletId,
        railgunAddress,
        scannedChains: [chainId] // Mark this chain as scanned
      })
    });

    if (scanResp.ok) {
      console.log(`[ScanningService] ✅ Successfully marked chain ${chainId} (${humanNetworkName}) as scanned in Redis`);
    } else {
      console.warn(`[ScanningService] ⚠️ Failed to mark chain ${chainId} as scanned (${scanResp.status}):`, await scanResp.text());
    }

    // Always unlock the modal after scan completion
    console.log(`[ScanningService] 🔓 Unlocking modal for chain ${chainId} (${humanNetworkName})`);
    unlockModalOnce(chainId, 'scan complete');

  } catch (error) {
    console.error(`[ScanningService] ❌ Error in checkAndMarkChainScanned for chain ${chainId}:`, error);
    // Still unlock modal on error to prevent stuck state
    unlockModalOnce(chainId, 'scan complete (error recovery)');
  }
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

    // Update internal progress tracking - use chain.id and map to network name like WalletContext
    const chainId = event.chain?.id;
    const networkName = chainId ? getRailgunNetworkName(chainId) : null;

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

        // 🔓 Check Redis to see if chain has been marked as scanned, if not mark it and unlock modal
        console.log(`[ScanningService] 🎯 UTXO scan complete for chain ${chainId}, checking Redis scan status`);

        // Run async check and marking in background (don't block the scan callback)
        checkAndMarkChainScanned(chainId, networkName).catch(error => {
          console.error('[ScanningService] ❌ Error checking/marking chain as scanned:', error);
        });
      }
    }

    // Dispatch custom event for UI compatibility
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: { networkName, chainId, scanData: event },
    }));
  });

  // ✅ Official TXID Merkle tree scan progress callback from Railgun SDK
  setOnTXIDMerkletreeScanCallback((event) => {
    // Handle completion status - treat 'Complete' as 100% progress
    const progressPercent = event.scanStatus === 'Complete'
      ? 100
      : (event.progress * 100 || 0);

    console.log(`[ScanningService] 📊 TXID scan progress: ${progressPercent}%`);

    // Update internal progress tracking - use chain.id and map to network name like WalletContext
    const chainId = event.chain?.id;
    const networkName = chainId ? getRailgunNetworkName(chainId) : null;

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

        // 🔓 Check Redis to see if chain has been marked as scanned, if not mark it and unlock modal
        console.log(`[ScanningService] 🎯 TXID scan complete for chain ${chainId}, checking Redis scan status`);

        // Run async check and marking in background (don't block the scan callback)
        checkAndMarkChainScanned(chainId, networkName).catch(error => {
          console.error('[ScanningService] ❌ Error checking/marking chain as scanned:', error);
        });
      }
    }

    // Dispatch custom event for UI compatibility
    window.dispatchEvent(new CustomEvent('railgun-txid-scan', {
      detail: { networkName, chainId, scanData: event },
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
  getHumanNetworkName,
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