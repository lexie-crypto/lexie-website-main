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

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('[TransactionMonitor] ❌ Failed to parse NULLIFIERS response as JSON:', parseError.message);
      const textResponse = await response.text();
      console.error('[TransactionMonitor] ❌ Raw response was:', textResponse.substring(0, 500) + '...');
      throw new Error(`Invalid JSON response from Graph API: ${parseError.message}`);
    }
    
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

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('[TransactionMonitor] ❌ Failed to parse UNSHIELDS response as JSON:', parseError.message);
      const textResponse = await response.text();
      console.error('[TransactionMonitor] ❌ Raw response was:', textResponse.substring(0, 500) + '...');
      throw new Error(`Invalid JSON response from Graph API: ${parseError.message}`);
    }
    
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

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('[TransactionMonitor] ❌ Failed to parse SHIELD COMMITMENTS response as JSON:', parseError.message);
      const textResponse = await response.text();
      console.error('[TransactionMonitor] ❌ Raw response was:', textResponse.substring(0, 500) + '...');
      throw new Error(`Invalid JSON response from Graph API: ${parseError.message}`);
    }
    
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
 * Emergency hardcoded token decimals for change note processing
 * CRITICAL: Ensures USDT change notes get 6 decimals even if dynamic lookup fails
 */
const getKnownTokenDecimalsInMonitor = (tokenAddress, chainId) => {
  if (!tokenAddress) return null;
  
  const address = tokenAddress.toLowerCase();
  
  // Same hardcoded decimals as tx-unshield.js for consistency
  const knownTokens = {
    // Ethereum Mainnet
    1: {
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { decimals: 6, symbol: 'USDT' }, // USDT
      '0xa0b86a33e6416a86f2016c97db4ad0a23a5b7b73': { decimals: 6, symbol: 'USDC' }, // USDC
      '0x6b175474e89094c44da98b954eedeac495271d0f': { decimals: 18, symbol: 'DAI' }, // DAI
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { decimals: 8, symbol: 'WBTC' }, // WBTC
    },
    // Arbitrum
    42161: {
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { decimals: 6, symbol: 'USDT' }, // USDT
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { decimals: 6, symbol: 'USDC' }, // USDC Native
      '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': { decimals: 6, symbol: 'USDC.e' }, // USDC Bridged
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { decimals: 18, symbol: 'DAI' }, // DAI
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { decimals: 8, symbol: 'WBTC' }, // WBTC
    },
    // Polygon
    137: {
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { decimals: 6, symbol: 'USDT' }, // USDT
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { decimals: 6, symbol: 'USDC' }, // USDC
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { decimals: 18, symbol: 'DAI' }, // DAI
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { decimals: 8, symbol: 'WBTC' }, // WBTC
    },
    // BSC
    56: {
      '0x55d398326f99059ff775485246999027b3197955': { decimals: 18, symbol: 'USDT' }, // BSC USDT uses 18 decimals!
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { decimals: 18, symbol: 'USDC' }, // BSC USDC uses 18 decimals!
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': { decimals: 18, symbol: 'DAI' }, // DAI
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': { decimals: 18, symbol: 'BTCB' }, // BTCB
    }
  };
  
  const chainTokens = knownTokens[chainId];
  if (!chainTokens) return null;
  
  const tokenInfo = chainTokens[address];
  return tokenInfo || null;
};

/**
 * Monitor for a specific transaction to appear in RAILGUN events
 * Updated API to match user specification
 */
export const monitorTransactionInGraph = async ({
  txHash,
  chainId,
  transactionType, // 'shield' | 'unshield' | 'transfer'
  transactionDetails = null, // Additional transaction details for optimistic updates
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

        // ⚡ QUICKSYNC: Trigger immediate Railgun SDK refresh after Graph confirmation
        if ((transactionType === 'shield' || transactionType === 'unshield' || transactionType === 'transfer') && transactionDetails?.walletId) {
          console.log('[QuickSync] Triggered after Graph confirmation for', txHash, `(${transactionType})`);
          try {
            const { refreshBalances } = await import('@railgun-community/wallet');
            const { NETWORK_CONFIG, NetworkName } = await import('@railgun-community/shared-models');
            
            // Find the correct network config by matching chain ID using official NETWORK_CONFIG
            let networkName = null;
            let railgunChain = null;
            
            for (const [name, config] of Object.entries(NETWORK_CONFIG)) {
              if (config.chain.id === chainId) {
                networkName = name;
                railgunChain = config.chain;
                break;
              }
            }
            
            if (!networkName || !railgunChain) {
              throw new Error(`No network config found for chain ID: ${chainId}`);
            }
            
            console.log('[QuickSync] Starting Railgun SDK refresh for chain:', {
              chainId: railgunChain.id,
              chainType: railgunChain.type,
              walletId: transactionDetails.walletId.slice(0, 10) + '...'
            });
            
            // Execute QuickSync refresh with retries
            let quickSyncAttempt = 0;
            const maxRetries = 3;
            let quickSyncSuccess = false;
            
            while (quickSyncAttempt < maxRetries && !quickSyncSuccess) {
              quickSyncAttempt++;
              try {
                console.log(`[QuickSync] Attempt ${quickSyncAttempt}/${maxRetries} - calling refreshBalances...`);
                console.log('[QuickSync] Refreshing wallet ID:', transactionDetails.walletId);
                
                // Trigger Railgun SDK refresh with QuickSync (uses Graph internally)
                const walletIdFilter = [transactionDetails.walletId];
                await refreshBalances(railgunChain, walletIdFilter);
                
                console.log('[QuickSync] Completed successfully, balances updated');
                quickSyncSuccess = true;
                
              } catch (syncError) {
                console.error(`[QuickSync] Attempt ${quickSyncAttempt} failed:`, syncError.message);
                if (quickSyncAttempt >= maxRetries) {
                  throw new Error(`QuickSync failed after ${maxRetries} attempts: ${syncError.message}`);
                }
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 2000 * quickSyncAttempt));
              }
            }
            
            console.log('[QuickSync] ✅ Successfully completed - SDK has latest note state for proof generation');
            
          } catch (error) {
            console.error('[QuickSync] ❌ Failed to complete QuickSync:', error.message);
            // Don't throw - allow transaction processing to continue with warning
            console.warn('[QuickSync] ⚠️ Continuing without QuickSync - may cause balance sync issues');
          }
        }

        // 🎯 CAPTURE NOTES: Handle note capture/spending based on transaction type
        try {
        if (transactionType === 'shield' && events.length > 0) {
          console.log('[TransactionMonitor] 📝 Processing shield commitment for note capture');
            
            // Process each shield commitment
            for (const shieldCommitment of events) {
              if (shieldCommitment.preimage?.value && shieldCommitment.preimage?.token?.tokenAddress) {
                try {
                  console.log('[TransactionMonitor] 🛡️ Capturing shield note:', {
                    hash: shieldCommitment.hash,
                    value: shieldCommitment.preimage.value,
                    tokenAddress: shieldCommitment.preimage.token.tokenAddress
                  });

                  // Get wallet info from transactionDetails or current context
                  const walletAddress = transactionDetails?.walletAddress;
                  const walletId = transactionDetails?.walletId;
                  const tokenSymbol = transactionDetails?.tokenSymbol || 'UNKNOWN';
                  
                  // Get proper decimals from token data or transaction details
                  let resolvedDecimals = transactionDetails?.decimals;
                  if (!resolvedDecimals) {
                    // Try to get decimals from token info
                    try {
                      const { getTokenDecimals } = await import('../../hooks/useBalances.js');
                      resolvedDecimals = getTokenDecimals(shieldCommitment.preimage.token.tokenAddress, chainId);
                      console.log('[TransactionMonitor] 🔍 Retrieved token decimals:', {
                        tokenAddress: shieldCommitment.preimage.token.tokenAddress,
                        chainId,
                        decimals: resolvedDecimals
                      });
                    } catch (error) {
                      console.warn('[TransactionMonitor] ⚠️ Could not get token decimals, using default 18:', error);
                      resolvedDecimals = 18;
                    }
                  }

                  if (walletAddress && walletId) {
                    // Make request to Vercel proxy - NO client-side HMAC needed
                    const requestBody = {
                      walletAddress,
                      walletId,
                      chainId,
                      tokenSymbol,
                      decimals: resolvedDecimals,
                      shieldCommitment: {
                        hash: shieldCommitment.hash,
                        preimage: shieldCommitment.preimage,
                        treeNumber: shieldCommitment.treeNumber,
                        batchStartTreePosition: shieldCommitment.batchStartTreePosition,
                        transactionHash: txHash,
                        blockTimestamp: shieldCommitment.blockTimestamp,
                        commitmentType: shieldCommitment.commitmentType,
                        shieldKey: shieldCommitment.shieldKey,
                        fee: shieldCommitment.fee,
                        encryptedBundle: shieldCommitment.encryptedBundle
                      }
                    };

                    console.log('[TransactionMonitor] 🛡️ Making shield note capture request via proxy:', {
                      requestBody,
                      endpoint: '/api/wallet-metadata?action=capture-shield'
                    });

                    const response = await fetch('/api/wallet-metadata?action=capture-shield', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(requestBody)
                    });

                    if (response.ok) {
                      console.log('[TransactionMonitor] ✅ Shield note captured successfully');
                    } else {
                      const errorText = await response.text();
                      console.error('[TransactionMonitor] ❌ Failed to capture shield note:', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText
                      });
                    }
                  } else {
                    console.warn('[TransactionMonitor] ⚠️ Missing wallet details for shield note capture');
                  }
                } catch (error) {
                  console.error('[TransactionMonitor] ❌ Error capturing shield note:', error);
                }
              }
            }
        } else if (transactionType === 'unshield' && events.length > 0) {
          console.log('[TransactionMonitor] 🔓 Processing unshield event for note spending');
            
            // Process each unshield event (nullifiers) using atomic operation
            for (const nullifierEvent of events) {
              try {
                console.log('[TransactionMonitor] 🗑️ Processing unshield atomically:', {
                  nullifier: nullifierEvent.nullifier,
                  txHash: nullifierEvent.transactionHash,
                  hasChangeNote: !!transactionDetails?.changeCommitment
                });

                // Get wallet info from transactionDetails
                const walletAddress = transactionDetails?.walletAddress;
                const walletId = transactionDetails?.walletId;
                
                // 🚨 CRITICAL: Get proper decimals - especially important for USDT change notes (6 decimals)
                let decimals = transactionDetails?.decimals;
                if (!decimals || decimals === 18) { // Even if 18 was passed, double-check for USDT
                  console.log('[TransactionMonitor] 🔍 Decimals validation for change note processing:', {
                    providedDecimals: transactionDetails?.decimals,
                    tokenAddress: transactionDetails?.tokenAddress,
                    needsLookup: !decimals || decimals === 18
                  });
                  
                  // For unshield, we need to get decimals from the transaction details or token address
                  // If we have a tokenAddress in transactionDetails, use it
                  if (transactionDetails?.tokenAddress) {
                    try {
                      const { getTokenDecimals } = await import('../../hooks/useBalances.js');
                      const detectedDecimals = getTokenDecimals(transactionDetails.tokenAddress, chainId);
                      
                      if (detectedDecimals !== null && detectedDecimals !== undefined) {
                        decimals = detectedDecimals;
                        console.log('[TransactionMonitor] ✅ Retrieved unshield token decimals:', {
                          tokenAddress: transactionDetails.tokenAddress,
                          chainId,
                          decimals,
                          source: 'dynamic-lookup'
                        });
                      } else {
                        // Emergency hardcoded fallback for critical tokens like USDT
                        const hardcodedDecimals = getKnownTokenDecimalsInMonitor(transactionDetails.tokenAddress, chainId);
                        if (hardcodedDecimals !== null) {
                          decimals = hardcodedDecimals.decimals;
                          console.log('[TransactionMonitor] 🔧 Used hardcoded decimals for change note:', {
                            tokenAddress: transactionDetails.tokenAddress,
                            chainId,
                            decimals,
                            symbol: hardcodedDecimals.symbol,
                            source: 'hardcoded-fallback'
                          });
                        } else {
                          decimals = 18; // Last resort
                          console.warn('[TransactionMonitor] ⚠️ Using 18 decimals fallback for change note processing - risk for USDT!');
                        }
                      }
                    } catch (error) {
                      console.error('[TransactionMonitor] ❌ Failed to get unshield token decimals, trying hardcoded fallback:', error);
                      
                      // Emergency hardcoded fallback
                      const hardcodedDecimals = getKnownTokenDecimalsInMonitor(transactionDetails?.tokenAddress, chainId);
                      if (hardcodedDecimals !== null) {
                        decimals = hardcodedDecimals.decimals;
                        console.log('[TransactionMonitor] 🚨 Used emergency hardcoded decimals:', {
                          tokenAddress: transactionDetails?.tokenAddress,
                          decimals,
                          symbol: hardcodedDecimals.symbol,
                          source: 'emergency-hardcoded'
                        });
                      } else {
                        decimals = 18; // Final fallback
                        console.error('[TransactionMonitor] 🚨 CRITICAL: Using 18 decimals fallback - THIS COULD BREAK USDT CHANGE NOTES!');
                      }
                    }
                  } else {
                    console.warn('[TransactionMonitor] ⚠️ No tokenAddress available for decimals lookup in change note processing');
                    decimals = 18; // Fallback when no token address
                  }
                }

                if (walletAddress && walletId) {
                  const response = await fetch('/api/wallet-metadata?action=process-unshield', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      walletAddress,
                      walletId,
                      spentCommitmentHash: nullifierEvent.nullifier,
                      spentTxHash: nullifierEvent.transactionHash,
                      decimals,
                      changeCommitment: transactionDetails?.changeCommitment // Optional
                    })
                  });

                  if (response.ok) {
                    console.log('[TransactionMonitor] ✅ Unshield processed atomically');
                  } else {
                    console.error('[TransactionMonitor] ❌ Failed to process unshield atomically:', await response.text());
                  }
                } else {
                  console.warn('[TransactionMonitor] ⚠️ Missing wallet details for atomic unshield processing');
                }
              } catch (error) {
                console.error('[TransactionMonitor] ❌ Error processing unshield atomically:', error);
              }
            }
          }
        } catch (error) {
          console.error('[TransactionMonitor] ❌ Error in note processing:', error);
        }

        // 🎯 FIXED: Dispatch event with transaction details for optimistic updates
        const eventDetail = { 
          txHash, 
          chainId, 
          transactionType,
          events, // Include the actual Graph events for note processing
          ...transactionDetails, // Spread transaction details (amount, tokenAddress, tokenSymbol, decimals)
          decimals: transactionDetails?.decimals // Ensure decimals are included for proper optimistic updates
        };
        
        console.log('[TransactionMonitor] 📡 Dispatching transaction confirmed event with details:', {
          eventDetail,
          hasAmount: !!eventDetail.amount,
          hasTokenAddress: !!eventDetail.tokenAddress,
          hasTokenSymbol: !!eventDetail.tokenSymbol,
          eventCount: events.length
        });
        
        window.dispatchEvent(new CustomEvent('railgun-transaction-confirmed', {
          detail: eventDetail
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
export const monitorShieldTransaction = async (txHash, chainId, railgunWalletId, transactionDetails = null) => {
  console.log('[TransactionMonitor] 🛡️ Monitoring shield transaction:', txHash);
  
  return await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'shield',
    transactionDetails, // Pass transaction details for proper decimals handling
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
export const monitorUnshieldTransaction = async (txHash, chainId, railgunWalletId, transactionDetails = null) => {
  console.log('[TransactionMonitor] 🔓 Monitoring unshield transaction:', txHash);
  
  return await monitorTransactionInGraph({
    txHash,
    chainId,
    transactionType: 'unshield',
    transactionDetails, // Pass transaction details for proper decimals and change note handling
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