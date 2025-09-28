/**
 * Wallet Scan Refresh Utility
 * Refreshes wallet scan starting points to prevent stale block numbers
 */

import { getQuickSyncStateManager } from './engine.js';
import { TXIDVersion } from '@railgun-community/shared-models';

/**
 * Refresh wallet scan starting points using optimal strategies
 * Solves the "stale creation block numbers" problem
 */
export const refreshWalletScanPoints = async (walletId, chains = []) => {
  console.log(`[WalletRefresh] 🔄 Refreshing scan points for wallet ${walletId}`);

  const quickSyncManager = getQuickSyncStateManager();
  if (!quickSyncManager) {
    console.warn('[WalletRefresh] ⚠️ QuickSync manager not available');
    return null;
  }

  const results = {};

  for (const chain of chains) {
    try {
      console.log(`[WalletRefresh] 📊 Processing chain ${chain.id} for wallet ${walletId}`);

      // Strategy 1: Try POI-based optimal starting point
      let optimalStartBlock = null;

      if (quickSyncManager.poiRequester) {
        try {
          const latestValidated = await quickSyncManager.poiRequester.getLatestValidatedRailgunTxid(
            TXIDVersion.V2_PoseidonMerkle,
            chain
          );

          if (latestValidated.txidIndex && latestValidated.txidIndex > 0) {
            optimalStartBlock = latestValidated.txidIndex;
            console.log(`[WalletRefresh] ✅ POI-optimized start: ${optimalStartBlock} for chain ${chain.id}`);
          }
        } catch (error) {
          console.warn(`[WalletRefresh] ⚠️ POI optimization failed for chain ${chain.id}:`, error.message);
        }
      }

      // Strategy 2: Fallback to state-based queries
      if (!optimalStartBlock) {
        try {
          const stateQueriesSupported = await quickSyncManager.checkStateQuerySupport(chain);
          if (stateQueriesSupported) {
            const latestState = await quickSyncManager.getLatestMerkletreeState(chain);
            if (latestState && latestState.latestCommitmentIndex) {
              // Start from a safe point slightly before the latest
              optimalStartBlock = Math.max(0, latestState.latestCommitmentIndex - 1000);
              console.log(`[WalletRefresh] ✅ State-query optimized start: ${optimalStartBlock} for chain ${chain.id}`);
            }
          }
        } catch (error) {
          console.warn(`[WalletRefresh] ⚠️ State query optimization failed for chain ${chain.id}:`, error.message);
        }
      }

      // Strategy 3: Use current block numbers (last resort)
      if (!optimalStartBlock) {
        // This would require fetching current block numbers
        // For now, we'll skip this and let the SDK use its defaults
        console.log(`[WalletRefresh] ⚠️ No optimization available for chain ${chain.id}, using SDK defaults`);
      }

      results[chain.id] = {
        chainId: chain.id,
        optimalStartBlock,
        strategy: optimalStartBlock ? 'optimized' : 'default'
      };

    } catch (error) {
      console.error(`[WalletRefresh] ❌ Failed to refresh chain ${chain.id}:`, error);
      results[chain.id] = {
        chainId: chain.id,
        optimalStartBlock: null,
        strategy: 'error',
        error: error.message
      };
    }
  }

  console.log(`[WalletRefresh] ✅ Completed refresh for ${Object.keys(results).length} chains`);
  return results;
};

/**
 * Hook to refresh wallet before scanning
 * Call this before triggering any wallet scan operations
 */
export const prepareWalletForScan = async (walletId, chains = []) => {
  console.log(`[WalletRefresh] 🎯 Preparing wallet ${walletId} for scan on ${chains.length} chains`);

  try {
    const refreshResults = await refreshWalletScanPoints(walletId, chains);

    // Log optimization results
    const optimizedChains = Object.values(refreshResults).filter(r => r.strategy === 'optimized').length;
    const totalChains = Object.keys(refreshResults).length;

    console.log(`[WalletRefresh] 📊 Optimization complete: ${optimizedChains}/${totalChains} chains optimized`);

    if (optimizedChains > 0) {
      console.log(`[WalletRefresh] 🚀 Wallet scan will use optimized starting points for better performance`);
    } else {
      console.log(`[WalletRefresh] ⚠️ Wallet scan will use default SDK behavior`);
    }

    return refreshResults;

  } catch (error) {
    console.error(`[WalletRefresh] ❌ Wallet preparation failed:`, error);
    return null;
  }
};
