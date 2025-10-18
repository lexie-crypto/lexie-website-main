/**
 * RAILGUN Wallet Essential Data Backup & Recovery
 *
 * Implements essential data backup to prevent wallet loss when local LevelDB is cleared.
 * Only backs up critical wallet creation data, not scanned chain data.
 * On recovery, chains will be re-scanned automatically.
 */

import { getWalletMnemonic, getWalletAddress } from '@railgun-community/wallet';
import { makeSyncRequest } from '../sync/idb-sync/api.js';
import * as bip39 from 'bip39';
import CryptoJS from 'crypto-js';

/**
 * Backup essential wallet data to Redis
 * Only stores data needed to recreate the wallet, not scanned chain data
 */
export const backupEssentialWalletData = async (walletId, encryptionKey, userAddress) => {
  try {
    console.log('🔄 Backing up essential wallet data to Redis...', {
      walletId: walletId.slice(0, 8) + '...',
      userAddress: userAddress.slice(0, 8) + '...'
    });

    // Get essential wallet data
    const mnemonic = await getWalletMnemonic(walletId, encryptionKey);
    const railgunAddress = await getWalletAddress(walletId);

    if (!mnemonic || !railgunAddress) {
      throw new Error('Failed to retrieve essential wallet data');
    }

    // Encrypt mnemonic for storage
    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, encryptionKey).toString();

    // Create essential backup data
    const backupData = {
      walletId,
      userAddress,
      railgunAddress,
      encryptedMnemonic,
      backupTimestamp: Date.now(),
      version: '1.0'
    };

    // Store in Redis under backup key
    const backupKey = `railgun:${userAddress}:${walletId}:essential`;
    const response = await makeSyncRequest('store-backup', {
      method: 'POST',
      body: JSON.stringify({
        key: backupKey,
        data: backupData,
        ttl: 365 * 24 * 60 * 60 // 1 year TTL
      })
    });

    if (!response.success) {
      throw new Error(`Failed to store backup: ${response.error}`);
    }

    console.log('✅ Essential wallet data backed up successfully', {
      backupKey,
      walletId: walletId.slice(0, 8) + '...',
      backupSize: JSON.stringify(backupData).length
    });

    return backupData;

  } catch (error) {
    console.error('❌ Failed to backup essential wallet data:', error);
    // Don't throw - backup failure shouldn't break wallet creation
    return null;
  }
};

/**
 * Check if essential backup exists for wallet
 */
export const checkEssentialBackupExists = async (userAddress, walletId) => {
  try {
    const backupKey = `railgun:${userAddress}:${walletId}:essential`;
    const response = await makeSyncRequest('get-backup', {
      method: 'GET'
    }, {
      key: backupKey
    });

    return response.success && response.data;
  } catch (error) {
    console.warn('⚠️ Failed to check backup existence:', error);
    return false;
  }
};

/**
 * Restore essential wallet data from backup
 */
export const restoreEssentialWalletData = async (userAddress, walletId, encryptionKey) => {
  try {
    console.log('🔄 Attempting to restore essential wallet data from backup...', {
      walletId: walletId.slice(0, 8) + '...',
      userAddress: userAddress.slice(0, 8) + '...'
    });

    const backupKey = `railgun:${userAddress}:${walletId}:essential`;
    const response = await makeSyncRequest('get-backup', {
      method: 'GET'
    }, {
      key: backupKey
    });

    if (!response.success || !response.data) {
      throw new Error('No backup found');
    }

    const backupData = response.data;

    // Validate backup data
    if (!backupData.encryptedMnemonic || !backupData.railgunAddress) {
      throw new Error('Invalid backup data - missing essential fields');
    }

    // Decrypt mnemonic
    const decryptedBytes = CryptoJS.AES.decrypt(backupData.encryptedMnemonic, encryptionKey);
    const mnemonic = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
      throw new Error('Failed to decrypt or validate mnemonic from backup');
    }

    console.log('✅ Essential wallet data restored from backup', {
      backupAge: Date.now() - backupData.backupTimestamp,
      walletId: walletId.slice(0, 8) + '...'
    });

    return {
      mnemonic,
      railgunAddress: backupData.railgunAddress,
      backupTimestamp: backupData.backupTimestamp
    };

  } catch (error) {
    console.error('❌ Failed to restore essential wallet data:', error);
    throw error;
  }
};

/**
 * Reset wallet metadata to trigger chain re-scanning
 * Clears scannedChains and hydratedChains arrays so chains will be re-scanned
 */
export const resetWalletMetadataForRecovery = async (userAddress, walletId) => {
  try {
    console.log('🔄 Resetting wallet metadata for recovery (chains will be re-scanned)...', {
      walletId: walletId.slice(0, 8) + '...',
      userAddress: userAddress.slice(0, 8) + '...'
    });

    // Reset metadata by calling the existing API
    const response = await fetch('/api/wallet-metadata?action=reset-chains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: userAddress,
        walletId: walletId,
        reason: 'wallet_recovery'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to reset wallet metadata: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(`Metadata reset failed: ${result.error}`);
    }

    console.log('✅ Wallet metadata reset for recovery - chains will be re-scanned');
    return true;

  } catch (error) {
    console.error('❌ Failed to reset wallet metadata:', error);
    // Don't throw - recovery can still proceed without metadata reset
    return false;
  }
};

/**
 * Check if error indicates LevelDB data is missing (triggering recovery)
 */
export const isLevelDBDataMissingError = (error) => {
  if (!error || !error.message) return false;

  // Check for the specific "Key not found in database" error pattern
  const isKeyNotFound = error.message.includes('Key not found in database');
  const isWalletKey = error.message.includes('wallet:');

  return isKeyNotFound && isWalletKey;
};

/**
 * Attempt wallet recovery from essential backup
 */
export const attemptWalletRecovery = async (userAddress, walletId, encryptionKey) => {
  try {
    console.log('🚨 LevelDB data missing - attempting wallet recovery...', {
      walletId: walletId.slice(0, 8) + '...',
      userAddress: userAddress.slice(0, 8) + '...'
    });

    // Check if backup exists
    const hasBackup = await checkEssentialBackupExists(userAddress, walletId);
    if (!hasBackup) {
      console.log('⚠️ No essential backup found - cannot recover wallet');
      return null;
    }

    // Restore essential data
    const restoredData = await restoreEssentialWalletData(userAddress, walletId, encryptionKey);

    // Reset metadata to trigger re-scanning
    await resetWalletMetadataForRecovery(userAddress, walletId);

    console.log('✅ Wallet recovery data prepared', {
      hasMnemonic: !!restoredData.mnemonic,
      railgunAddress: restoredData.railgunAddress.slice(0, 8) + '...',
      backupAge: Date.now() - restoredData.backupTimestamp
    });

    return restoredData;

  } catch (error) {
    console.error('❌ Wallet recovery failed:', error);
    return null;
  }
};
