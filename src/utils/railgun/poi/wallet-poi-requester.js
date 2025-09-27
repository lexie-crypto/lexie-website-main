/**
 * POI Node Request Handler for Lexie Website
 * Adapted from wallet/src/services/poi/poi-node-request.ts
 */

import { TXIDVersion, Chain } from '@railgun-community/shared-models';

const POI_JSON_RPC_METHOD = {
  VALIDATED_TXID: 'validated_txid',
};

// Standard POI method name from shared-models
const POI_METHOD_VALIDATED_TXID = 'validated_txid';

export class POINodeRequest {
  constructor(poiNodeURLs) {
    this.poiNodeURLs = poiNodeURLs || [];
  }

  async attemptRequestWithFallbacks(method, params, attemptIndex = 0) {
    if (attemptIndex >= this.poiNodeURLs.length) {
      throw new Error(`All POI nodes failed for method ${method}`);
    }

    const url = this.poiNodeURLs[attemptIndex];

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id: Date.now(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`RPC Error: ${result.error.message}`);
      }

      return result.result;
    } catch (error) {
      console.warn(`[POI] Node ${url} failed:`, error.message);

      // Try next node
      return this.attemptRequestWithFallbacks(method, params, attemptIndex + 1);
    }
  }

  async getLatestValidatedRailgunTxid(txidVersion, chain) {
    // Try the standard JSON-RPC method that the wallet codebase expects
    try {
      const result = await this.attemptRequestWithFallbacks(POI_METHOD_VALIDATED_TXID, {
        chainType: chain.type.toString(),
        chainID: chain.id.toString(),
        txidVersion,
      });

      return {
        validatedTxidIndex: result.validatedTxidIndex,
        validatedMerkleroot: result.validatedMerkleroot,
      };
    } catch (error) {
      console.warn(`[POI] Standard POI API call failed for ${chain.id}:`, error.message);
      console.log(`[POI] POI node may not support validated_txid method or may be offline`);
      throw error; // Let the QuickSync optimization handle the fallback
    }
  }
}

export class WalletPOIRequester {
  constructor(poiNodeURLs) {
    this.poiNodeRequest = new POINodeRequest(poiNodeURLs);
  }

  async getLatestValidatedRailgunTxid(txidVersion, chain) {
    if (!this.poiNodeRequest) {
      return { txidIndex: undefined, merkleroot: undefined };
    }

    try {
      const txidStatus = await this.poiNodeRequest.getLatestValidatedRailgunTxid(txidVersion, chain);
      return {
        txidIndex: txidStatus.validatedTxidIndex,
        merkleroot: txidStatus.validatedMerkleroot,
      };
    } catch (error) {
      console.warn('[WalletPOIRequester] Failed to get latest validated TXID:', error.message);
      return { txidIndex: undefined, merkleroot: undefined };
    }
  }
}
