/**
 * IDB Wallet Backup - Complete LevelDB Snapshot System
 * Creates and restores complete LevelDB snapshots for guaranteed wallet recovery
 */

import { exportWalletSnapshot } from './exporter.js';
import { uploadWalletBackup, downloadWalletBackup } from './api.js';
import { writeBackupToIDB } from './hydration.js';

/**
 * Create complete LevelDB snapshot backup after wallet creation
 * @param {string} walletId - Wallet ID
 * @param {string} eoa - EOA address
 * @returns {Promise<boolean>} Success status
 */
export const createWalletBackup = async (walletId, eoa) => {
  try {
    console.log('[Wallet-Backup] 🛡️ Creating complete LevelDB snapshot backup...', {
      walletId: walletId?.slice(0, 8) + '...',
      eoa: eoa?.slice(0, 8) + '...'
    });

    // Export complete LevelDB snapshot (should be minimal at wallet creation time)
    const snapshotData = await exportWalletSnapshot(walletId);

    if (!snapshotData) {
      console.warn('[Wallet-Backup] ⚠️ No data found in LevelDB for wallet:', walletId?.slice(0, 8));
      return false;
    }

    console.log('[Wallet-Backup] 📦 Complete LevelDB snapshot exported:', {
      recordCount: snapshotData.recordCount,
      totalBytes: snapshotData.totalBytes,
      timestamp: snapshotData.timestamp
    });

    // Upload backup to Redis
    const backupKey = `railgun:${eoa}:${walletId}:backup`;
    const success = await uploadWalletBackup(backupKey, snapshotData);

    if (success) {
      console.log('[Wallet-Backup] ✅ Complete LevelDB snapshot backup created successfully:', {
        backupKey,
        recordCount: snapshotData.recordCount,
        totalBytes: snapshotData.totalBytes
      });
    } else {
      console.error('[Wallet-Backup] ❌ Failed to upload wallet backup');
    }

    return success;

  } catch (error) {
    console.error('[Wallet-Backup] ❌ Failed to create wallet backup:', error);
    return false;
  }
};

/**
 * Restore complete LevelDB snapshot from backup when local data is missing
 * @param {string} walletId - Wallet ID
 * @param {string} eoa - EOA address
 * @returns {Promise<boolean>} Success status
 */
export const restoreWalletFromBackup = async (walletId, eoa) => {
  try {
    console.log('[Wallet-Backup] 🔄 Attempting complete LevelDB restoration from backup...', {
      walletId: walletId?.slice(0, 8) + '...',
      eoa: eoa?.slice(0, 8) + '...'
    });

    const backupKey = `railgun:${eoa}:${walletId}:backup`;

    // Download complete LevelDB snapshot from Redis
    const backupData = await downloadWalletBackup(backupKey);

    if (!backupData) {
      console.warn('[Wallet-Backup] ⚠️ No backup snapshot found for wallet');
      return false;
    }

    console.log('[Wallet-Backup] 📥 Complete LevelDB snapshot downloaded, restoring to IndexedDB...');

    // Restore complete LevelDB snapshot to IndexedDB
    await writeBackupToIDB(backupData.ndjsonData);

    console.log('[Wallet-Backup] ✅ Complete LevelDB snapshot restored successfully');
    return true;

  } catch (error) {
    console.error('[Wallet-Backup] ❌ Failed to restore wallet from backup:', error);
    return false;
  }
};

/**
 * Check if wallet backup exists in Redis
 * @param {string} walletId - Wallet ID
 * @param {string} eoa - EOA address
 * @returns {Promise<boolean>} Whether backup exists
 */
export const checkWalletBackupExists = async (walletId, eoa) => {
  try {
    const backupKey = `railgun:${eoa}:${walletId}:backup`;
    const response = await fetch('/api/artifacts?action=wallet-backup-exists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lexie-timestamp': Date.now().toString(),
        'x-lexie-signature': 'backup-check' // Would need proper HMAC in production
      },
      body: JSON.stringify({ backupKey })
    });

    if (response.ok) {
      const result = await response.json();
      return result.exists === true;
    }

    return false;
  } catch (error) {
    console.warn('[Wallet-Backup] Failed to check backup existence:', error);
    return false;
  }
};

/**
 * Reset chain scanning state after wallet restoration
 * @param {string} walletId - Wallet ID
 * @param {string} eoa - EOA address
 * @returns {Promise<boolean>} Success status
 */
export const resetChainScanningState = async (walletId, eoa) => {
  try {
    console.log('[Wallet-Backup] 🔄 Resetting chain scanning state for fresh rescan...');

    const response = await fetch('/api/artifacts?action=reset-wallet-chains', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lexie-timestamp': Date.now().toString(),
        'x-lexie-signature': 'chain-reset' // Would need proper HMAC in production
      },
      body: JSON.stringify({
        walletId,
        walletAddress: eoa
      })
    });

    if (response.ok) {
      console.log('[Wallet-Backup] ✅ Chain scanning state reset - wallet will rescan chains');
      return true;
    } else {
      console.warn('[Wallet-Backup] ⚠️ Failed to reset chain scanning state');
      return false;
    }

  } catch (error) {
    console.error('[Wallet-Backup] ❌ Error resetting chain scanning state:', error);
    return false;
  }
};
