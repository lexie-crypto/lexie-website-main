/**
 * RAILGUN Scanning Service
 * Manages Merkle tree scanning, sync status, and scan optimization
 * Based on official RAILGUN SDK patterns
 */

import {
  NetworkName,
  TXIDVersion,
  isDefined,
} from '@railgun-community/shared-models';
import {
  rescanFullUTXOMerkletreesAndWallets,
  fullRescanUTXOMerkletreesAndWalletsForNetwork,
  getUTXOMerkletreeHistoryVersion,
  getTXIDMerkletreeHistoryVersion,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';

/**
 * Scan status tracking
 */
let scanStatus = new Map(); // networkName -> status
let scanProgress = new Map(); // networkName -> { utxo: number, txid: number }
let lastScanTime = new Map(); // networkName -> timestamp

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
    await rescanFullUTXOMerkletreesAndWallets(railgunWalletIDs);
    
    // Update status for all networks
    for (const networkName of Object.values(NetworkName)) {
      scanStatus.set(networkName, ScanStatus.COMPLETE);
      scanProgress.set(networkName, { utxo: 100, txid: 100 });
      lastScanTime.set(networkName, Date.now());
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
    await fullRescanUTXOMerkletreesAndWalletsForNetwork(networkName, railgunWalletIDs);
    
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
 * Setup scanning progress callbacks
 */
export const setupScanningCallbacks = () => {
  // Listen for UTXO scan progress
  window.addEventListener('railgun-utxo-scan', (event) => {
    const { networkName, scanData } = event.detail;
    
    if (scanData && networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        utxo: scanData.progressPercent || 0,
      });
      
      console.log(`[ScanningService] UTXO scan progress for ${networkName}: ${scanData.progressPercent}%`);
    }
  });
  
  // Listen for TXID scan progress
  window.addEventListener('railgun-txid-scan', (event) => {
    const { networkName, scanData } = event.detail;
    
    if (scanData && networkName) {
      const currentProgress = getScanProgress(networkName);
      scanProgress.set(networkName, {
        ...currentProgress,
        txid: scanData.progressPercent || 0,
      });
      
      console.log(`[ScanningService] TXID scan progress for ${networkName}: ${scanData.progressPercent}%`);
    }
  });
  
  console.log('[ScanningService] Scanning callbacks setup complete');
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