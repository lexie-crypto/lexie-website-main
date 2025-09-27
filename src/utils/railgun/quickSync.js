/**
 * POI-Optimized QuickSync for Lexie Website
 * Uses POI latest validated TXID to minimize sync time for established wallets
 */

import { TXIDVersion } from '@railgun-community/shared-models';

// Import POI requester for latest validated state
let poiRequester = null;
const getPOIRequester = async () => {
  if (!poiRequester) {
    const { WalletPOIRequester } = await import('./poi/wallet-poi-requester.js');
    // Use multiple POI nodes for redundancy
    poiRequester = new WalletPOIRequester([
      'https://poi.railgun.org/',  // Primary POI node
      'https://ppoi.fdi.network/',  // Fallback (may not work)
      'https://poi-aggregator.railgun.org/'  // Another fallback
    ]);
  }
  return poiRequester;
};

// Optimized QuickSync that uses POI to determine better starting points
export const optimizedQuickSyncEventsGraph = async (
  txidVersion,
  chain,
  startingBlock
) => {
  try {
    // Get POI requester to check latest validated state
    const requester = await getPOIRequester();

    // Query latest validated TXID for this chain
    const latestValidated = await requester.getLatestValidatedRailgunTxid(txidVersion, chain);

    let optimizedStartingBlock = startingBlock;

    if (latestValidated && latestValidated.txidIndex) {
      // POI has validated state - use it as starting point for faster sync
      const poiBlock = Math.max(latestValidated.txidIndex - 1000, 0); // Start slightly before for safety

      if (poiBlock > startingBlock) {
        console.log(`[QuickSync-POI] 🚀 Using POI-optimized starting block: ${poiBlock} (was ${startingBlock}) for chain ${chain.id}`);
        optimizedStartingBlock = poiBlock;

        // Log the optimization benefit
        const blocksSaved = poiBlock - startingBlock;
        if (blocksSaved > 10000) {
          console.log(`[QuickSync-POI] 💰 Saved ~${Math.round(blocksSaved/1000)}K blocks of historical sync`);
        }
      } else {
        console.log(`[QuickSync-POI] 📊 POI state available but not newer than wallet creation block`);
      }
    } else {
      console.log(`[QuickSync-POI] ⚠️ No POI validated state available, using original starting block: ${startingBlock}`);
    }

    // Import the standard QuickSync implementation
    let quickSyncModule;
    try {
      quickSyncModule = await import('@railgun-community/wallet');
    } catch (importError) {
      console.warn('[QuickSync-POI] Failed to import wallet module:', importError.message);
      throw new Error('Cannot load QuickSync implementation');
    }

    // Execute QuickSync with optimized starting block
    const result = await quickSyncModule.quickSyncEventsGraph(txidVersion, chain, optimizedStartingBlock);

    console.log(`[QuickSync-POI] ✅ Completed optimized QuickSync for chain ${chain.id} from block ${optimizedStartingBlock}`);
    return result;

  } catch (error) {
    console.warn(`[QuickSync-POI] ⚠️ POI optimization failed, falling back to standard QuickSync:`, error.message);

    // Fallback to standard QuickSync on POI failure
    try {
      const fallbackModule = await import('@railgun-community/wallet');
      return fallbackModule.quickSyncEventsGraph(txidVersion, chain, startingBlock);
    } catch (fallbackError) {
      console.error('[QuickSync-POI] ❌ Fallback QuickSync also failed:', fallbackError.message);
      // Return empty events as last resort
      return { commitmentEvents: [], unshieldEvents: [], nullifierEvents: [] };
    }
  }
};

// V2_PoseidonMerkle specific optimization
export const optimizedQuickSyncEventsGraphV2 = async (chain, startingBlock) => {
  return optimizedQuickSyncEventsGraph(TXIDVersion.V2_PoseidonMerkle, chain, startingBlock);
};

// V3_PoseidonMerkle specific optimization
export const optimizedQuickSyncEventsGraphV3 = async (chain, startingBlock) => {
  return optimizedQuickSyncEventsGraph(TXIDVersion.V3_PoseidonMerkle, chain, startingBlock);
};
