/**
 * RAILGUN Wallet Management
 * Following official docs: https://docs.railgun.org/developer-guide/wallet/private-wallets/railgun-wallets
 * 
 * Implements:
 * - RAILGUN wallet creation and management
 * - Encryption key derivation
 * - View-only wallet support
 * - Wallet import/export
 */

import {
  createRailgunWallet,
  loadRailgunWalletByID,
  unloadRailgunWallet,
  RailgunWallet,
  validateRailgunAddress,
  getWalletMnemonic,
  getWalletAddress,
  generateRailgunWalletShareableViewingKey,
  loadRailgunWalletViewOnly,
} from '@railgun-community/wallet';
import { NetworkName } from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';

// Wallet storage
let activeWallets = new Map();
let currentWalletID = null;

/**
 * Generate encryption key from user signature
 * Following encryption key documentation
 * @param {string} signature - User's signature for key derivation
 * @param {string} address - User's address for additional entropy
 * @returns {string} Derived encryption key
 */
export const deriveEncryptionKey = (signature, address) => {
  try {
    // Create deterministic key from signature and address
    const encoder = new TextEncoder();
    const signatureBytes = encoder.encode(signature);
    const addressBytes = encoder.encode(address.toLowerCase());
    
    // Combine signature and address for entropy
    const combined = new Uint8Array(signatureBytes.length + addressBytes.length);
    combined.set(signatureBytes, 0);
    combined.set(addressBytes, signatureBytes.length);
    
    // Use crypto.subtle to derive key (browser environment)
    return crypto.subtle.importKey(
      'raw',
      combined,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ).then(key => {
      return crypto.subtle.sign('HMAC', key, combined);
    }).then(signature => {
      // Convert to hex string
      const hashArray = Array.from(new Uint8Array(signature));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
  } catch (error) {
    console.error('[RailgunWallet] Failed to derive encryption key:', error);
    throw new Error('Failed to derive encryption key');
  }
};

/**
 * Create a new RAILGUN wallet
 * @param {string} encryptionKey - Encryption key for wallet
 * @param {string} mnemonic - Optional mnemonic (generates new one if not provided)
 * @param {number} creationBlockNumber - Optional creation block number
 * @returns {Object} Wallet creation result
 */
export const createWallet = async (encryptionKey, mnemonic = null, creationBlockNumber = null) => {
  try {
    await waitForRailgunReady();
    
    console.log('[RailgunWallet] Creating new RAILGUN wallet...');
    
    const result = await createRailgunWallet(
      encryptionKey,
      mnemonic,
      creationBlockNumber
    );
    
    const walletID = result.id;
    const railgunAddress = result.railgunAddress;
    
    // Store wallet info
    activeWallets.set(walletID, {
      id: walletID,
      railgunAddress,
      encryptionKey,
      createdAt: Date.now(),
      isViewOnly: false,
    });
    
    currentWalletID = walletID;
    
    console.log('[RailgunWallet] Wallet created:', {
      walletID: walletID.slice(0, 8) + '...',
      railgunAddress: railgunAddress.slice(0, 10) + '...',
    });
    
    return {
      walletID,
      railgunAddress,
      mnemonic: result.mnemonic,
    };
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to create wallet:', error);
    throw new Error(`Wallet creation failed: ${error.message}`);
  }
};

/**
 * Load existing RAILGUN wallet by ID
 * @param {string} walletID - Wallet ID to load
 * @param {string} encryptionKey - Encryption key for wallet
 * @returns {Object} Loaded wallet info
 */
export const loadWallet = async (walletID, encryptionKey) => {
  try {
    await waitForRailgunReady();
    
    console.log('[RailgunWallet] Loading wallet:', walletID.slice(0, 8) + '...');
    
    const railgunWallet = await loadRailgunWalletByID(
      encryptionKey,
      walletID,
      false // isViewOnlyWallet
    );
    
    const railgunAddress = railgunWallet.getAddress();
    
    // Store wallet info
    activeWallets.set(walletID, {
      id: walletID,
      railgunAddress,
      encryptionKey,
      loadedAt: Date.now(),
      isViewOnly: false,
    });
    
    currentWalletID = walletID;
    
    console.log('[RailgunWallet] Wallet loaded:', {
      walletID: walletID.slice(0, 8) + '...',
      railgunAddress: railgunAddress.slice(0, 10) + '...',
    });
    
    return {
      walletID,
      railgunAddress,
    };
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to load wallet:', error);
    throw new Error(`Wallet loading failed: ${error.message}`);
  }
};

/**
 * Load view-only wallet using shareable viewing key
 * @param {string} shareableViewingKey - Shareable viewing key
 * @param {number} creationBlockNumber - Block number when wallet was created
 * @returns {Object} View-only wallet info
 */
export const loadViewOnlyWallet = async (shareableViewingKey, creationBlockNumber) => {
  try {
    await waitForRailgunReady();
    
    console.log('[RailgunWallet] Loading view-only wallet...');
    
    const result = await loadRailgunWalletViewOnly(
      shareableViewingKey,
      creationBlockNumber
    );
    
    const walletID = result.id;
    const railgunAddress = result.railgunAddress;
    
    // Store wallet info
    activeWallets.set(walletID, {
      id: walletID,
      railgunAddress,
      creationBlockNumber,
      loadedAt: Date.now(),
      isViewOnly: true,
    });
    
    console.log('[RailgunWallet] View-only wallet loaded:', {
      walletID: walletID.slice(0, 8) + '...',
      railgunAddress: railgunAddress.slice(0, 10) + '...',
    });
    
    return {
      walletID,
      railgunAddress,
    };
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to load view-only wallet:', error);
    throw new Error(`View-only wallet loading failed: ${error.message}`);
  }
};

/**
 * Generate shareable viewing key for a wallet
 * @param {string} walletID - Wallet ID
 * @returns {string} Shareable viewing key
 */
export const generateViewingKey = async (walletID) => {
  try {
    await waitForRailgunReady();
    
    const shareableViewingKey = await generateRailgunWalletShareableViewingKey(walletID);
    
    console.log('[RailgunWallet] Generated viewing key for wallet:', walletID.slice(0, 8) + '...');
    
    return shareableViewingKey;
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to generate viewing key:', error);
    throw new Error(`Viewing key generation failed: ${error.message}`);
  }
};

/**
 * Unload a RAILGUN wallet from memory
 * @param {string} walletID - Wallet ID to unload
 */
export const unloadWallet = async (walletID) => {
  try {
    await unloadRailgunWallet(walletID);
    activeWallets.delete(walletID);
    
    if (currentWalletID === walletID) {
      currentWalletID = null;
    }
    
    console.log('[RailgunWallet] Wallet unloaded:', walletID.slice(0, 8) + '...');
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to unload wallet:', error);
    throw new Error(`Wallet unloading failed: ${error.message}`);
  }
};

/**
 * Validate a RAILGUN address
 * @param {string} railgunAddress - Address to validate
 * @returns {boolean} True if valid
 */
export const isValidRailgunAddress = (railgunAddress) => {
  try {
    return validateRailgunAddress(railgunAddress);
  } catch (error) {
    console.error('[RailgunWallet] Address validation failed:', error);
    return false;
  }
};

/**
 * Get current active wallet ID
 * @returns {string|null} Current wallet ID
 */
export const getCurrentWalletID = () => {
  return currentWalletID;
};

/**
 * Get current active wallet info
 * @returns {Object|null} Current wallet info
 */
export const getCurrentWallet = () => {
  if (!currentWalletID) {
    return null;
  }
  return activeWallets.get(currentWalletID) || null;
};

/**
 * Set current active wallet
 * @param {string} walletID - Wallet ID to set as current
 */
export const setCurrentWallet = (walletID) => {
  if (activeWallets.has(walletID)) {
    currentWalletID = walletID;
    console.log('[RailgunWallet] Set current wallet:', walletID.slice(0, 8) + '...');
  } else {
    throw new Error(`Wallet not found: ${walletID}`);
  }
};

/**
 * Get all loaded wallets
 * @returns {Array} Array of wallet info objects
 */
export const getAllWallets = () => {
  return Array.from(activeWallets.values());
};

/**
 * Get wallet info by ID
 * @param {string} walletID - Wallet ID
 * @returns {Object|null} Wallet info or null if not found
 */
export const getWalletInfo = (walletID) => {
  return activeWallets.get(walletID) || null;
};

/**
 * Get wallet mnemonic (for backup)
 * @param {string} walletID - Wallet ID
 * @param {string} encryptionKey - Encryption key
 * @returns {string} Wallet mnemonic
 */
export const getWalletBackup = async (walletID, encryptionKey) => {
  try {
    await waitForRailgunReady();
    
    const mnemonic = await getWalletMnemonic(walletID, encryptionKey);
    
    console.log('[RailgunWallet] Retrieved wallet backup for:', walletID.slice(0, 8) + '...');
    
    return mnemonic;
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to get wallet backup:', error);
    throw new Error(`Wallet backup failed: ${error.message}`);
  }
};

/**
 * Clear all wallets (logout)
 */
export const clearAllWallets = async () => {
  try {
    // Unload all wallets
    for (const walletID of activeWallets.keys()) {
      await unloadWallet(walletID);
    }
    
    activeWallets.clear();
    currentWalletID = null;
    
    console.log('[RailgunWallet] All wallets cleared');
    
  } catch (error) {
    console.error('[RailgunWallet] Failed to clear wallets:', error);
    throw error;
  }
};

// Export for use in other modules
export default {
  deriveEncryptionKey,
  createWallet,
  loadWallet,
  loadViewOnlyWallet,
  generateViewingKey,
  unloadWallet,
  isValidRailgunAddress,
  getCurrentWalletID,
  getCurrentWallet,
  setCurrentWallet,
  getAllWallets,
  getWalletInfo,
  getWalletBackup,
  clearAllWallets,
}; 