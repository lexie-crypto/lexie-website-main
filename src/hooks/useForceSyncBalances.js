/**
 * useForceSyncBalances Hook
 * Manages force sync state, progress tracking, and integration with UI
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { forceSyncBalances, checkSyncStatus, updateLastSyncTime } from '../utils/railgun/forceSyncBalances';

export const useForceSyncBalances = (railgunWalletId, chainId, walletAddress) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncRecommendation, setSyncRecommendation] = useState(null);

  // Check sync status on mount and when wallet/chain changes
  useEffect(() => {
    if (railgunWalletId && chainId) {
      checkSyncStatus(railgunWalletId, chainId)
        .then(status => {
          setLastSyncTime(status.lastSyncTime);
          setSyncRecommendation(status);
        })
        .catch(error => {
          console.error('Failed to check sync status:', error);
        });
    }
  }, [railgunWalletId, chainId]);

  // Listen for balance refresh events to update sync status
  useEffect(() => {
    const handleBalanceRefresh = (event) => {
      if (event.detail?.source === 'force-sync' && event.detail?.walletId === railgunWalletId) {
        // Update last sync time when force sync completes
        updateLastSyncTime(railgunWalletId, chainId);
        setLastSyncTime(new Date());
        
        // Refresh sync recommendation
        checkSyncStatus(railgunWalletId, chainId)
          .then(status => setSyncRecommendation(status))
          .catch(console.error);
      }
    };

    window.addEventListener('force-balance-refresh', handleBalanceRefresh);
    return () => window.removeEventListener('force-balance-refresh', handleBalanceRefresh);
  }, [railgunWalletId, chainId]);

  // Progress callback for sync operations
  const handleProgress = useCallback((progressData) => {
    setSyncProgress(progressData);
    
    // Show progress toast updates for key milestones
    if (progressData.stage === 'scanning' && progressData.scanProgress) {
      const percent = Math.round(progressData.scanProgress * 100);
      if (percent % 25 === 0 && percent > 0) {
        toast.loading(`${progressData.scanType || 'Merkle'} scan: ${percent}%`, {
          id: 'sync-progress',
          duration: 1000
        });
      }
    }
  }, []);

  // Main force sync function
  const startForceSync = useCallback(async () => {
    if (!railgunWalletId || !chainId || !walletAddress) {
      toast.error('Wallet not ready for sync');
      return false;
    }

    if (isSyncing) {
      toast.error('Sync already in progress');
      return false;
    }

    setIsSyncing(true);
    setSyncProgress(null);
    setSyncError(null);

    // Show initial loading toast
    toast.loading('Starting force sync...', { id: 'sync-progress' });

    try {
      const success = await forceSyncBalances(
        railgunWalletId,
        chainId,
        walletAddress,
        handleProgress
      );

      if (success) {
        toast.success('Force sync completed successfully!', { id: 'sync-progress' });
        
        // Update sync status
        updateLastSyncTime(railgunWalletId, chainId);
        setLastSyncTime(new Date());
        
        // Refresh recommendation
        const newStatus = await checkSyncStatus(railgunWalletId, chainId);
        setSyncRecommendation(newStatus);
        
        return true;
      } else {
        toast.error('Force sync failed. Please try again.', { id: 'sync-progress' });
        setSyncError('Force sync failed');
        return false;
      }
    } catch (error) {
      console.error('Force sync error:', error);
      setSyncError(error.message);
      toast.error(`Sync failed: ${error.message}`, { id: 'sync-progress' });
      return false;
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }, [railgunWalletId, chainId, walletAddress, isSyncing, handleProgress]);

  // Cancel sync (if possible)
  const cancelSync = useCallback(() => {
    if (isSyncing) {
      // Note: Actual cancellation of SDK operations may not be possible
      // but we can reset UI state
      setIsSyncing(false);
      setSyncProgress(null);
      toast.dismiss('sync-progress');
      toast.error('Sync cancelled');
    }
  }, [isSyncing]);

  // Get user-friendly progress message
  const getProgressMessage = useCallback(() => {
    if (!syncProgress) return null;

    const { stage, message, progress } = syncProgress;
    const percent = Math.round((progress || 0) * 100);

    switch (stage) {
      case 'initializing':
        return 'Initializing sync...';
      case 'refreshing':
        return 'Triggering Merkle tree refresh...';
      case 'scanning':
        return message || `Scanning: ${percent}%`;
      case 'processing':
        return 'Processing balance updates...';
      case 'finalizing':
        return 'Finalizing sync...';
      case 'complete':
        return 'Sync completed!';
      case 'error':
        return `Error: ${message}`;
      default:
        return message || `Syncing: ${percent}%`;
    }
  }, [syncProgress]);

  // Check if sync is recommended
  const isSyncRecommended = syncRecommendation?.shouldSync || false;

  // Get time since last sync in human readable format
  const getTimeSinceLastSync = useCallback(() => {
    if (!lastSyncTime) return 'Never';
    
    const diffMs = Date.now() - lastSyncTime.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  }, [lastSyncTime]);

  return {
    // State
    isSyncing,
    syncProgress,
    syncError,
    lastSyncTime,
    syncRecommendation,
    isSyncRecommended,
    
    // Actions
    startForceSync,
    cancelSync,
    
    // Computed values
    progressMessage: getProgressMessage(),
    progressPercent: syncProgress?.progress ? Math.round(syncProgress.progress * 100) : 0,
    timeSinceLastSync: getTimeSinceLastSync(),
    
    // Status checks
    canSync: !isSyncing && railgunWalletId && chainId && walletAddress,
    isReady: Boolean(railgunWalletId && chainId && walletAddress),
  };
};

export default useForceSyncBalances;