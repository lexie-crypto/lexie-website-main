/**
 * QuickSync Integration Utilities
 * Integrates state-based QuickSync with wallet operations
 */

import { getQuickSyncStateManager } from './engine.js';
import { TXIDVersion } from '@railgun-community/shared-models';

/**
 * Enhanced wallet scanning with state-based QuickSync
 * This function can be called after wallet creation to optimize the initial sync
 */
export const optimizeWalletScanWithStateSync = async (
  walletId,
  chain,
  creationBlockNumbers = {}
) => {
  const quickSyncManager = getQuickSyncStateManager();

  if (!quickSyncManager) {
    console.log('[QuickSyncIntegration] State-based QuickSync not available, using standard scan');
    return false;
  }

  try {
    // Determine optimal starting block
    const startingBlock = await determineOptimalStartingBlock(
      chain,
      creationBlockNumbers,
      TXIDVersion.V2_PoseidonMerkle
    );

    console.log(`[QuickSyncIntegration] Optimizing scan for wallet ${walletId} on chain ${chain.id}, starting from block ${startingBlock}`);

    // Perform state-based sync
    const syncResult = await quickSyncManager.sync(
      TXIDVersion.V2_PoseidonMerkle,
      chain,
      startingBlock,
      {
        useStateQueries: true,
        maxBatchSize: 5000,
        poiFallback: true
      }
    );

    if (syncResult && syncResult.commitmentEvents && syncResult.commitmentEvents.length > 0) {
      console.log(`[QuickSyncIntegration] ✅ State-based sync completed: ${syncResult.commitmentEvents.length} commitments, ${syncResult.nullifierEvents.length} nullifiers`);
      return true;
    }

  } catch (error) {
    console.warn('[QuickSyncIntegration] State-based sync failed, falling back to standard scan:', error.message);
  }

  return false;
};

/**
 * Determine the optimal starting block for QuickSync
 */
const determineOptimalStartingBlock = async (chain, creationBlockNumbers, txidVersion) => {
  const quickSyncManager = getQuickSyncStateManager();

  // Try POI-based optimization first
  if (quickSyncManager && quickSyncManager.poiRequester) {
    try {
      const latestValidated = await quickSyncManager.poiRequester.getLatestValidatedRailgunTxid(txidVersion, chain);
      if (latestValidated.txidIndex && latestValidated.txidIndex > 0) {
        console.log(`[QuickSyncIntegration] Using POI-optimized starting block: ${latestValidated.txidIndex}`);
        return latestValidated.txidIndex;
      }
    } catch (error) {
      console.warn('[QuickSyncIntegration] POI optimization failed:', error.message);
    }
  }

  // Fallback to creation block numbers
  const networkName = getNetworkNameForChain(chain);
  const creationBlock = creationBlockNumbers[networkName];

  if (creationBlock && creationBlock > 0) {
    console.log(`[QuickSyncIntegration] Using wallet creation block: ${creationBlock}`);
    return creationBlock;
  }

  // Final fallback - use deployment block (inefficient but safe)
  const deploymentBlock = getDeploymentBlockForChain(chain);
  console.log(`[QuickSyncIntegration] Using deployment block fallback: ${deploymentBlock}`);
  return deploymentBlock;
};

/**
 * Get network name for chain (simplified mapping)
 */
const getNetworkNameForChain = (chain) => {
  // This would need to be expanded for all supported networks
  const chainMappings = {
    1: 'Ethereum',
    137: 'Polygon',
    56: 'BNBChain',
    42161: 'Arbitrum'
  };

  return chainMappings[chain.id] || 'Ethereum';
};

/**
 * Get deployment block for chain (simplified)
 */
const getDeploymentBlockForChain = (chain) => {
  // RAILGUN deployment blocks (approximate)
  const deploymentBlocks = {
    1: 14500000,     // Ethereum mainnet
    137: 29000000,   // Polygon
    56: 18000000,    // BSC
    42161: 50000000  // Arbitrum
  };

  return deploymentBlocks[chain.id] || 14000000; // Conservative fallback
};

/**
 * Hook for wallet creation that enables state-based QuickSync
 */
export const createWalletWithOptimizedSync = async (
  createWalletFn,
  encryptionKey,
  mnemonic,
  creationBlockNumbers = {},
  railgunWalletDerivationIndex
) => {
  console.log('[QuickSyncIntegration] Creating wallet with optimized sync...');

  // Create the wallet first
  const walletInfo = await createWalletFn(
    encryptionKey,
    mnemonic,
    creationBlockNumbers,
    railgunWalletDerivationIndex
  );

  console.log(`[QuickSyncIntegration] Wallet created: ${walletInfo.id}, starting optimized sync...`);

  // Note: The actual sync optimization would need to be integrated with the wallet scanning process
  // This is a placeholder for where the optimization would be applied

  return walletInfo;
};
