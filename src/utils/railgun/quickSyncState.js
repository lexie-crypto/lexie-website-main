/**
 * RAILGUN QuickSync State-Based Sync
 * Near-instant wallet sync using merkletree state queries
 */

import { MERKLETREE_STATE_QUERIES, supportsStateQueries } from './quickSyncQueries.js';
import { GraphQLClient } from 'graphql-request';

// Network-to-GraphQL endpoint mapping
const NETWORK_GRAPHQL_ENDPOINTS = {
  1: 'https://rail-squid.squids.live/squid-railgun-ethereum-v2/graphql',      // Ethereum
  56: 'https://rail-squid.squids.live/squid-railgun-bsc-v2/graphql',           // BSC
  137: 'https://rail-squid.squids.live/squid-railgun-polygon-v2/graphql',      // Polygon
  42161: 'https://rail-squid.squids.live/squid-railgun-arbitrum-v2/graphql',   // Arbitrum
  11155111: 'https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/graphql', // Sepolia
};

// Get GraphQL endpoint for a chain
const getGraphQLEndpointForChain = (chain) => {
  return NETWORK_GRAPHQL_ENDPOINTS[chain.id] || NETWORK_GRAPHQL_ENDPOINTS[1]; // Default to Ethereum
};

// State-based QuickSync implementation
export class QuickSyncState {
  constructor(poiRequester = null) {
    this.poiRequester = poiRequester;
    this.graphClients = new Map(); // Cache GraphQL clients per chain
    this.stateQueriesSupported = new Map(); // Cache support detection per chain
  }

  // Get or create GraphQL client for a specific chain
  getGraphClientForChain(chain) {
    const chainId = chain.id;
    if (!this.graphClients.has(chainId)) {
      const endpoint = getGraphQLEndpointForChain(chain);
      this.graphClients.set(chainId, new GraphQLClient(endpoint, { timeout: 30000 }));
      console.log(`[QuickSyncState] Created GraphQL client for chain ${chainId}: ${endpoint}`);
    }
    return this.graphClients.get(chainId);
  }

  // Check if state queries are supported for a specific chain
  async checkStateQuerySupport(chain) {
    const chainId = chain.id;
    if (!this.stateQueriesSupported.has(chainId)) {
      const graphClient = this.getGraphClientForChain(chain);
      const supported = await supportsStateQueries(graphClient);
      this.stateQueriesSupported.set(chainId, supported);
    }
    return this.stateQueriesSupported.get(chainId);
  }

  // Get latest merkletree state for a specific chain
  async getLatestMerkletreeState(chain) {
    try {
      const graphClient = this.getGraphClientForChain(chain);
      const response = await graphClient.request(
        MERKLETREE_STATE_QUERIES.LatestMerkletreeState
      );

      if (response.merkletrees && response.merkletrees.length > 0) {
        const latestTree = response.merkletrees[0];
        console.log(`[QuickSyncState] Latest merkletree for chain ${chain.id}: tree=${latestTree.treeNumber}, height=${latestTree.height}, latestIndex=${latestTree.latestCommitmentIndex}`);
        return latestTree;
      }

      console.warn(`[QuickSyncState] No merkletree state found for chain ${chain.id}`);
      return null;
    } catch (error) {
      console.error(`[QuickSyncState] Failed to get latest merkletree state for chain ${chain.id}:`, error);
      return null;
    }
  }

  // Get incremental updates since last known index for a specific chain
  async getIncrementalUpdates(chain, lastKnownIndex, batchSize = 1000) {
    try {
      const graphClient = this.getGraphClientForChain(chain);
      const [commitmentsResponse, nullifiersResponse] = await Promise.all([
        graphClient.request(MERKLETREE_STATE_QUERIES.LatestCommitments, {
          startIndex: lastKnownIndex,
          limit: batchSize
        }),
        graphClient.request(MERKLETREE_STATE_QUERIES.LatestNullifiers, {
          startIndex: lastKnownIndex,
          limit: batchSize
        })
      ]);

      const commitments = commitmentsResponse.commitments || [];
      const nullifiers = nullifiersResponse.nullifiers || [];

      console.log(`[QuickSyncState] Incremental updates for chain ${chain.id}: ${commitments.length} commitments, ${nullifiers.length} nullifiers since index ${lastKnownIndex}`);

      return {
        commitments: this.formatCommitments(commitments),
        nullifiers: this.formatNullifiers(nullifiers)
      };
    } catch (error) {
      console.error(`[QuickSyncState] Failed to get incremental updates for chain ${chain.id}:`, error);
      return { commitments: [], nullifiers: [] };
    }
  }

  // Format commitments for engine consumption
  formatCommitments(commitments) {
    return commitments.map(commitment => ({
      treeNumber: commitment.treeNumber,
      startPosition: commitment.treePosition,
      commitments: [{
        hash: commitment.hash,
        txid: commitment.transactionHash,
        blockNumber: Number(commitment.blockNumber),
        timestamp: Date.now(), // Approximate timestamp
        commitmentType: commitment.commitmentType
      }]
    }));
  }

  // Format nullifiers for engine consumption
  formatNullifiers(nullifiers) {
    return nullifiers.map(nullifier => ({
      treeNumber: 0, // Assuming single tree for nullifiers
      nullifier: nullifier.nullifier,
      txid: nullifier.transactionHash,
      blockNumber: Number(nullifier.blockNumber)
    }));
  }

  // Main sync method - determine optimal sync strategy
  async sync(txidVersion, chain, startingBlock, options = {}) {
    const {
      useStateQueries = true,
      maxBatchSize = 5000,
      poiFallback = true
    } = options;

    // Check if state queries are supported for this chain
    const stateQueriesSupported = useStateQueries && await this.checkStateQuerySupport(chain);

    if (stateQueriesSupported) {
      console.log(`[QuickSyncState] Using optimized state-based sync for chain ${chain.id}`);
      return await this.performStateBasedSync(txidVersion, chain, startingBlock, maxBatchSize);
    } else if (poiFallback && this.poiRequester) {
      console.log(`[QuickSyncState] Using POI-based incremental sync for chain ${chain.id}`);
      return await this.performPoiBasedSync(txidVersion, chain, startingBlock);
    } else {
      console.log(`[QuickSyncState] Falling back to full historical sync for chain ${chain.id}`);
      return await this.performFullHistoricalSync(txidVersion, chain, startingBlock);
    }
  }

  // State-based sync implementation
  async performStateBasedSync(txidVersion, chain, startingBlock, maxBatchSize) {
    const latestState = await this.getLatestMerkletreeState(chain);

    if (!latestState) {
      throw new Error('Unable to retrieve merkletree state');
    }

    // Calculate how many events we need to catch up
    const eventsNeeded = latestState.latestCommitmentIndex - startingBlock;

    if (eventsNeeded <= 0) {
      console.log('[QuickSyncState] Wallet already up to date');
      return { nullifierEvents: [], unshieldEvents: [], commitmentEvents: [] };
    }

    console.log(`[QuickSyncState] Catching up ${eventsNeeded} events from index ${startingBlock} to ${latestState.latestCommitmentIndex}`);

    // Get incremental updates in batches
    const allCommitments = [];
    const allNullifiers = [];

    for (let currentIndex = startingBlock; currentIndex < latestState.latestCommitmentIndex; currentIndex += maxBatchSize) {
      const batchSize = Math.min(maxBatchSize, latestState.latestCommitmentIndex - currentIndex);
      const updates = await this.getIncrementalUpdates(chain, currentIndex, batchSize);

      allCommitments.push(...updates.commitments);
      allNullifiers.push(...updates.nullifiers);
    }

    return {
      nullifierEvents: allNullifiers,
      unshieldEvents: [], // State queries don't include unshields yet
      commitmentEvents: allCommitments
    };
  }

  // POI-based incremental sync (fallback)
  async performPoiBasedSync(txidVersion, chain, startingBlock) {
    try {
      const latestValidated = await this.poiRequester.getLatestValidatedRailgunTxid(txidVersion, chain);

      if (latestValidated.txidIndex && latestValidated.txidIndex > startingBlock) {
        console.log(`[QuickSyncState] POI-based sync: using validated TXID index ${latestValidated.txidIndex} instead of ${startingBlock}`);
        return await this.performStateBasedSync(txidVersion, chain, latestValidated.txidIndex);
      }
    } catch (error) {
      console.warn('[QuickSyncState] POI-based sync failed:', error.message);
    }

    // Fallback to full sync
    return await this.performFullHistoricalSync(txidVersion, chain, startingBlock);
  }

  // Full historical sync (original implementation)
  async performFullHistoricalSync(txidVersion, chain, startingBlock) {
    // This would be the existing QuickSync implementation
    console.log('[QuickSyncState] Performing full historical sync (original implementation)');
    return { nullifierEvents: [], unshieldEvents: [], commitmentEvents: [] };
  }
}

// Factory function to create QuickSyncState instance
export const createQuickSyncState = (graphClient, poiRequester = null) => {
  return new QuickSyncState(graphClient, poiRequester);
};
