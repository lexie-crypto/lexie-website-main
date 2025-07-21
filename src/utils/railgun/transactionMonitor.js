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
 * Get Graph API endpoint - Always use Vercel proxy with updated Squid endpoints
 */
const getGraphEndpoint = (chainId) => {
  // Always use the API proxy since it now has the correct Squid endpoints
  return { 
    isProxy: true, 
    endpoint: '/api/graph' 
  };
};

/**
 * Query Graph API for nullifier events (production: Vercel proxy, dev: direct with CORS)
 */
const queryNullifiers = async (chainId, fromBlock, txHash = null) => {
  try {
    const { isProxy, endpoint } = getGraphEndpoint(chainId);
    
    // Updated Squid V2 Nullifiers query structure
    const query = `
      query Nullifiers($blockNumber: BigInt = 0, $txHash: Bytes) {
        nullifiers(
          orderBy: blockNumber_ASC
          where: { 
            blockNumber_gte: $blockNumber
            ${txHash ? ', transactionHash_eq: $txHash' : ''}
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

    const variables = {
      blockNumber: fromBlock.toString(),
      ...(txHash && { txHash: txHash.toLowerCase() })
    };

    const requestBody = { 
      chainId,
      query, 
      variables
    };

    console.log('[TransactionMonitor] 📤 NULLIFIERS API CALL DEBUG:');
    console.log('[TransactionMonitor] - Endpoint:', endpoint);
    console.log('[TransactionMonitor] - Is Proxy:', isProxy);
    console.log('[TransactionMonitor] - Chain ID:', chainId);
    console.log('[TransactionMonitor] - Query length:', query.length);
    console.log('[TransactionMonitor] - Variables:', JSON.stringify(variables, null, 2));
    console.log('[TransactionMonitor] - Full request body:', JSON.stringify(requestBody, null, 2));

    let response;
    
    if (isProxy) {
      // Production: Use Vercel API proxy
      console.log('[TransactionMonitor] 🚀 Making proxy request to:', endpoint);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      console.log('[TransactionMonitor] 📡 Proxy response status:', response.status, response.statusText);
    } 

    if (!response.ok) {
      console.error('[TransactionMonitor] ❌ NULLIFIERS request failed:', {
        status: response.status,
        statusText: response.statusText,
        endpoint,
        requestBody
      });
      
      // Try to get error response body
      try {
        const errorText = await response.text();
        console.error('[TransactionMonitor] ❌ Error response body:', errorText);
      } catch (err) {
        console.error('[TransactionMonitor] ❌ Could not read error response:', err);
      }
      
      throw new Error(`Graph request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[TransactionMonitor] 📥 NULLIFIERS response received:', {
      hasData: !!data.data,
      hasErrors: !!data.errors,
      dataKeys: data.data ? Object.keys(data.data) : [],
      resultCount: data.data?.nullifiers?.length || 0
    });
    
    // Check for proxy-level errors (Vercel proxy)
    if (isProxy && data.error) {
      throw new Error(`Graph proxy error: ${data.error}`);
    }
    
    // Check for GraphQL errors
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data?.nullifiers || [];
    
  } catch (error) {
    console.warn('[TransactionMonitor] Nullifiers query failed, returning empty results:', error.message);
    return [];
  }
};

/**
 * Query Graph API for unshield events (production: Vercel proxy, dev: direct with CORS) 
 */
const queryUnshields = async (chainId, fromBlock, txHash = null) => {
  try {
    const { isProxy, endpoint } = getGraphEndpoint(chainId);
    
    // Updated Squid V2 Unshields query structure
    const query = `
      query Unshields($blockNumber: BigInt = 0, $txHash: Bytes) {
        unshields(
          orderBy: blockNumber_ASC
          where: { 
            blockNumber_gte: $blockNumber
            ${txHash ? ', transactionHash_eq: $txHash' : ''}
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

    const variables = {
      blockNumber: fromBlock.toString(),
      ...(txHash && { txHash: txHash.toLowerCase() })
    };

    const requestBody = { 
      chainId,
      query, 
      variables
    };

    console.log('[TransactionMonitor] 📤 UNSHIELDS API CALL DEBUG:');
    console.log('[TransactionMonitor] - Endpoint:', endpoint);
    console.log('[TransactionMonitor] - Is Proxy:', isProxy);
    console.log('[TransactionMonitor] - Chain ID:', chainId);
    console.log('[TransactionMonitor] - Query length:', query.length);
    console.log('[TransactionMonitor] - Variables:', JSON.stringify(variables, null, 2));
    console.log('[TransactionMonitor] - Full request body:', JSON.stringify(requestBody, null, 2));

    let response;
    
    if (isProxy) {
      // Production: Use Vercel API proxy
      console.log('[TransactionMonitor] 🚀 Making proxy request to:', endpoint);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      console.log('[TransactionMonitor] 📡 Proxy response status:', response.status, response.statusText);
    } 
      

    if (!response.ok) {
      console.error('[TransactionMonitor] ❌ UNSHIELDS request failed:', {
        status: response.status,
        statusText: response.statusText,
        endpoint,
        requestBody
      });
      
      // Try to get error response body
      try {
        const errorText = await response.text();
        console.error('[TransactionMonitor] ❌ Error response body:', errorText);
      } catch (err) {
        console.error('[TransactionMonitor] ❌ Could not read error response:', err);
      }
      
      throw new Error(`Graph request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[TransactionMonitor] 📥 UNSHIELDS response received:', {
      hasData: !!data.data,
      hasErrors: !!data.errors,
      dataKeys: data.data ? Object.keys(data.data) : [],
      resultCount: data.data?.unshields?.length || 0
    });
    
    // Check for proxy-level errors (Vercel proxy)
    if (isProxy && data.error) {
      throw new Error(`Graph proxy error: ${data.error}`);
    }
    
    // Check for GraphQL errors
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data?.unshields || [];
    
  } catch (error) {
    console.warn('[TransactionMonitor] Unshields query failed, returning empty results:', error.message);
    return [];
  }
};

/**
 * Query Graph API for commitments (production: Vercel proxy, dev: direct with CORS)
 */
const queryCommitments = async (chainId, fromBlock, txHash = null) => {
  try {
    const { isProxy, endpoint } = getGraphEndpoint(chainId);
    
    // Updated Squid V2 Shield Commitments query structure
    const query = `
      query ShieldCommitments($blockNumber: BigInt = 0, $txHash: Bytes) {
        shieldCommitments(
          orderBy: blockNumber_ASC
          where: { 
            blockNumber_gte: $blockNumber
            ${txHash ? ', transactionHash_eq: $txHash' : ''}
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
    `;

    const variables = {
      blockNumber: fromBlock.toString(),
      ...(txHash && { txHash: txHash.toLowerCase() })
    };

    const requestBody = { 
      chainId,
      query, 
      variables
    };

    console.log('[TransactionMonitor] 📤 SHIELD COMMITMENTS API CALL DEBUG:');
    console.log('[TransactionMonitor] - Endpoint:', endpoint);
    console.log('[TransactionMonitor] - Is Proxy:', isProxy);
    console.log('[TransactionMonitor] - Chain ID:', chainId);
    console.log('[TransactionMonitor] - Query length:', query.length);
    console.log('[TransactionMonitor] - Variables:', JSON.stringify(variables, null, 2));
    console.log('[TransactionMonitor] - Full request body:', JSON.stringify(requestBody, null, 2));

    let response;
    
    if (isProxy) {
      // Production: Use Vercel API proxy
      console.log('[TransactionMonitor] 🚀 Making proxy request to:', endpoint);
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      console.log('[TransactionMonitor] 📡 Proxy response status:', response.status, response.statusText);
    }

    if (!response.ok) {
      console.error('[TransactionMonitor] ❌ SHIELD COMMITMENTS request failed:', {
        status: response.status,
        statusText: response.statusText,
        endpoint,
        requestBody
      });
      
      // Try to get error response body
      try {
        const errorText = await response.text();
        console.error('[TransactionMonitor] ❌ Error response body:', errorText);
      } catch (err) {
        console.error('[TransactionMonitor] ❌ Could not read error response:', err);
      }
      
      throw new Error(`Graph request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[TransactionMonitor] 📥 SHIELD COMMITMENTS response received:', {
      hasData: !!data.data,
      hasErrors: !!data.errors,
      dataKeys: data.data ? Object.keys(data.data) : [],
      resultCount: data.data?.shieldCommitments?.length || 0
    });
    
    // Check for proxy-level errors (Vercel proxy)
    if (isProxy && data.error) {
      throw new Error(`Graph proxy error: ${data.error}`);
    }
    
    // Check for GraphQL errors
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data?.shieldCommitments || [];
    
  } catch (error) {
    console.warn('[TransactionMonitor] Shield commitments query failed, returning empty results:', error.message);
    return [];
  }
};

/**
 * Monitor for a specific transaction to appear in RAILGUN events
 * Updated API to match user specification
 */
export const monitorTransactionInGraph = async ({
  txHash,
  chainId,
  transactionType, // 'shield' | 'unshield' | 'transfer'
  listener = null, // Callback when transaction is detected
  currentBlockNumber = null,
  maxWaitTime = 120000, // 2 minutes
}) => {
  try {
    console.log('[TransactionMonitor] 🔍 Starting Graph monitoring for transaction:', {
      txHash,
      chainId,
      transactionType,
      currentBlockNumber,
      maxWaitTime: `${maxWaitTime/1000}s`,
      hasListener: !!listener
    });

    await waitForRailgunReady();

    // Cache block number after first Alchemy call
    let blockNumber = null;
    const { ethers } = await import('ethers');
    const rpcUrl = await getRpcUrl(chainId);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    if (!blockNumber) {
      const receipt = await provider.getTransactionReceipt(txHash);
      blockNumber = receipt?.blockNumber;
    }

    if (blockNumber) {
      console.log(`[TransactionMonitor] Cached block number for ${txHash}: ${blockNumber}`);
    }

    console.log('[TransactionMonitor] ⏳ Starting Graph polling...');

    // Poll the Graph endpoint
    const startTime = Date.now();
    const pollInterval = 30000; // 30 seconds
    let attempts = 0;
    const maxAttempts = 40;

    const { isProxy, endpoint } = getGraphEndpoint(chainId);
    console.log('[TransactionMonitor] 🕒 Starting polling:', {
      blockNumber,
      pollInterval: `${pollInterval/1000}s`,
      maxAttempts,
      graphEndpoint: endpoint,
      isProxy,
      chainId
    });

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`[TransactionMonitor] 🔍 Polling attempt ${attempts}/${maxAttempts} for ${transactionType} events on block ${blockNumber} with txHash ${txHash}`);

      let events = [];
      if (transactionType === 'shield') {
        events = await queryCommitments(chainId, blockNumber, txHash);
      } else if (transactionType === 'unshield') {
        events = await queryUnshields(chainId, blockNumber, txHash);
      } else if (transactionType === 'transfer') {
        events = await queryNullifiers(chainId, blockNumber, txHash);
      }

      const hasEvent = events.length > 0;

      if (hasEvent) {
        console.log('[TransactionMonitor] 🎉 Event confirmed in Graph, dispatching transaction confirmed event');

        // 🎯 FIXED: Just dispatch event - let useBalances hook handle refresh when appropriate
        window.dispatchEvent(new CustomEvent('railgun-transaction-confirmed', {
          detail: { txHash, chainId, transactionType }
        }));

        return { found: true, elapsedTime: Date.now() - startTime };
      }

      if (listener && typeof listener === 'function') {
        listener({ progress: `Checking... (${attempts}/${maxAttempts})` });
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.warn('[TransactionMonitor] ❌ Transaction confirmation timed out but tx was mined');
    if (listener && typeof listener === 'function') {
      listener({ timeout: true });
    }
    return { found: false, elapsedTime: Date.now() - startTime };
  } catch (error) {
    console.error('[TransactionMonitor] ❌ Error during transaction monitoring:', error);
    throw error;
  }
};

/**
 * Get RPC URL for chain using the existing Alchemy configuration
 */
const getRpcUrl = async (chainId) => {
  try {
    // Import the existing RPC configuration that actually works
    const { RPC_URLS } = await import('../../config/environment.js');
    
    const chainMapping = {
      1: RPC_URLS.ethereum,
      42161: RPC_URLS.arbitrum,
      137: RPC_URLS.polygon,
      56: RPC_URLS.bsc,
    };
    
    const rpcUrl = chainMapping[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    
    console.log(`[TransactionMonitor] Using Alchemy RPC for chain ${chainId}:`, rpcUrl?.slice(0, 50) + '...');
    return rpcUrl;
  } catch (error) {
    console.error('[TransactionMonitor] Failed to get RPC URL:', error);
    throw new Error(`Failed to get RPC URL for chain ${chainId}: ${error.message}`);
  }
};

/**
 * Monitor shield transaction with enhanced listener integration
 */
export const monitorShieldTransaction = async (txHash, chainId, railgunWalletId) => {
  console.log('[TransactionMonitor] 🛡️ Monitoring shield transaction:', txHash);
  
  return await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'shield',
    listener: async (event) => {
      console.log(`[TransactionMonitor] ✅ Shield tx ${txHash} indexed on chain ${chainId}`);
      
      // 🎯 FIXED: Just dispatch event - let useBalances hook handle refresh when appropriate
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
    }
  });
};

/**
 * Monitor unshield transaction with enhanced listener integration
 */
export const monitorUnshieldTransaction = async (txHash, chainId, railgunWalletId) => {
  console.log('[TransactionMonitor] 🔓 Monitoring unshield transaction:', txHash);
  
  return await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'unshield',
    listener: async (event) => {
      console.log(`[TransactionMonitor] ✅ Unshield tx ${txHash} indexed on chain ${chainId}`);
      
      // 🎯 FIXED: Just dispatch event - let useBalances hook handle refresh when appropriate
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
    }
  });
};

/**
 * NEW: Monitor private transfer transaction
 */
export const monitorTransferTransaction = async (txHash, chainId, railgunWalletId) => {
  console.log('[TransactionMonitor] 🔄 Monitoring transfer transaction:', txHash);
  
  return await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'transfer',
    listener: async (event) => {
      console.log(`[TransactionMonitor] ✅ Transfer tx ${txHash} indexed on chain ${chainId}`);
      
      // 🎯 FIXED: Just dispatch event - let useBalances hook handle refresh when appropriate
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('railgun-transaction-confirmed', {
          detail: {
            txHash,
            chainId,
            transactionType: 'transfer',
            event,
            timestamp: Date.now()
          }
        }));
      }
    }
  });
};

// Export for use in other modules
export default {
  monitorTransactionInGraph,
  monitorShieldTransaction,
  monitorUnshieldTransaction,
  monitorTransferTransaction,
}; 