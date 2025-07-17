/**
 * Railgun Wallet Management
 * Handles creating, loading, and managing Railgun wallets with encryption
 */

import { 
  createRailgunWallet, 
  loadWalletByID,
  getWalletMnemonic,
  getWalletAddress,
  setSelectedRailgunWallet,
} from '@railgun-community/wallet';
import { NetworkName } from '@railgun-community/shared-models';
import { ethers } from 'ethers';

/**
 * Derive encryption key from user password using PBKDF2
 * @param {string} password - User password
 * @param {string} salt - Salt for key derivation (defaults to user's address)
 * @returns {string} 32-byte hex string encryption key
 */
export const deriveEncryptionKey = async (password, salt = 'lexie-wallet-salt') => {
  if (!password) {
    throw new Error('Password is required for key derivation');
  }

  try {
    // Use PBKDF2 with SHA-256 for key derivation
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = encoder.encode(salt);

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    // Derive 32 bytes using PBKDF2
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000, // 100k iterations for security
        hash: 'SHA-256',
      },
      keyMaterial,
      256 // 32 bytes * 8 bits
    );

    // Convert to hex string
    const keyArray = new Uint8Array(derivedBits);
    const keyHex = Array.from(keyArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return `0x${keyHex}`;
  } catch (error) {
    console.error('[RailgunWallet] Failed to derive encryption key:', error);
    throw new Error('Failed to derive encryption key');
  }
};

/**
 * Generate a new mnemonic for Railgun wallet
 * @returns {string} 12-word mnemonic phrase
 */
export const generateMnemonic = () => {
  try {
    const wallet = ethers.Wallet.createRandom();
    return wallet.mnemonic.phrase;
  } catch (error) {
    console.error('[RailgunWallet] Failed to generate mnemonic:', error);
    throw new Error('Failed to generate mnemonic');
  }
};

/**
 * Validate mnemonic phrase
 * @param {string} mnemonic - Mnemonic phrase to validate
 * @returns {boolean} True if valid
 */
export const validateMnemonic = (mnemonic) => {
  try {
    ethers.Mnemonic.fromPhrase(mnemonic);
    return true;
  } catch {
    return false;
  }
};

/**
 * Create a new Railgun wallet
 * @param {string} encryptionKey - 32-byte hex encryption key
 * @param {string} mnemonic - 12 or 24 word mnemonic phrase
 * @param {Object} creationBlockNumbers - Optional block numbers for faster scanning
 * @returns {Object} Wallet info with ID and address
 */
export const createNewRailgunWallet = async (encryptionKey, mnemonic, creationBlockNumbers = {}) => {
  if (!encryptionKey || !mnemonic) {
    throw new Error('Encryption key and mnemonic are required');
  }

  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  try {
    console.log('[RailgunWallet] Creating new Railgun wallet...');

    // Default creation block numbers for faster scanning (converted to strings)
    const defaultBlockNumbers = {
      [NetworkName.Ethereum]: '18000000', // Convert BigInt to string
      [NetworkName.Polygon]: '50000000',
      [NetworkName.Arbitrum]: '150000000',
      [NetworkName.BNBChain]: '35000000',
      [NetworkName.Optimism]: '115000000',
      ...creationBlockNumbers,
    };

    // Ensure all values in creationBlockNumbers are strings
    const stringifiedBlockNumbers = {};
    Object.keys(defaultBlockNumbers).forEach(key => {
      const value = defaultBlockNumbers[key];
      stringifiedBlockNumbers[key] = typeof value === 'bigint' ? value.toString() : value.toString();
    });

    console.log('[RailgunWallet] Creation block numbers:', stringifiedBlockNumbers);

    const walletInfo = await createRailgunWallet(
      encryptionKey,
      mnemonic,
      stringifiedBlockNumbers
    );

    console.log('[RailgunWallet] Railgun wallet created successfully:', {
      id: walletInfo.id,
      address: walletInfo.railgunAddress,
    });

    // Set as selected wallet after creation
    try {
      await setSelectedRailgunWallet(walletInfo.id);
      console.log('[RailgunWallet] Wallet set as selected:', walletInfo.id);
    } catch (error) {
      console.warn('[RailgunWallet] Failed to set wallet as selected (non-critical):', error.message);
    }

    return {
      id: walletInfo.id,
      address: walletInfo.railgunAddress,
      mnemonic, // Return for backup purposes
    };
  } catch (error) {
    console.error('[RailgunWallet] Failed to create Railgun wallet:', error);
    throw new Error(`Failed to create Railgun wallet: ${error.message}`);
  }
};

/**
 * Load existing Railgun wallet by ID
 * @param {string} encryptionKey - 32-byte hex encryption key
 * @param {string} walletId - Wallet ID to load
 * @returns {Object} Wallet info with ID and address
 */
export const loadExistingRailgunWallet = async (encryptionKey, walletId) => {
  if (!encryptionKey || !walletId) {
    throw new Error('Encryption key and wallet ID are required');
  }

  try {
    console.log('[RailgunWallet] Loading existing Railgun wallet:', walletId);

    const walletInfo = await loadWalletByID(encryptionKey, walletId);

    console.log('[RailgunWallet] Railgun wallet loaded successfully:', {
      id: walletInfo.id,
      address: walletInfo.railgunAddress,
    });

    // Set as selected wallet after loading
    try {
      await setSelectedRailgunWallet(walletInfo.id);
      console.log('[RailgunWallet] Wallet set as selected:', walletInfo.id);
    } catch (error) {
      console.warn('[RailgunWallet] Failed to set wallet as selected (non-critical):', error.message);
    }

    return {
      id: walletInfo.id,
      address: walletInfo.railgunAddress,
    };
  } catch (error) {
    console.error('[RailgunWallet] Failed to load Railgun wallet:', error);
    
    // Provide more specific error messages
    if (error.message.includes('decrypt')) {
      throw new Error('Invalid password - could not decrypt wallet');
    } else if (error.message.includes('not found')) {
      throw new Error('Wallet not found - it may have been deleted');
    } else {
      throw new Error(`Failed to load Railgun wallet: ${error.message}`);
    }
  }
};

/**
 * Get wallet mnemonic (for backup/export)
 * @param {string} encryptionKey - 32-byte hex encryption key
 * @param {string} walletId - Wallet ID
 * @returns {string} Mnemonic phrase
 */
export const getWalletMnemonicPhrase = async (encryptionKey, walletId) => {
  if (!encryptionKey || !walletId) {
    throw new Error('Encryption key and wallet ID are required');
  }

  try {
    const mnemonic = await getWalletMnemonic(encryptionKey, walletId);
    return mnemonic;
  } catch (error) {
    console.error('[RailgunWallet] Failed to get wallet mnemonic:', error);
    throw new Error('Failed to retrieve wallet mnemonic');
  }
};

/**
 * Get Railgun address for wallet
 * @param {string} walletId - Wallet ID
 * @returns {string} Railgun address (0zk...)
 */
export const getRailgunAddress = async (walletId) => {
  if (!walletId) {
    throw new Error('Wallet ID is required');
  }

  try {
    const address = await getWalletAddress(walletId);
    return address;
  } catch (error) {
    console.error('[RailgunWallet] Failed to get Railgun address:', error);
    throw new Error('Failed to get Railgun address');
  }
};

/**
 * Storage utilities for wallet persistence
 */

// Local storage keys
const STORAGE_KEYS = {
  WALLET_ID: 'lexie_railgun_wallet_id',
  WALLET_ADDRESS: 'lexie_railgun_wallet_address',
  WALLET_CREATED: 'lexie_railgun_wallet_created',
};

/**
 * Save wallet info to local storage
 * @param {string} walletId - Wallet ID
 * @param {string} address - Railgun address
 */
export const saveWalletToStorage = (walletId, address) => {
  try {
    localStorage.setItem(STORAGE_KEYS.WALLET_ID, walletId);
    localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, address);
    localStorage.setItem(STORAGE_KEYS.WALLET_CREATED, Date.now().toString());
    console.log('[RailgunWallet] Wallet info saved to storage');
  } catch (error) {
    console.error('[RailgunWallet] Failed to save wallet to storage:', error);
  }
};

/**
 * Load wallet info from local storage
 * @returns {Object|null} Wallet info or null if not found
 */
export const loadWalletFromStorage = () => {
  try {
    const walletId = localStorage.getItem(STORAGE_KEYS.WALLET_ID);
    const address = localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS);
    const created = localStorage.getItem(STORAGE_KEYS.WALLET_CREATED);

    if (walletId && address) {
      return {
        id: walletId,
        address,
        created: created ? parseInt(created) : null,
      };
    }

    return null;
  } catch (error) {
    console.error('[RailgunWallet] Failed to load wallet from storage:', error);
    return null;
  }
};

/**
 * Clear wallet info from local storage
 */
export const clearWalletFromStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.WALLET_ID);
    localStorage.removeItem(STORAGE_KEYS.WALLET_ADDRESS);
    localStorage.removeItem(STORAGE_KEYS.WALLET_CREATED);
    console.log('[RailgunWallet] Wallet info cleared from storage');
  } catch (error) {
    console.error('[RailgunWallet] Failed to clear wallet from storage:', error);
  }
};

/**
 * Check if wallet exists in storage
 * @returns {boolean} True if wallet exists in storage
 */
export const hasWalletInStorage = () => {
  const walletInfo = loadWalletFromStorage();
  return !!walletInfo;
};

/**
 * Wallet setup workflow helper
 * @param {string} password - User password
 * @param {string} mnemonic - Mnemonic phrase (optional, generates new if not provided)
 * @param {boolean} saveToStorage - Whether to save to local storage
 * @returns {Object} Complete wallet setup result
 */
export const setupRailgunWallet = async (password, mnemonic = null, saveToStorage = true) => {
  try {
    // Generate mnemonic if not provided
    const walletMnemonic = mnemonic || generateMnemonic();
    
    // Derive encryption key from password
    const encryptionKey = await deriveEncryptionKey(password);
    
    // Create wallet
    const walletInfo = await createNewRailgunWallet(encryptionKey, walletMnemonic);
    
    // Save to storage if requested
    if (saveToStorage) {
      saveWalletToStorage(walletInfo.id, walletInfo.address);
    }
    
    return {
      ...walletInfo,
      encryptionKey, // Return for immediate use (don't store this)
    };
  } catch (error) {
    console.error('[RailgunWallet] Failed to setup Railgun wallet:', error);
    throw error;
  }
};

/**
 * Derive a Railgun wallet from external wallet connection
 * Uses the user's address as a deterministic seed for the Railgun wallet
 * @param {string} userAddress - External wallet address
 * @param {number} chainId - Current chain ID
 * @returns {Object} Wallet info with ID and address
 */
export const deriveRailgunWalletFromAddress = async (userAddress, chainId) => {
  if (!userAddress || !chainId) {
    throw new Error('User address and chain ID are required');
  }

  try {
    console.log('[RailgunWallet] Deriving Railgun wallet for address:', userAddress);

    // Use user's address as deterministic salt for key derivation
    const salt = `lexie-railgun-${userAddress.toLowerCase()}-${chainId}`;
    
    // Derive encryption key using the address as password (deterministic)
    const encryptionKey = await deriveEncryptionKey(userAddress.toLowerCase(), salt);
    
    // Check if we already have a cached wallet for this address
    const cachedWalletId = localStorage.getItem(`railgun-wallet-${userAddress.toLowerCase()}`);
    
    if (cachedWalletId) {
      try {
        console.log('[RailgunWallet] Loading cached wallet:', cachedWalletId);
        const walletInfo = await loadExistingRailgunWallet(encryptionKey, cachedWalletId);
        return {
          walletID: walletInfo.id,
          railgunAddress: walletInfo.address,
          isNewWallet: false,
        };
      } catch (error) {
        console.warn('[RailgunWallet] Failed to load cached wallet, creating new one:', error.message);
        // Remove invalid cached wallet ID
        localStorage.removeItem(`railgun-wallet-${userAddress.toLowerCase()}`);
      }
    }

    // Generate deterministic mnemonic from user address
    const deterministicMnemonic = generateDeterministicMnemonic(userAddress, chainId);
    
    // Create new Railgun wallet
    const walletInfo = await createNewRailgunWallet(encryptionKey, deterministicMnemonic);
    
    // Cache the wallet ID
    localStorage.setItem(`railgun-wallet-${userAddress.toLowerCase()}`, walletInfo.id);
    
    console.log('[RailgunWallet] Railgun wallet derived and cached successfully');
    
    return {
      walletID: walletInfo.id,
      railgunAddress: walletInfo.address,
      isNewWallet: true,
    };
  } catch (error) {
    console.error('[RailgunWallet] Failed to derive Railgun wallet:', error);
    throw new Error(`Failed to derive Railgun wallet: ${error.message}`);
  }
};

/**
 * Generate deterministic mnemonic from user address
 * This creates a consistent mnemonic for the same address across sessions
 * @param {string} userAddress - External wallet address
 * @param {number} chainId - Current chain ID
 * @returns {string} Deterministic mnemonic phrase
 */
const generateDeterministicMnemonic = (userAddress, chainId) => {
  try {
    // Create deterministic seed from user address and chain
    const seed = `${userAddress.toLowerCase()}-${chainId}-lexie-railgun`;
    
    // Create a hash of the seed to use as entropy
    const hash = ethers.id(seed);
    
    // Convert hash to bytes for entropy (32 bytes = 256 bits)
    const entropy = ethers.getBytes(hash);
    
    // Generate mnemonic from entropy
    const mnemonic = ethers.Mnemonic.fromEntropy(entropy);
    
    return mnemonic.phrase;
  } catch (error) {
    console.error('[RailgunWallet] Failed to generate deterministic mnemonic:', error);
    throw new Error('Failed to generate deterministic mnemonic');
  }
};

/**
 * Load cached Railgun wallet on app startup
 * @param {string} userAddress - External wallet address
 * @returns {Object|null} Wallet info or null if not found
 */
export const loadCachedRailgunWallet = async (userAddress) => {
  if (!userAddress) return null;

  try {
    const cachedWalletId = localStorage.getItem(`railgun-wallet-${userAddress.toLowerCase()}`);
    if (!cachedWalletId) return null;

    console.log('[RailgunWallet] Loading cached wallet for address:', userAddress);
    
    // Derive the same encryption key
    const salt = `lexie-railgun-${userAddress.toLowerCase()}`;
    const encryptionKey = await deriveEncryptionKey(userAddress.toLowerCase(), salt);
    
    const walletInfo = await loadExistingRailgunWallet(encryptionKey, cachedWalletId);
    
    return {
      walletID: walletInfo.id,
      railgunAddress: walletInfo.address,
    };
  } catch (error) {
    console.warn('[RailgunWallet] Failed to load cached wallet:', error.message);
    // Clean up invalid cache
    localStorage.removeItem(`railgun-wallet-${userAddress.toLowerCase()}`);
    return null;
  }
};

/**
 * Clear cached Railgun wallet
 * @param {string} userAddress - External wallet address
 */
export const clearCachedRailgunWallet = (userAddress) => {
  if (userAddress) {
    localStorage.removeItem(`railgun-wallet-${userAddress.toLowerCase()}`);
    console.log('[RailgunWallet] Cached wallet cleared for address:', userAddress);
  }
};

export default {
  deriveEncryptionKey,
  generateMnemonic,
  validateMnemonic,
  createNewRailgunWallet,
  loadExistingRailgunWallet,
  getWalletMnemonicPhrase,
  getRailgunAddress,
  saveWalletToStorage,
  loadWalletFromStorage,
  clearWalletFromStorage,
  hasWalletInStorage,
  setupRailgunWallet,
  deriveRailgunWalletFromAddress,
  loadCachedRailgunWallet,
  clearCachedRailgunWallet,
}; 