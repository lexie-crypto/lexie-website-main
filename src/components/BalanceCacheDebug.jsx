/**
 * Balance Cache Debug Component
 * Shows cache statistics and status for debugging purposes
 */

import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';

const BalanceCacheDebug = () => {
  const { railgunWalletId, chainId } = useWallet();
  const [cacheStats, setCacheStats] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  // Load cache stats
  const loadCacheStats = async () => {
    try {
      const { getCacheStats } = await import('../utils/railgun/balanceCache.js');
      const stats = getCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  };

  // Load stats on mount and when wallet changes
  useEffect(() => {
    if (railgunWalletId && chainId) {
      loadCacheStats();
    }
  }, [railgunWalletId, chainId]);

  // Listen for cache updates
  useEffect(() => {
    const handleCacheUpdate = () => {
      loadCacheStats();
    };

    window.addEventListener('railgun-balance-cached', handleCacheUpdate);
    return () => {
      window.removeEventListener('railgun-balance-cached', handleCacheUpdate);
    };
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(loadCacheStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white text-xs px-2 py-1 rounded z-50 opacity-50 hover:opacity-100"
      >
        Debug Cache
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white text-xs p-3 rounded-lg max-w-sm z-50 border border-gray-700">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold">Balance Cache Stats</h3>
        <button
          onClick={() => setIsVisible(false)}
          className="text-gray-400 hover:text-white"
        >
          ×
        </button>
      </div>
      
      {cacheStats ? (
        <div className="space-y-1">
          <div>Wallets: {cacheStats.totalWallets}</div>
          <div>Tokens: {cacheStats.totalTokens}</div>
          <div>Pending Promises: {cacheStats.pendingPromises}</div>
          {cacheStats.newestUpdate && (
            <div>
              Last Update: {Math.round((Date.now() - cacheStats.newestUpdate) / 1000)}s ago
            </div>
          )}
          {cacheStats.oldestUpdate && (
            <div>
              Oldest Entry: {Math.round((Date.now() - cacheStats.oldestUpdate) / 1000 / 60)}m ago
            </div>
          )}
        </div>
      ) : (
        <div>Loading...</div>
      )}
      
      <button
        onClick={loadCacheStats}
        className="mt-2 bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs w-full"
      >
        Refresh Stats
      </button>
    </div>
  );
};

export default BalanceCacheDebug;