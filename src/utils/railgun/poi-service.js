/**
 * RAILGUN POI (Proof of Innocence) Service
 * Provides utilities for generating and managing POI proofs
 * Based on official RAILGUN SDK patterns
 */

import {
  NetworkName,
  TXIDVersion,
  POIStatus,
  BlindedCommitmentData,
  POIProof,
  isDefined,
} from '@railgun-community/shared-models';
import {
  refreshPOIsForTXIDVersion,
  refreshPOIsForAllTXIDVersions,
  getPOILaunchBlock,
  isRequiredPOIListsLoaded,
  deletePOIs,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';

/**
 * POI Status tracking
 */
let poiStatus = new Map(); // networkName -> status
let poiProgress = new Map(); // networkName -> progress

/**
 * Check if POI is required for a network
 * @param {NetworkName} networkName - Network name
 * @returns {boolean} Whether POI is required
 */
export const isPOIRequired = (networkName) => {
  try {
    // POI is typically required for mainnet networks
    switch (networkName) {
      case NetworkName.Ethereum:
      case NetworkName.Arbitrum:
      case NetworkName.Polygon:
      case NetworkName.BNBChain:
        return true;
      default:
        return false; // Testnets typically don't require POI
    }
  } catch (error) {
    console.error('[POIService] Error checking POI requirement:', error);
    return false;
  }
};

/**
 * Get POI launch block for network
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<number|undefined>} POI launch block number
 */
export const getPOILaunchBlockNumber = async (networkName) => {
  try {
    await waitForRailgunReady();
    
    if (!isPOIRequired(networkName)) {
      return undefined;
    }
    
    const launchBlock = getPOILaunchBlock(networkName);
    console.log(`[POIService] POI launch block for ${networkName}: ${launchBlock}`);
    
    return launchBlock;
    
  } catch (error) {
    console.error(`[POIService] Failed to get POI launch block for ${networkName}:`, error);
    return undefined;
  }
};

/**
 * Check if POI lists are loaded for network
 * @param {NetworkName} networkName - Network name
 * @param {TXIDVersion} txidVersion - TXID version
 * @returns {Promise<boolean>} Whether POI lists are loaded
 */
export const arePOIListsLoaded = async (networkName, txidVersion = TXIDVersion.V2_PoseidonMerkle) => {
  try {
    await waitForRailgunReady();
    
    if (!isPOIRequired(networkName)) {
      return true; // Consider loaded if not required
    }
    
    const isLoaded = await isRequiredPOIListsLoaded(networkName, txidVersion);
    
    console.log(`[POIService] POI lists loaded for ${networkName} (${txidVersion}): ${isLoaded}`);
    return isLoaded;
    
  } catch (error) {
    console.error(`[POIService] Error checking POI lists for ${networkName}:`, error);
    return false;
  }
};

/**
 * Refresh POI lists for specific TXID version
 * @param {NetworkName} networkName - Network name
 * @param {TXIDVersion} txidVersion - TXID version to refresh
 * @returns {Promise<void>}
 */
export const refreshPOIForTXIDVersion = async (networkName, txidVersion = TXIDVersion.V2_PoseidonMerkle) => {
  try {
    await waitForRailgunReady();
    
    if (!isPOIRequired(networkName)) {
      console.log(`[POIService] POI not required for ${networkName}, skipping refresh`);
      return;
    }
    
    console.log(`[POIService] Refreshing POI for ${networkName} (${txidVersion})...`);
    
    // Update status
    poiStatus.set(networkName, POIStatus.Loading);
    poiProgress.set(networkName, 0);
    
    // Dispatch loading event
    window.dispatchEvent(new CustomEvent('railgun-poi-loading', {
      detail: { networkName, txidVersion, status: POIStatus.Loading }
    }));
    
    await refreshPOIsForTXIDVersion(networkName, txidVersion);
    
    // Update status
    poiStatus.set(networkName, POIStatus.Valid);
    poiProgress.set(networkName, 100);
    
    console.log(`[POIService] POI refresh completed for ${networkName} (${txidVersion})`);
    
    // Dispatch completion event
    window.dispatchEvent(new CustomEvent('railgun-poi-loaded', {
      detail: { networkName, txidVersion, status: POIStatus.Valid }
    }));
    
  } catch (error) {
    console.error(`[POIService] POI refresh failed for ${networkName}:`, error);
    
    // Update status to error
    poiStatus.set(networkName, POIStatus.Invalid);
    
    // Dispatch error event
    window.dispatchEvent(new CustomEvent('railgun-poi-error', {
      detail: { networkName, txidVersion, error: error.message }
    }));
    
    throw new Error(`POI refresh failed for ${networkName}: ${error.message}`);
  }
};

/**
 * Refresh POI lists for all TXID versions
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<void>}
 */
export const refreshAllPOIs = async (networkName) => {
  try {
    await waitForRailgunReady();
    
    if (!isPOIRequired(networkName)) {
      console.log(`[POIService] POI not required for ${networkName}, skipping refresh`);
      return;
    }
    
    console.log(`[POIService] Refreshing all POIs for ${networkName}...`);
    
    // Update status
    poiStatus.set(networkName, POIStatus.Loading);
    
    await refreshPOIsForAllTXIDVersions(networkName);
    
    // Update status
    poiStatus.set(networkName, POIStatus.Valid);
    
    console.log(`[POIService] All POIs refreshed for ${networkName}`);
    
  } catch (error) {
    console.error(`[POIService] Failed to refresh all POIs for ${networkName}:`, error);
    poiStatus.set(networkName, POIStatus.Invalid);
    throw error;
  }
};

/**
 * Delete POI data for network
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<void>}
 */
export const deletePOIData = async (networkName) => {
  try {
    await waitForRailgunReady();
    
    console.log(`[POIService] Deleting POI data for ${networkName}...`);
    
    await deletePOIs(networkName);
    
    // Clear status
    poiStatus.delete(networkName);
    poiProgress.delete(networkName);
    
    console.log(`[POIService] POI data deleted for ${networkName}`);
    
    // Dispatch deletion event
    window.dispatchEvent(new CustomEvent('railgun-poi-deleted', {
      detail: { networkName }
    }));
    
  } catch (error) {
    console.error(`[POIService] Failed to delete POI data for ${networkName}:`, error);
    throw error;
  }
};

/**
 * Get POI status for network
 * @param {NetworkName} networkName - Network name
 * @returns {POIStatus} Current POI status
 */
export const getPOIStatus = (networkName) => {
  if (!isPOIRequired(networkName)) {
    return POIStatus.Valid; // Consider valid if not required
  }
  
  return poiStatus.get(networkName) || POIStatus.Unknown;
};

/**
 * Get POI loading progress for network
 * @param {NetworkName} networkName - Network name
 * @returns {number} Progress percentage (0-100)
 */
export const getPOIProgress = (networkName) => {
  return poiProgress.get(networkName) || 0;
};

/**
 * Initialize POI for multiple networks
 * @param {NetworkName[]} networkNames - Networks to initialize
 * @returns {Promise<Map<NetworkName, boolean>>} Success status for each network
 */
export const initializePOIForNetworks = async (networkNames) => {
  const results = new Map();
  
  console.log('[POIService] Initializing POI for networks:', networkNames);
  
  for (const networkName of networkNames) {
    try {
      if (isPOIRequired(networkName)) {
        await refreshPOIForTXIDVersion(networkName, TXIDVersion.V2_PoseidonMerkle);
        results.set(networkName, true);
      } else {
        results.set(networkName, true); // Consider successful if not required
      }
    } catch (error) {
      console.error(`[POIService] Failed to initialize POI for ${networkName}:`, error);
      results.set(networkName, false);
    }
  }
  
  console.log('[POIService] POI initialization complete:', results);
  return results;
};

/**
 * Setup POI event listeners
 */
export const setupPOIEventListeners = () => {
  // You can add custom POI event listeners here
  console.log('[POIService] POI event listeners setup complete');
};

/**
 * Get POI summary for all networks
 * @returns {Object} Summary of POI status across networks
 */
export const getPOISummary = () => {
  const summary = {};
  
  for (const networkName of Object.values(NetworkName)) {
    if (isPOIRequired(networkName)) {
      summary[networkName] = {
        status: getPOIStatus(networkName),
        progress: getPOIProgress(networkName),
        required: true,
      };
    } else {
      summary[networkName] = {
        status: POIStatus.Valid,
        progress: 100,
        required: false,
      };
    }
  }
  
  return summary;
};

export default {
  isPOIRequired,
  getPOILaunchBlockNumber,
  arePOIListsLoaded,
  refreshPOIForTXIDVersion,
  refreshAllPOIs,
  deletePOIData,
  getPOIStatus,
  getPOIProgress,
  initializePOIForNetworks,
  setupPOIEventListeners,
  getPOISummary,
}; 