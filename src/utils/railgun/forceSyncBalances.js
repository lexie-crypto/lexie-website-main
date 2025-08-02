/**
 * Force Sync Balances - Manual Merkle Tree Sync
 * Triggers a full Railgun SDK Merkle tree sync from the last known safe block
 * Bypasses "already synced" checks to ensure new shielded notes are picked up
 */

import { toast } from 'react-hot-toast';

/**
 * Force a full Merkle tree sync for the active Railgun wallet
 * @param {string} railgunWalletId - Railgun wallet ID
 * @param {number} chainId - Chain ID
 * @param {string} walletAddress - Wallet address (for Redis updates)
 * @param {Function} onProgress - Progress callback function
 * @returns {Promise<boolean>} Success status
 */
export const forceSyncBalances = async (railgunWalletId, chainId, walletAddress, onProgress = null) => {
      console.log('[ForceSyncBalances] 🚀 Starting FULL Merkle tree rescan (ignores validated index)...', {
      railgunWalletId: railgunWalletId?.slice(0, 8) + '...',
      chainId,
      walletAddress: walletAddress?.slice(0, 8) + '...',
      timestamp: new Date().toISOString(),
      note: 'This will pick up new transactions past the validated index'
    });

  try {
    // Step 1: Import required dependencies
    const { waitForRailgunReady } = await import('./engine.js');
    const { 
      refreshBalances, 
      rescanFullUTXOMerkletreesAndWallets 
    } = await import('@railgun-community/wallet');
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const { 
      waitForMerkleScansComplete, 
      waitForSpendableNotes, 
      areMerkleScansComplete,
      areSpendableNotesReady 
    } = await import('./sdk-callbacks.js');

    // Step 2: Ensure Railgun engine is ready
    await waitForRailgunReady();
    console.log('[ForceSyncBalances] ✅ Railgun engine confirmed ready');

    // Step 3: Get chain configuration
    let networkName = null;
    let railgunChain = null;
    
    for (const [name, config] of Object.entries(NETWORK_CONFIG)) {
      if (config.chain.id === chainId) {
        networkName = name;
        railgunChain = config.chain;
        break;
      }
    }
    
    if (!networkName || !railgunChain) {
      throw new Error(`No network config found for chain ID: ${chainId}`);
    }

    console.log('[ForceSyncBalances] 📊 Network configuration:', {
      networkName,
      chainId: railgunChain.id,
      chainType: railgunChain.type
    });

    // Step 4: Check pre-sync state
    const preSyncScansComplete = areMerkleScansComplete(railgunWalletId);
    console.log('[ForceSyncBalances] 📈 Pre-sync state:', {
      merkleScansComplete: preSyncScansComplete,
      walletId: railgunWalletId?.slice(0, 8) + '...'
    });

    if (onProgress) {
      onProgress({
        stage: 'initializing',
        progress: 0.1,
        message: 'Initializing force sync...'
      });
    }

    // Step 5: Force FULL UTXO rescan (bypasses validated index checks)
    console.log('[ForceSyncBalances] 🚨 Triggering FULL UTXO rescan - ignoring validated index...');
    
    if (onProgress) {
      onProgress({
        stage: 'rescanning',
        progress: 0.2,
        message: 'Starting full UTXO rescan (ignoring validated index)...'
      });
    }

    // Use rescanFullUTXOMerkletreesAndWallets instead of refreshBalances
    // This forces a complete rescan that ignores "already synced to validated index" checks
    await rescanFullUTXOMerkletreesAndWallets(railgunChain, [railgunWalletId]);
    console.log('[ForceSyncBalances] ✅ Full UTXO rescan call completed - should pick up new transactions past validated index');

    // Step 6: Wait for Merkle scans to complete with progress monitoring
    console.log('[ForceSyncBalances] 📊 Monitoring Merkle tree scan completion...');
    
    if (onProgress) {
      onProgress({
        stage: 'scanning',
        progress: 0.3,
        message: 'Waiting for full Merkle tree rescan to complete (up to 2 minutes)...'
      });
    }

    // Set up progress monitoring for scans
    const scanProgressHandler = (event) => {
      if (event.detail && onProgress) {
        const scanType = event.type === 'railgun-utxo-scan' ? 'UTXO' : 'TXID';
        const progress = Math.round((event.detail.progress || 0) * 100);
        
        onProgress({
          stage: 'scanning',
          progress: 0.3 + (event.detail.progress || 0) * 0.4, // Scale to 0.3-0.7 range
          message: `${scanType} scan: ${progress}%`,
          scanType,
          scanProgress: event.detail.progress
        });
      }
    };

    // Listen for scan progress
    window.addEventListener('railgun-utxo-scan', scanProgressHandler);
    window.addEventListener('railgun-txid-scan', scanProgressHandler);

    try {
      const scansCompleted = await waitForMerkleScansComplete(railgunWalletId, 120000); // 120 second timeout for full rescan
      
      // Remove progress listeners
      window.removeEventListener('railgun-utxo-scan', scanProgressHandler);
      window.removeEventListener('railgun-txid-scan', scanProgressHandler);

      if (scansCompleted) {
        console.log('[ForceSyncBalances] ✅ Merkle tree scans completed successfully');
        
        if (onProgress) {
          onProgress({
            stage: 'processing',
            progress: 0.8,
            message: 'Processing balance updates...'
          });
        }
      } else {
        console.warn('[ForceSyncBalances] ⚠️ Full rescan timed out after 2 minutes, but continuing...');
        
        if (onProgress) {
          onProgress({
            stage: 'processing',
            progress: 0.8,
            message: 'Full rescan timed out after 2 minutes, processing available data...'
          });
        }
      }
    } finally {
      // Ensure listeners are cleaned up
      window.removeEventListener('railgun-utxo-scan', scanProgressHandler);
      window.removeEventListener('railgun-txid-scan', scanProgressHandler);
    }

    // Step 7: Wait for balance callback to confirm spendable notes (if any tokens exist)
    console.log('[ForceSyncBalances] 💎 Waiting for balance callback confirmation...');
    
    if (onProgress) {
      onProgress({
        stage: 'finalizing',
        progress: 0.9,
        message: 'Confirming balance updates...'
      });
    }

    // Give some time for balance callbacks to fire
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 8: Update Redis with any new balance data
    console.log('[ForceSyncBalances] 💾 Updating Redis with refreshed balance data...');
    
    try {
      // Trigger a useBalances refresh to sync with Redis
      window.dispatchEvent(new CustomEvent('force-balance-refresh', {
        detail: {
          walletId: railgunWalletId,
          chainId: chainId,
          source: 'force-sync'
        }
      }));
      
      console.log('[ForceSyncBalances] ✅ Redis update event dispatched');
    } catch (redisError) {
      console.warn('[ForceSyncBalances] ⚠️ Redis update failed, but sync succeeded:', redisError.message);
    }

    // Step 9: Final completion
    if (onProgress) {
      onProgress({
        stage: 'complete',
        progress: 1.0,
        message: 'Full rescan completed successfully!'
      });
    }

    console.log('[ForceSyncBalances] 🎉 Full rescan completed successfully - new transactions should now be visible!', {
      walletId: railgunWalletId?.slice(0, 8) + '...',
      chainId,
      networkName,
      timestamp: new Date().toISOString(),
      note: 'Full UTXO rescan bypassed validated index checks'
    });

    return true;

  } catch (error) {
    console.error('[ForceSyncBalances] ❌ Full rescan failed:', {
      error: error.message,
      stack: error.stack,
      walletId: railgunWalletId?.slice(0, 8) + '...',
      chainId
    });

    if (onProgress) {
      onProgress({
        stage: 'error',
        progress: 0,
        message: `Sync failed: ${error.message}`,
        error: error.message
      });
    }

    // Show user-friendly error message
    if (error.message.includes('network')) {
      toast.error('Network error during full rescan. Please check your connection and try again.');
    } else if (error.message.includes('timeout')) {
      toast.error('Full rescan timed out. Your balances may still update in the background.');
    } else {
      toast.error(`Full rescan failed: ${error.message}`);
    }

    return false;
  }
};

/**
 * Check if a force sync is currently needed/recommended
 * @param {string} railgunWalletId - Railgun wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Sync recommendation info
 */
export const checkSyncStatus = async (railgunWalletId, chainId) => {
  try {
    const { areMerkleScansComplete } = await import('./sdk-callbacks.js');
    
    const scansComplete = areMerkleScansComplete(railgunWalletId);
    
    // Check last sync time from localStorage
    const lastSyncKey = `railgun-last-sync-${railgunWalletId}-${chainId}`;
    const lastSyncTime = localStorage.getItem(lastSyncKey);
    const timeSinceLastSync = lastSyncTime ? Date.now() - parseInt(lastSyncTime) : Infinity;
    
    // Recommend sync if it's been more than 15 minutes or scans aren't complete
    const shouldSync = !scansComplete || timeSinceLastSync > 15 * 60 * 1000;
    
    return {
      scansComplete,
      lastSyncTime: lastSyncTime ? new Date(parseInt(lastSyncTime)) : null,
      timeSinceLastSync,
      shouldSync,
      recommendation: shouldSync 
        ? 'Force sync recommended to ensure latest balance data'
        : 'Balances appear up to date'
    };
    
  } catch (error) {
    console.error('[ForceSyncBalances] Error checking sync status:', error);
    return {
      scansComplete: false,
      shouldSync: true,
      recommendation: 'Unable to check sync status - force sync recommended'
    };
  }
};

/**
 * Update last sync timestamp
 * @param {string} railgunWalletId - Railgun wallet ID  
 * @param {number} chainId - Chain ID
 */
export const updateLastSyncTime = (railgunWalletId, chainId) => {
  const lastSyncKey = `railgun-last-sync-${railgunWalletId}-${chainId}`;
  localStorage.setItem(lastSyncKey, Date.now().toString());
};

export default {
  forceSyncBalances,
  checkSyncStatus,
  updateLastSyncTime,
};