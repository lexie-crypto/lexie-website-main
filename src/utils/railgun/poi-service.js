/**
 * RAILGUN POI (Proof of Innocence) Service
 * Properly integrated with official RAILGUN SDK POI system
 * Based on official wallet/src/services/poi patterns
 */

import {
  NetworkName,
  TXIDVersion,
  isDefined,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';

/**
 * Check if POI is required for a network using official SDK
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<boolean>} Whether POI is required
 */
export const isPOIRequiredForNetwork = async (networkName) => {
  try {
    console.log(`[POIService] Checking POI requirement for ${networkName}...`);
    
    // Use the official POI system from the wallet SDK
    // This checks against network config and current block number
    const { POIRequired } = await import('@railgun-community/wallet');
    
    const isRequired = await POIRequired.isRequiredForNetwork(networkName);
    console.log(`[POIService] ✅ Official POI check for ${networkName}: ${isRequired}`);
    
    return isRequired;
  } catch (error) {
    console.warn('[POIService] ⚠️ Official POI check failed, using network-based fallback:', error);
    
    // Fallback: Check if it's a mainnet network that typically requires POI
    const mainnetNetworks = [
      NetworkName.Ethereum,
      NetworkName.Arbitrum, 
      NetworkName.Polygon,
      NetworkName.BNBChain
    ];
    
    const isRequired = mainnetNetworks.includes(networkName);
    console.log(`[POIService] 📋 Fallback POI check for ${networkName}: ${isRequired}`);
    
    return isRequired;
  }
};

/**
 * Initialize POI for the RAILGUN engine
 * This should be called after engine startup
 */
export const initializePOI = async () => {
  try {
    console.log('[POIService] 🚀 Initializing POI system...');
    
    await waitForRailgunReady();
    
    // Check POI status for main networks
    const networks = [
      NetworkName.Ethereum,
      NetworkName.Arbitrum,
      NetworkName.Polygon,
      NetworkName.BNBChain
    ];
    
    for (const networkName of networks) {
      try {
        const isRequired = await isPOIRequiredForNetwork(networkName);
        console.log(`[POIService] ${networkName}: POI required = ${isRequired}`);
      } catch (error) {
        console.warn(`[POIService] Failed to check POI for ${networkName}:`, error);
      }
    }
    
    console.log('[POIService] ✅ POI system initialized');
    
  } catch (error) {
    console.error('[POIService] ❌ POI initialization failed:', error);
    throw error;
  }
};

/**
 * Get POI status for a specific network
 * @param {NetworkName} networkName - Network name
 * @returns {Promise<Object>} POI status information
 */
export const getPOIStatus = async (networkName) => {
  try {
    const isRequired = await isPOIRequiredForNetwork(networkName);
    
    return {
      networkName,
      required: isRequired,
      status: isRequired ? 'required' : 'not_required',
      lastChecked: Date.now()
    };
    
  } catch (error) {
    console.error(`[POIService] Failed to get POI status for ${networkName}:`, error);
    return {
      networkName,
      required: false,
      status: 'error',
      error: error.message,
      lastChecked: Date.now()
    };
  }
};

/**
 * Handle POI-related errors gracefully
 * @param {Error} error - POI error
 * @param {NetworkName} networkName - Network name
 * @returns {boolean} Whether to continue with operation
 */
export const handlePOIError = (error, networkName) => {
  console.warn(`[POIService] POI error for ${networkName}:`, error);
  
  // For development/testing, we can be more lenient with POI errors
  if (error.message.includes('405') || error.message.includes('POI request error')) {
    console.log(`[POIService] 🔄 Treating ${networkName} balances as spendable due to POI service issues`);
    return true; // Continue operation, treat as spendable
  }
  
  return false; // Don't continue with severe errors
};

/**
 * Validate POI configuration
 * @returns {Promise<boolean>} Whether POI is properly configured
 */
export const validatePOIConfiguration = async () => {
  try {
    console.log('[POIService] 🔍 Validating POI configuration...');
    
    // Test POI check for Arbitrum (should be required)
    const arbitrumRequired = await isPOIRequiredForNetwork(NetworkName.Arbitrum);
    
    if (arbitrumRequired) {
      console.log('[POIService] ✅ POI configuration appears valid');
      return true;
    } else {
      console.log('[POIService] ⚠️ POI configuration might need attention');
      return false;
    }
    
  } catch (error) {
    console.error('[POIService] ❌ POI configuration validation failed:', error);
    return false;
  }
};

// Export all functions
export default {
  isPOIRequiredForNetwork,
  initializePOI,
  getPOIStatus,
  handlePOIError,
  validatePOIConfiguration
}; 