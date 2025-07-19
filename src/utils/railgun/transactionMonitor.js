/**
 * RAILGUN Transaction Monitor
 * Uses Graph API to detect when transactions appear in RAILGUN events
 * Based on official wallet/src/services/railgun/quick-sync/V2/quick-sync-events-graph-v2.ts
 */

import { waitForRailgunReady } from './engine.js';

/**
 * Auto-paginating query function (from graph-query.ts)
 */
const autoPaginatingQuery = async (
  query,
  blockNumber,
  maxQueryResults,
  prevResults = []
) => {
  const newResults = await Promise.race([
    query(blockNumber),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout querying Graph for RAILGUN Events')), 20000)
    )
  ]);
  
  if (newResults.length === 0) {
    return prevResults;
  }

  const totalResults = prevResults.concat(newResults);
  const overLimit = totalResults.length >= maxQueryResults;
  const lastResult = totalResults[totalResults.length - 1];
  const shouldQueryMore = newResults.length === 10000; // Match official limit
  
  if (!overLimit && shouldQueryMore) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return autoPaginatingQuery(query, lastResult.blockNumber, maxQueryResults, totalResults);
  }

  return totalResults;
};

/**
 * Remove duplicates by ID (from graph-util.ts)
 */
const removeDuplicatesByID = (array) => {
  const seen = new Set();
  return array.filter((item) => {
    const duplicate = seen.has(item.id);
    seen.add(item.id);
    return !duplicate;
  });
};

/**
 * Network source mapping (from official V2 implementation)
 */
const getSourceNameForNetwork = (chainId) => {
  const networkMapping = {
    1: 'ethereum',        // Ethereum
    56: 'bsc',           // BNB Chain
    137: 'matic',        // Polygon
    42161: 'arbitrum-one' // Arbitrum
  };
  
  const sourceName = networkMapping[chainId];
  if (!sourceName) {
    throw new Error(`No Graph API hosted service for chain ${chainId}`);
  }
  return sourceName;
};

/**
 * Get Graph API endpoint for network (official V2 pattern)
 */
const getGraphEndpoint = (chainId) => {
  try {
    const sourceName = getSourceNameForNetwork(chainId);
    // Using the official RAILGUN V2 subgraph endpoints
    return `https://api.thegraph.com/subgraphs/name/railgun-community/railgun-v2-${sourceName}`;
  } catch (error) {
    throw new Error(`No Graph endpoint for chain ${chainId}: ${error.message}`);
  }
};

/**
 * Query Graph API for nullifier events (matches official V2 structure)
 */
const queryNullifiers = async (chainId, fromBlock, txHash = null) => {
  const endpoint = getGraphEndpoint(chainId);
  
  // Official V2 Nullifiers query structure
  const query = `
    query Nullifiers($blockNumber: BigInt = 0, $txHash: Bytes) {
      nullifiers(
        orderBy: [blockNumber_ASC, nullifier_DESC]
        where: { 
          blockNumber_gte: $blockNumber
          ${txHash ? ', transactionHash: $txHash' : ''}
        }
        limit: 10000
      ) {
        id
        blockNumber
        nullifier
        transactionHash
        blockTimestamp
        treeNumber
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      query, 
      variables: { 
        blockNumber: fromBlock.toString(),
        ...(txHash && { txHash: txHash.toLowerCase() })
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Graph query failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Graph query errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data?.nullifiers || [];
};

/**
 * Query Graph API for unshield events (matches official V2 structure)  
 */
const queryUnshields = async (chainId, fromBlock, txHash = null) => {
  const endpoint = getGraphEndpoint(chainId);
  
  // Official V2 Unshields query structure
  const query = `
    query Unshields($blockNumber: BigInt = 0, $txHash: Bytes) {
      unshields(
        orderBy: [blockNumber_ASC, eventLogIndex_ASC]
        where: { 
          blockNumber_gte: $blockNumber
          ${txHash ? ', transactionHash: $txHash' : ''}
        }
        limit: 10000
      ) {
        id
        blockNumber
        to
        transactionHash
        fee
        blockTimestamp
        amount
        eventLogIndex
        token {
          id
          tokenType
          tokenSubID
          tokenAddress
        }
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      query, 
      variables: { 
        blockNumber: fromBlock.toString(),
        ...(txHash && { txHash: txHash.toLowerCase() })
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Graph query failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Graph query errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data?.unshields || [];
};

/**
 * Query Graph API for commitments (shield events - matches official V2 structure)
 */
const queryCommitments = async (chainId, fromBlock, txHash = null) => {
  const endpoint = getGraphEndpoint(chainId);
  
  // Official V2 Commitments query structure (simplified for transaction monitoring)
  const query = `
    query Commitments($blockNumber: BigInt = 0, $txHash: Bytes) {
      commitments(
        orderBy: [blockNumber_ASC, treePosition_ASC]
        where: { 
          blockNumber_gte: $blockNumber
          ${txHash ? ', transactionHash: $txHash' : ''}
        }
        limit: 10000
      ) {
        id
        treeNumber
        batchStartTreePosition
        treePosition
        blockNumber
        transactionHash
        blockTimestamp
        commitmentType
        hash
        ... on ShieldCommitment {
          shieldKey
          fee
          encryptedBundle
          preimage {
            npk
            value
            token {
              tokenAddress
              tokenType
              tokenSubID
            }
          }
        }
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      query, 
      variables: { 
        blockNumber: fromBlock.toString(),
        ...(txHash && { txHash: txHash.toLowerCase() })
      }
    }),
  });

  if (!response.ok) {
    throw new Error(`Graph query failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Graph query errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data?.commitments || [];
};

/**
 * Monitor for a specific transaction to appear in RAILGUN events
 */
export const monitorTransactionInGraph = async ({
  txHash,
  chainId,
  transactionType, // 'shield' | 'unshield'
  currentBlockNumber = null,
  maxWaitTime = 120000, // 2 minutes
  onFound = null
}) => {
  try {
    console.log('[TransactionMonitor] 🔍 Starting Graph monitoring for transaction:', {
      txHash,
      chainId,
      transactionType,
      currentBlockNumber,
      maxWaitTime: `${maxWaitTime/1000}s`
    });

    await waitForRailgunReady();

    // Get current block if not provided
    let fromBlock = currentBlockNumber;
    if (!fromBlock) {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(getRpcUrl(chainId));
        fromBlock = await provider.getBlockNumber();
        console.log('[TransactionMonitor] 📦 Current block number:', fromBlock);
      } catch (error) {
        console.warn('[TransactionMonitor] Failed to get current block, using recent estimate');
        fromBlock = Math.floor(Date.now() / 15000); // Approximate recent block
      }
    }

    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    let attempts = 0;
    const maxAttempts = Math.ceil(maxWaitTime / pollInterval);

    console.log('[TransactionMonitor] 🕒 Starting polling:', {
      fromBlock,
      pollInterval: `${pollInterval/1000}s`,
      maxAttempts,
      graphEndpoint: getGraphEndpoint(chainId)
    });

    while (Date.now() - startTime < maxWaitTime) {
      attempts++;
      
      try {
        console.log(`[TransactionMonitor] 🔍 Polling attempt ${attempts}/${maxAttempts} for ${transactionType} events...`);

        let events = [];
        
        if (transactionType === 'shield') {
          // Shield transactions create commitments
          events = await queryCommitments(chainId, fromBlock, txHash);
        } else if (transactionType === 'unshield') {
          // Unshield transactions create nullifiers AND unshield events
          const [nullifiers, unshields] = await Promise.all([
            queryNullifiers(chainId, fromBlock, txHash),
            queryUnshields(chainId, fromBlock, txHash)
          ]);
          events = [...nullifiers, ...unshields];
        }

        // Remove duplicates and filter by transaction hash
        const filteredEvents = removeDuplicatesByID(events);
        console.log(`[TransactionMonitor] 📊 Found ${filteredEvents.length} ${transactionType} events in this poll`);

        // Check if our transaction is in the events
        const targetEvent = filteredEvents.find(event => 
          event.transactionHash?.toLowerCase() === txHash.toLowerCase()
        );

        if (targetEvent) {
          const elapsed = Date.now() - startTime;
          console.log('[TransactionMonitor] 🎉 Transaction found in RAILGUN events!', {
            txHash,
            blockNumber: targetEvent.blockNumber,
            eventType: targetEvent.commitmentType || 'nullifier',
            elapsedTime: `${elapsed/1000}s`,
            attempts
          });

          // Call the callback if provided
          if (onFound && typeof onFound === 'function') {
            console.log('[TransactionMonitor] 📞 Calling onFound callback...');
            await onFound(targetEvent);
          }

          return {
            found: true,
            event: targetEvent,
            elapsedTime: elapsed,
            attempts
          };
        }

        // Wait before next poll (with small delay like official implementation)
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error(`[TransactionMonitor] ❌ Poll attempt ${attempts} failed:`, error);
        
        // Wait a bit longer on error
        await new Promise(resolve => setTimeout(resolve, pollInterval * 2));
      }
    }

    console.log('[TransactionMonitor] ⏰ Monitoring timed out without finding transaction');
    return {
      found: false,
      elapsedTime: maxWaitTime,
      attempts
    };

  } catch (error) {
    console.error('[TransactionMonitor] 💥 Transaction monitoring failed:', error);
    throw error;
  }
};

/**
 * Get RPC URL for chain
 */
const getRpcUrl = (chainId) => {
  const rpcUrls = {
    1: 'https://eth.llamarpc.com',
    42161: 'https://arbitrum.llamarpc.com',
    137: 'https://polygon.llamarpc.com',
    56: 'https://bsc.llamarpc.com',
  };
  return rpcUrls[chainId];
};

/**
 * Monitor shield transaction and auto-refresh balances when found
 */
export const monitorShieldTransaction = async (txHash, chainId, walletID) => {
  console.log('[TransactionMonitor] 🛡️ Monitoring shield transaction:', txHash);
  
  const result = await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'shield',
    onFound: async (event) => {
      console.log('[TransactionMonitor] 🎯 Shield transaction indexed! Triggering balance refresh...');
      
      try {
        // Import and trigger balance refresh
        const { clearStaleBalanceCacheAndRefresh } = await import('./balances.js');
        await clearStaleBalanceCacheAndRefresh(walletID, chainId);
        
        // Also dispatch event for immediate UI update
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('railgun-transaction-confirmed', {
            detail: {
              txHash,
              chainId,
              transactionType: 'shield',
              event,
              timestamp: Date.now()
            }
          }));
        }
        
        console.log('[TransactionMonitor] ✅ Balance refresh completed after shield detection');
      } catch (error) {
        console.error('[TransactionMonitor] ❌ Balance refresh failed after shield detection:', error);
      }
    }
  });

  return result;
};

/**
 * Monitor unshield transaction and auto-refresh balances when found
 */
export const monitorUnshieldTransaction = async (txHash, chainId, walletID) => {
  console.log('[TransactionMonitor] 🔓 Monitoring unshield transaction:', txHash);
  
  const result = await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'unshield',
    onFound: async (event) => {
      console.log('[TransactionMonitor] 🎯 Unshield transaction indexed! Triggering balance refresh...');
      
      try {
        const { clearStaleBalanceCacheAndRefresh } = await import('./balances.js');
        await clearStaleBalanceCacheAndRefresh(walletID, chainId);
        
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('railgun-transaction-confirmed', {
            detail: {
              txHash,
              chainId,
              transactionType: 'unshield',
              event,
              timestamp: Date.now()
            }
          }));
        }
        
        console.log('[TransactionMonitor] ✅ Balance refresh completed after unshield detection');
      } catch (error) {
        console.error('[TransactionMonitor] ❌ Balance refresh failed after unshield detection:', error);
      }
    }
  });

  return result;
};

// Export for use in other modules
export default {
  monitorTransactionInGraph,
  monitorShieldTransaction,
  monitorUnshieldTransaction,
}; 