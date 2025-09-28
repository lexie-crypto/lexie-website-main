/**
 * POI Requester for Website - Simplified version for querying validated TXIDs
 * Adapted from wallet/src/services/poi/wallet-poi-requester.ts
 */

import { TXIDVersion } from '@railgun-community/shared-models';

class POINodeRequest {
  constructor(poiNodeURLs) {
    this.poiNodeURLs = poiNodeURLs || [];
  }

  async getLatestValidatedRailgunTxid(txidVersion, chain) {
    // For now, return a mock response since we don't have POI nodes configured
    // In production, this would make HTTP requests to POI aggregator nodes
    console.log(`🔍 [POI-REQUEST] Querying latest validated TXID for chain ${chain.type}:${chain.id}`);

    // Mock response - in real implementation, this would query POI nodes
    return {
      validatedTxidIndex: null, // No validated TXID available (common for new deployments)
      validatedMerkleroot: null
    };
  }
}

export class WalletPOIRequester {
  constructor(poiNodeURLs) {
    this.poiNodeRequest = poiNodeURLs ? new POINodeRequest(poiNodeURLs) : null;
  }

  async getLatestValidatedRailgunTxid(txidVersion, chain) {
    if (!this.poiNodeRequest) {
      return { txidIndex: null, merkleroot: null };
    }

    try {
      const result = await this.poiNodeRequest.getLatestValidatedRailgunTxid(txidVersion, chain);
      return {
        txidIndex: result.validatedTxidIndex,
        merkleroot: result.validatedMerkleroot,
      };
    } catch (error) {
      console.warn(`⚠️ [POI-REQUEST] Failed to query validated TXID for chain ${chain.type}:${chain.id}:`, error.message);
      return { txidIndex: null, merkleroot: null };
    }
  }
}
