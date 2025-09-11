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
  loadWalletByID,
  unloadRailgunWallet,
  RailgunWallet,
  validateRailgunAddress,
  getWalletMnemonic,
  getWalletAddress,
  createViewOnlyRailgunWallet,
  getWalletShareableViewingKey,
  pbkdf2,
  getRandomBytes,
  getTransactionHistory,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';

// Wallet storage
let activeWallets = new Map();
let currentWalletID = null;

/**
 * Normalize encryption key: strip 0x prefix and validate 64 hex characters
 * @param {string} key - Encryption key (may have 0x prefix)
 * @returns {string} Normalized 64-character hex string
 * @throws {Error} If key is invalid format
 */
export const normalizeEncKey = (key) => {
  if (!key || typeof key !== 'string') {
    throw new Error('Encryption key is required and must be a string');
  }

  // Strip 0x prefix if present
  let cleanKey = key.startsWith('0x') ? key.slice(2) : key;

  // Validate exactly 64 hex characters (32 bytes)
  if (!/^[0-9a-f]{64}$/i.test(cleanKey)) {
    throw new Error(`Encryption key must be 64 hex chars (32 bytes). Got ${cleanKey.length} chars.`);
  }

  console.log('[RailgunWallet] 🔐 Normalized encryption key:', {
    originalLength: key.length,
    hadPrefix: key.startsWith('0x'),
    cleanLength: cleanKey.length,
    prefix: cleanKey.slice(0, 8) + '...',
    validFormat: true
  });

  return cleanKey;
};

/**
 * Normalize and validate shareable viewing key from metadata
 * Converts base64url to base64, adds padding, validates decode
 * @param {string} svk - Shareable viewing key from metadata
 * @returns {string} Normalized and validated SVK
 * @throws {Error} If SVK is invalid format
 */
export const normalizeAndValidateSVK = (svk) => {
  if (!svk || typeof svk !== 'string') {
    throw new Error('Shareable viewing key is required and must be a string');
  }

  console.log('[RailgunWallet] 🔑 Normalizing SVK from metadata:', {
    originalLength: svk.length,
    originalPrefix: svk.slice(0, 16) + '...'
  });

  try {
    // Convert base64url to base64 (replace - with +, _ with /)
    let base64 = svk.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const padding = base64.length % 4;
    if (padding > 0) {
      base64 += '='.repeat(4 - padding);
    }

    // Validate by attempting to decode
    const decoded = Buffer.from(base64, 'base64');
    const decodedLength = decoded.length;

    console.log('[RailgunWallet] ✅ SVK normalized and validated:', {
      normalizedLength: base64.length,
      decodedBytes: decodedLength,
      isValid: decodedLength >= 32, // SVKs should be ≥32 bytes
      prefix: base64.slice(0, 16) + '...'
    });

    if (decodedLength < 32) {
      throw new Error(`SVK must decode to ≥32 bytes. Got ${decodedLength} bytes.`);
    }

    return base64;
  } catch (error) {
    console.error('[RailgunWallet] ❌ SVK normalization/validation failed:', error);
    throw new Error(`Invalid viewing key format: ${error.message}. Please re-export the wallet.`);
  }
};

/**
 * Derive encryption key using PBKDF2 (following official Railgun docs)
 * @param {string} secret - Secret to derive from (password, signature, etc.)
 * @param {string} saltHex - Hex-encoded salt (optional - generates if not provided)
 * @param {number} iterations - Number of PBKDF2 iterations (default: 100,000)
 * @returns {Promise<{keyHex: string, saltHex: string}>} Derived encryption key and hex-encoded salt
 */
export const deriveEncryptionKey = async (secret, saltHex = null, iterations = 100000) => {
  try {
    console.log('[RailgunWallet] 🔐 Starting encryption key derivation...');
    console.log('[RailgunWallet] 📝 Secret provided:', !!secret, secret ? `(length: ${secret.length})` : '');
    console.log('[RailgunWallet] 🧂 Salt provided:', !!saltHex, saltHex ? `(length: ${saltHex.length})` : 'auto-generating');

    // Validate inputs
    if (!secret) {
      throw new Error('Secret is required for key derivation');
    }

    // Generate salt if not provided (following official docs pattern)
    let saltBytes;
    if (saltHex) {
      // Convert hex salt back to bytes
      saltBytes = new Uint8Array(Buffer.from(saltHex, 'hex'));
      console.log('[RailgunWallet] 🔄 Using provided salt, converted to bytes');
    } else {
      // Generate random 16-byte salt as per official docs
      saltBytes = getRandomBytes(16);
      console.log('[RailgunWallet] 🎲 Auto-generated 16-byte salt');
    }

    console.log('[RailgunWallet] ⚙️ Starting PBKDF2 with iterations:', iterations);

    // Use PBKDF2 to derive the encryption key (following official docs)
    // pbkdf2 returns a 64-char hex string (32 bytes). Do NOT hex it again.
    const keyHex = await pbkdf2(secret, saltBytes, iterations);

    // Verify it's a valid 64-character hex string (32 bytes)
    if (keyHex.length !== 64) {
      throw new Error(`Invalid encryption key format: ${keyHex.length} chars`);
    }

    // Return both key and hex-encoded salt for storage
    const finalSaltHex = Buffer.from(saltBytes).toString('hex');

    console.log('[RailgunWallet] ✅ Encryption key derived successfully!');
    console.log('[RailgunWallet] 🔑 Key format valid: 64-char hex string');
    console.log('[RailgunWallet] 📊 Key prefix:', keyHex.substring(0, 16) + '...');
    console.log('[RailgunWallet] 🧂 Salt hex:', finalSaltHex.substring(0, 16) + '...');

    return {
      keyHex,
      saltHex: finalSaltHex
    };

  } catch (error) {
    console.error('[RailgunWallet] ❌ Failed to derive encryption key:', error);
    throw new Error(`Failed to derive encryption key: ${error.message}`);
  }
};

export const createWallet = async (encryptionKey, mnemonic, creationBlockNumber) => {
  try {
    console.log('[RailgunWallet] 🏗️ Creating wallet with encryption key...');

    // Normalize encryption key before SDK call
    const normalizedKey = normalizeEncKey(encryptionKey);

    console.log('[RailgunWallet] 📝 Mnemonic provided:', !!mnemonic);
    console.log('[RailgunWallet] 📊 Creation Block Number:', creationBlockNumber);

    await waitForRailgunReady();

    console.log('[RailgunWallet] 📡 Calling createRailgunWallet...');

    const result = await createRailgunWallet(
      normalizedKey,  // Use normalized key
      mnemonic,
      creationBlockNumber
    );

    console.log('[RailgunWallet] ✅ Wallet created successfully!');
    console.log('[RailgunWallet] 🆔 Wallet ID:', result.id.slice(0, 8));
    console.log('[RailgunWallet] 🚀 Railgun Address:', result.railgunAddress.slice(0, 10));

    // ✅ ONLY return id + railgunAddress (match official SDK)
    // SVK generation should be done separately when needed
    return result;

  } catch (error) {
    console.error('[RailgunWallet] ❌ Wallet creation failed:', error);
    throw new Error(`Wallet creation failed: ${error.message}`);
  }
};

export const loadWallet = async (encryptionKey, walletID, isViewOnlyWallet) => {
  try {
    console.log('[RailgunWallet] 📥 Loading wallet with encryption key...');

    // Normalize encryption key before SDK call
    const normalizedKey = normalizeEncKey(encryptionKey);

    console.log('[RailgunWallet] 🆔 Wallet ID prefix:', walletID?.slice(0, 8));
    console.log('[RailgunWallet] 👁️ Is View-Only Wallet:', isViewOnlyWallet);

    await waitForRailgunReady();

    console.log('[RailgunWallet] 📡 Calling loadWalletByID...');

    const result = await loadWalletByID(
      normalizedKey,  // Use normalized key
      walletID,
      isViewOnlyWallet
    );

    console.log('[RailgunWallet] ✅ Wallet loaded successfully!');
    console.log('[RailgunWallet] 🆔 Loaded wallet ID:', result.id.slice(0, 8));
    console.log('[RailgunWallet] 🚀 Loaded railgun address:', result.railgunAddress.slice(0, 10));

    return result;

  } catch (error) {
    console.error('[RailgunWallet] ❌ Wallet loading failed:', error);
    throw new Error(`Wallet loading failed: ${error.message}`);
  }
};

/**
 * Load view-only wallet using shareable viewing key
 * @param {string} shareableViewingKey - Shareable viewing key
 * @param {Object} creationBlockNumbers - Map of chainId -> blockNumber when wallet was created
 * @param {string} encKeyHex - 32-byte hex encryption key
 * @returns {Object} View-only wallet info
 */
export const loadViewOnlyWallet = async (shareableViewingKey, creationBlockNumbers, encKeyHex) => {
  try {
    console.log('[RailgunWallet] 👁️ Creating view-only wallet...');

    // Normalize encryption key before SDK call
    const normalizedKey = normalizeEncKey(encKeyHex);

    console.log('[RailgunWallet] 👁️ Viewing Key length:', shareableViewingKey?.length);
    console.log('[RailgunWallet] 📊 Creation Block Numbers:', creationBlockNumbers);

    await waitForRailgunReady();

    console.log('[RailgunWallet] 📡 Calling createViewOnlyRailgunWallet...');

    const result = await createViewOnlyRailgunWallet(
      normalizedKey,  // Use normalized key
      shareableViewingKey,
      creationBlockNumbers
    );

    console.log('[RailgunWallet] ✅ View-only wallet created successfully!');
    console.log('[RailgunWallet] 🆔 View-only wallet ID:', result.id.slice(0, 8));
    console.log('[RailgunWallet] 🚀 View-only railgun address:', result.railgunAddress.slice(0, 10));

    return {
      id: result.id,
      railgunAddress: result.railgunAddress,
    };

  } catch (error) {
    console.error('[RailgunWallet] ❌ View-only wallet creation failed:', error);
    throw new Error(`View-only wallet loading failed: ${error.message}`);
  }
};

/**
 * Generate shareable viewing key for a wallet
 * @param {string} walletID - Wallet ID
 * @returns {string} Shareable viewing key
 */
// DEPRECATED: Use generateShareableViewingKey instead - this follows the wrong pattern
export const generateViewingKey = async (walletID) => {
  console.warn('[RailgunWallet] ⚠️ generateViewingKey is deprecated - use generateShareableViewingKey instead');
  return await generateShareableViewingKey(walletID);
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
 * Get encryption key from current active wallet
 * @returns {string|null} Encryption key if wallet exists, null otherwise
 */
export const getCurrentEncryptionKey = () => {
  const currentWallet = getCurrentWallet();
  if (currentWallet && currentWallet.encryptionKey) {
    console.log('[RailgunWallet] 🔑 Retrieved encryption key from current wallet');
    return currentWallet.encryptionKey;
  }
  console.log('[RailgunWallet] ⚠️ No current wallet with encryption key found');
  return null;
};

/**
 * Generate shareable viewing key from loaded wallet (EXACT SAME AS WORKING SDK)
 * @param {string} walletID - Wallet ID to generate SVK from
 * @returns {Promise<string>} Shareable viewing key
 */
export const generateShareableViewingKey = async (walletID) => {
  console.log('[RailgunWallet] 🔑 Generating shareable viewing key from wallet:', {
    walletID: walletID?.slice(0, 8) + '...'
  });

  try {
    const svk = await getWalletShareableViewingKey(walletID);
    console.log('[RailgunWallet] ✅ Shareable viewing key generated:', {
      length: svk.length,
      prefix: svk.slice(0, 16) + '...'
    });
    return svk;
  } catch (error) {
    console.error('[RailgunWallet] ❌ Failed to generate shareable viewing key:', error);
    throw error;
  }
};

/**
 * Derive encryption key for wallet using deterministic approach
 * @param {string} walletAddress - Wallet address for deterministic derivation
 * @param {number} chainId - Chain ID for salt
 * @returns {Promise<string>} Normalized encryption key
 */
export const deriveWalletEncryptionKey = async (walletAddress, chainId) => {
  console.log('[RailgunWallet] 🔐 Deriving encryption key for wallet:', {
    walletAddress: walletAddress?.slice(0, 10) + '...',
    chainId
  });

  const secret = walletAddress.toLowerCase();
  // Convert UTF-8 label to hex for proper salt handling
  const label = `lexie-railgun-${chainId}`;
  const saltHex = Buffer.from(label, 'utf8').toString('hex');

  console.log('[RailgunWallet] 🔐 Salt generation:', {
    label,
    saltHex: saltHex.slice(0, 16) + '...'
  });

  const derivedKey = await deriveEncryptionKey(secret, saltHex, 100000);
  return normalizeEncKey(derivedKey.keyHex);
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
 * Compliance Report Generation Flow
 * Generates SVK in memory, creates view-only wallet, fetches history
 * @param {string} walletAddress - EOA wallet address
 * @param {number} chainId - Chain ID for transaction history
 * @param {string} format - Report format ('json', 'csv', 'pdf')
 * @returns {Promise<Object>} Compliance report
 */
export const generateComplianceReport = async (walletAddress, chainId, format = 'json') => {
  try {
    console.log('[Compliance] Starting compliance report generation', {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      chainId,
      format
    });

    await waitForRailgunReady();

    // Step 1: Get wallet metadata from backend
    console.log('[Compliance] Fetching wallet metadata...');
    const metadataResponse = await fetch(`/api/wallet-metadata/${encodeURIComponent(walletAddress)}`);

    if (!metadataResponse.ok) {
      throw new Error(`Failed to fetch wallet metadata: ${metadataResponse.status}`);
    }

    const metadata = await metadataResponse.json();
    if (!metadata.success || !metadata.keys || metadata.keys.length === 0) {
      throw new Error('No wallet metadata found');
    }

    // Find the wallet with metadata
    const walletData = metadata.keys.find(key => key.walletId && key.encryptedMnemonic);
    if (!walletData) {
      throw new Error('Wallet data not found or missing encrypted mnemonic');
    }

    const { walletId, encryptedMnemonic, scannedChains } = walletData;

    console.log('[Compliance] Retrieved wallet data', {
      walletId: walletId?.slice(0, 8) + '...',
      hasEncryptedMnemonic: !!encryptedMnemonic,
      scannedChains: scannedChains?.length || 0
    });

    // Step 2: Re-derive encryption key from encrypted mnemonic
    console.log('[Compliance] Re-deriving encryption key...');

    // Use wallet address + chain as salt for deterministic key derivation
    const salt = `lexie-railgun-${chainId}`;
    const saltHex = Buffer.from(salt, 'utf8').toString('hex');

    const keyDerivation = await deriveEncryptionKey(encryptedMnemonic, saltHex, 100000);
    const encKey = normalizeEncKey(keyDerivation.keyHex);

    console.log('[Compliance] Encryption key re-derived', {
      keyLength: encKey.length,
      keyPrefix: encKey.slice(0, 16) + '...'
    });

    // Step 3: Load/create full wallet
    console.log('[Compliance] Loading/creating full wallet...');
    let fullWallet;

    try {
      // Try to load existing wallet first
      fullWallet = await loadWallet(encKey, walletId, false);
      console.log('[Compliance] Full wallet loaded', {
        walletId: fullWallet.id?.slice(0, 8) + '...',
        railgunAddress: fullWallet.railgunAddress?.slice(0, 10) + '...'
      });
    } catch (loadError) {
      console.log('[Compliance] Full wallet not found, creating new one...');

      // Need mnemonic to create wallet - this should come from secure storage
      // For now, we'll throw an error since we can't create without mnemonic
      throw new Error('Cannot create full wallet: mnemonic not available for compliance report generation');
    }

    // Step 4: Generate SVK in memory (don't store)
    console.log('[Compliance] Generating SVK in memory...');
    const svk = await generateShareableViewingKey(fullWallet.id);

    console.log('[Compliance] SVK generated', {
      length: svk.length,
      prefix: svk.slice(0, 12) + '...'
    });

    // Step 5: Create view-only wallet
    console.log('[Compliance] Creating view-only wallet...');
    const viewOnlyWalletInfo = await loadViewOnlyWallet(
      svk,
      undefined, // creationBlockNumbers - pass undefined
      encKey
    );

    console.log('[Compliance] View-only wallet created', {
      voWalletId: viewOnlyWalletInfo.id?.slice(0, 8) + '...',
      railgunAddress: viewOnlyWalletInfo.railgunAddress?.slice(0, 10) + '...'
    });

    // Step 6: Load view-only wallet for history access
    console.log('[Compliance] Loading view-only wallet for history...');
    await loadWallet(encKey, viewOnlyWalletInfo.id, true);

    // Step 7: Fetch transaction history
    console.log('[Compliance] Fetching transaction history...');
    const history = await getTransactionHistory(viewOnlyWalletInfo.id, chainId);

    console.log('[Compliance] Transaction history retrieved', {
      transactionCount: history.length,
      chainId
    });

    // Step 8: Generate report based on format
    const report = {
      walletAddress,
      walletId: walletId?.slice(0, 8) + '...',
      chainId,
      railgunAddress: viewOnlyWalletInfo.railgunAddress,
      generatedAt: new Date().toISOString(),
      transactionCount: history.length,
      transactions: history.map(tx => ({
        timestamp: tx.timestamp,
        type: tx.type,
        token: tx.token,
        amount: tx.amount,
        status: tx.status,
        txHash: tx.txHash,
        memo: tx.memo
      }))
    };

    // Clean up sensitive data
    // Note: SVK is not stored, only used in memory

    console.log('[Compliance] Compliance report generated successfully', {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      transactionCount: history.length,
      format
    });

    return {
      success: true,
      report,
      format
    };

  } catch (error) {
    console.error('[Compliance] Failed to generate compliance report:', error);
    throw new Error(`Compliance report generation failed: ${error.message}`);
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
  normalizeEncKey,
  normalizeAndValidateSVK,
  getCurrentEncryptionKey,
  deriveWalletEncryptionKey,
  deriveEncryptionKey,
  createWallet,
  loadWallet,
  loadViewOnlyWallet,
  generateViewingKey,
  generateShareableViewingKey,
  generateComplianceReport,
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