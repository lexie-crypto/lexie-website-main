  /**
   * RAILGUN Private Balances Management
   * Following official docs: https://docs.railgun.org/developer-guide/wallet/private-balances
   * 
   * Implements:
   * - Private balance fetching and management
   * - Balance sync callbacks and updates
   * - Token information and formatting
   * - Balance refresh and monitoring
   */

  import {
    rescanFullUTXOMerkletreesAndWallets,
    fullRescanUTXOMerkletreesAndWalletsForNetwork,
    getTokenDataERC20,
    searchableERC20s,
  } from '@railgun-community/wallet';
  import { 
    NetworkName,
    formatToLocaleWithMinDecimals,
    RailgunERC20Amount,
    NETWORK_CONFIG,
  } from '@railgun-community/shared-models';
     import { formatUnits, parseUnits, isAddress, getAddress } from 'ethers';
   import { waitForRailgunReady } from './engine.js';
   import { getCurrentWalletID } from './wallet.js';
   import { refreshBalances } from '@railgun-community/wallet';
   import { WalletService } from '../../lib/walletService';

   // Helper to normalize token addresses (following official V2 pattern)
  const normalizeTokenAddress = (tokenAddress) => {
    if (!tokenAddress || tokenAddress === '0x00' || tokenAddress === '0x0000000000000000000000000000000000000000') {
      return undefined; // Native token
    }
    
    try {
      // Use ethers.js getAddress() to normalize and checksum the address (like V2 formatters)
      return getAddress(tokenAddress);
    } catch (error) {
      console.warn('[RailgunBalances] Invalid token address:', tokenAddress, error);
      return tokenAddress; // Return as-is if normalization fails
    }
  };

        /**
   * Network mapping for Railgun
   */
  const NETWORK_MAPPING = {
    1: NetworkName.Ethereum,
    42161: NetworkName.Arbitrum,
    137: NetworkName.Polygon,
    56: NetworkName.BNBChain,
  };

  /**
   * Get Railgun network name from chain ID
   * @param {number} chainId - Chain ID
   * @returns {NetworkName} Railgun network name
   */
  const getRailgunNetworkName = (chainId) => {
    const networkName = NETWORK_MAPPING[chainId];
    if (!networkName) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    return networkName;
  };

     /**
    * Get private token balances for a wallet (ALWAYS FRESH - triggers RAILGUN engine scan)
    * @param {string} walletID - RAILGUN wallet ID
    * @param {number} chainId - Chain ID
    * @returns {Array} Array of fresh token balance objects from RAILGUN engine
    */
   export const getPrivateBalances = async (walletID, chainId) => {
     try {
       console.log('[RailgunBalances] 📦 Getting private balances from backend cache (NO AUTO-SCAN):', {
         walletID: walletID?.slice(0, 8) + '...',
         chainId,
       });
       
       // Get cached balances from backend - NO automatic RAILGUN scans to prevent infinite loops
       const backendData = await WalletService.getPrivateBalances(walletID, chainId);
       
       if (backendData && backendData.balances && backendData.balances.length > 0) {
         console.log('[RailgunBalances] ✅ Retrieved private balances from backend cache:', {
           count: backendData.balances.length,
           tokens: backendData.balances.map(b => `${b.symbol}: ${b.formattedBalance}`),
           source: 'Backend Redis cache',
           updatedAt: new Date(backendData.updatedAt).toISOString()
         });
         return backendData.balances;
       }
       
       console.log('[RailgunBalances] ℹ️ No private balances found in backend cache');
       return [];
       
     } catch (error) {
       console.error('[RailgunBalances] ❌ Failed to get private balances from backend:', error);
       return [];
     }
   };

  /**
   * EXPLICIT REFRESH: Trigger fresh RAILGUN scan and store to backend
   * ONLY call this on page load or shield transaction confirmed - NOT from UI components
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {Promise<Array>} Fresh balance array from RAILGUN engine
   */
  export const refreshPrivateBalancesAndStore = async (walletID, chainId) => {
    try {
      console.log('[RailgunBalances] 🔥 EXPLICIT REFRESH: Triggering fresh RAILGUN scan + backend storage:', {
        walletID: walletID?.slice(0, 8) + '...',
        chainId,
        source: 'Explicit refresh only'
      });
      
      await waitForRailgunReady();
      
      // Trigger fresh balance refresh to get latest UTXO state
      await refreshPrivateBalances(walletID, chainId);
      
      // Wait a moment for the callback to process and store to backend
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get the freshly stored data from backend
      const freshData = await WalletService.getPrivateBalances(walletID, chainId);
      
      if (freshData && freshData.balances && freshData.balances.length > 0) {
        console.log('[RailgunBalances] ✅ Explicit refresh completed - fresh data stored to backend:', {
          count: freshData.balances.length,
          tokens: freshData.balances.map(b => `${b.symbol}: ${b.formattedBalance}`),
          source: 'Fresh RAILGUN scan + backend storage',
          updatedAt: new Date(freshData.updatedAt).toISOString()
        });
        return freshData.balances;
      }
      
      console.log('[RailgunBalances] ⚠️ No balances after explicit refresh');
      return [];
      
    } catch (error) {
      console.error('[RailgunBalances] ❌ Explicit refresh failed:', error);
      
      // Fallback to backend cache if refresh failed
      try {
        const fallbackData = await WalletService.getPrivateBalances(walletID, chainId);
        if (fallbackData && fallbackData.balances) {
          console.log('[RailgunBalances] 📦 Using backend cache after refresh failure');
          return fallbackData.balances;
        }
      } catch (fallbackError) {
        console.warn('[RailgunBalances] Backend fallback also failed:', fallbackError);
      }
      
      return [];
    }
  };

  /**
   * DEPRECATED: Get private balances from backend cache (for fallback only)
   * Use getPrivateBalances() for cached data from backend
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {Promise<Array>} Cached balance array from backend or empty array
   */
  export const getPrivateBalancesFromCache = async (walletID, chainId) => {
    try {
      if (!walletID || !chainId) {
        return [];
      }

      console.log('[RailgunBalances] 📦 DEPRECATED: Getting private balances from backend cache:', {
        walletID: walletID?.slice(0, 8) + '...',
        chainId
      });
      
      const backendData = await WalletService.getPrivateBalances(walletID, chainId);
      
      if (backendData && backendData.balances) {
        console.log('[RailgunBalances] ✅ Found backend cache data:', {
          count: backendData.balances.length,
          tokens: backendData.balances.map(b => `${b.symbol}: ${b.formattedBalance}`),
          updatedAt: new Date(backendData.updatedAt).toISOString()
        });
        return backendData.balances;
      }
      
      console.log('[RailgunBalances] ℹ️ No backend cache data found');
      return [];
      
    } catch (error) {
      console.error('[RailgunBalances] Failed to get backend cache data:', error);
      return [];
    }
  };

  /**
   * Get token information from Railgun
   * @param {string} tokenAddress - Token contract address
   * @param {number} chainId - Chain ID
   * @returns {Object} Token information
   */
  export const getTokenInfo = async (tokenAddress, chainId) => {
    try {
      await waitForRailgunReady();
      
      const networkName = getRailgunNetworkName(chainId);
      
      // Handle native token (null, undefined, or zero address)
      if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000' || tokenAddress === null) {
        const nativeInfo = getNativeTokenInfo(chainId);
        console.log('[RailgunBalances] Resolved native token info:', nativeInfo);
        return nativeInfo;
      }
      
      // Get ERC20 token data
      console.log('[RailgunBalances] Looking up ERC20 token data for:', tokenAddress);
      const tokenData = await getTokenDataERC20(networkName, tokenAddress);
      
      if (tokenData) {
        const result = {
          address: tokenAddress,
          symbol: tokenData.symbol,
          name: tokenData.name,
          decimals: tokenData.decimals,
          isNative: false,
        };
        console.log('[RailgunBalances] ✅ Resolved ERC20 token info:', result);
        return result;
      }
      
      console.warn('[RailgunBalances] ❌ Could not resolve ERC20 token data for:', tokenAddress);
      return null;
      
    } catch (error) {
      console.error('[RailgunBalances] Failed to get token info:', error);
      return null;
    }
  };

  /**
   * Get native token information for chain
   * @param {number} chainId - Chain ID
   * @returns {Object} Native token info
   */
  const getNativeTokenInfo = (chainId) => {
    const nativeTokens = {
      1: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
      42161: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
      137: { symbol: 'MATIC', name: 'Polygon', decimals: 18 },
      56: { symbol: 'BNB', name: 'BNB Smart Chain', decimals: 18 },
    };
    
    const nativeToken = nativeTokens[chainId];
    if (nativeToken) {
      return {
        address: undefined,
        symbol: nativeToken.symbol,
        name: nativeToken.name,
        decimals: nativeToken.decimals,
        isNative: true,
      };
    }
    
    return null;
  };

  /**
   * Refresh private balances for a wallet (triggers callback-based updates)
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {Array} Current cached balance array
   */
  export const refreshPrivateBalances = async (walletID, chainId) => {
    try {
      await waitForRailgunReady();
      
      const networkName = getRailgunNetworkName(chainId);
      
      console.log('[RailgunBalances] 🎯 ONE-TIME POLL: temporarily resuming provider for single refresh...');
      
      // 🎯 ONE-TIME POLL: Resume provider only for this single operation
      const { resumeIsolatedPollingProviderForNetwork, pauseAllPollingProviders } = await import('@railgun-community/wallet');
      
      try {
        // Resume provider for this network temporarily
        resumeIsolatedPollingProviderForNetwork(networkName);
        console.log(`[RailgunBalances] ▶️ Temporarily resumed provider for ${networkName}`);
        
        // Get the chain configuration
        const { chain } = NETWORK_CONFIG[networkName];
        
        // Trigger RAILGUN balance refresh - this will cause callbacks to fire
        await refreshBalances(chain, [walletID]);
        
        console.log('[RailgunBalances] Private balance refresh triggered - waiting for callbacks');
        
        // Small delay to allow the refresh to process
        await new Promise(resolve => setTimeout(resolve, 6000)); // 6 second delay
        
      } finally {
        // 🛑 CRITICAL: Always pause providers again after ONE refresh
        pauseAllPollingProviders();
        console.log(`[RailgunBalances] ⏸️ Paused all providers after ONE-TIME refresh`);
      }
      
      // Return current cached balances - real update comes through callbacks
      return getPrivateBalances(walletID, chainId);
      
    } catch (error) {
      console.error('[RailgunBalances] Failed to refresh private balances:', error);
      throw error;
    }
  };

  /**
   * Perform full rescan of UTXO merkletrees and wallets
   * Use this when balances appear incorrect or missing
   * @param {number} chainId - Chain ID to rescan
   */
  export const performFullRescan = async (chainId) => {
    try {
      await waitForRailgunReady();
      
      const networkName = getRailgunNetworkName(chainId);
      
      console.log('[RailgunBalances] Starting full rescan for network:', networkName);
      
      // Perform full rescan for the specific network
      await fullRescanUTXOMerkletreesAndWalletsForNetwork(networkName);
      
      console.log('[RailgunBalances] Full rescan completed for:', networkName);
      
    } catch (error) {
      console.error('[RailgunBalances] Full rescan failed:', error);
      throw new Error(`Full rescan failed: ${error.message}`);
    }
  };

  /**
   * Perform full rescan for all networks and wallets
   * Use sparingly as this is resource intensive
   */
  export const performGlobalRescan = async () => {
    try {
      await waitForRailgunReady();
      
      console.log('[RailgunBalances] Starting global rescan...');
      
      // Perform full rescan for all networks
      await rescanFullUTXOMerkletreesAndWallets();
      
      console.log('[RailgunBalances] Global rescan completed');
      
    } catch (error) {
      console.error('[RailgunBalances] Global rescan failed:', error);
      throw new Error(`Global rescan failed: ${error.message}`);
    }
  };

  /**
   * Search for ERC20 tokens
   * @param {string} query - Search query (name, symbol, or address)
   * @param {number} chainId - Chain ID
   * @returns {Array} Array of matching tokens
   */
  export const searchTokens = async (query, chainId) => {
    try {
      await waitForRailgunReady();
      
      const networkName = getRailgunNetworkName(chainId);
      
      console.log('[RailgunBalances] Searching tokens:', { query, networkName });
      
      // Search for ERC20 tokens
      const tokens = await searchableERC20s(networkName);
      
      // Filter tokens based on query
      const filteredTokens = tokens.filter(token => {
        const queryLower = query.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(queryLower) ||
          token.name.toLowerCase().includes(queryLower) ||
          token.address.toLowerCase().includes(queryLower)
        );
      });
      
      console.log('[RailgunBalances] Found tokens:', filteredTokens.length);
      
      return filteredTokens;
      
    } catch (error) {
      console.error('[RailgunBalances] Token search failed:', error);
      return [];
    }
  };

  /**
   * Get cached balances (if available)
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {Array|null} Cached balances or null
   */
  export const getCachedBalances = (walletID, chainId) => {
    const cacheKey = `${walletID}-${chainId}`;
    return balanceCache.get(cacheKey) || null;
  };

  /**
   * Check if cached balances are fresh (within 30 seconds)
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {boolean} True if cache is fresh
   */
  export const isCacheFresh = (walletID, chainId) => {
    const cacheKey = `${walletID}-${chainId}`;
        const lastUpdate = balanceCache.getLastUpdate(cacheKey);
    
    if (!lastUpdate) {
      return false;
    }
    
    const cacheAge = Date.now() - lastUpdate;
    return cacheAge < 30000; // 30 seconds
  };

  /**
   * Format token amount for display
   * @param {string} amount - Raw amount string
   * @param {number} decimals - Token decimals
   * @param {number} minDecimals - Minimum decimal places
   * @returns {string} Formatted amount
   */
  export const formatTokenAmount = (amount, decimals, minDecimals = 2) => {
    try {
      const formatted = formatUnits(amount, decimals);
      const num = parseFloat(formatted);
      
      if (num === 0) {
        return '0';
      }
      
      // Use Railgun's formatting helper if available
      if (formatToLocaleWithMinDecimals) {
        return formatToLocaleWithMinDecimals(num, minDecimals);
      }
      
      // Fallback formatting
      return num.toLocaleString(undefined, {
        minimumFractionDigits: minDecimals,
        maximumFractionDigits: decimals > 6 ? 6 : decimals,
      });
      
    } catch (error) {
      console.error('[RailgunBalances] Amount formatting failed:', error);
      return '0';
    }
  };

  /**
   * Parse token amount from user input
   * @param {string} amount - User input amount
   * @param {number} decimals - Token decimals
   * @returns {string} Parsed amount in base units
   */
  export const parseTokenAmount = (amount, decimals) => {
    try {
      if (!amount || amount === '' || amount === '0') {
        return '0';
      }
      
      const result = parseUnits(amount.toString(), decimals);
      return result.toString();
      
    } catch (error) {
      console.error('[RailgunBalances] Amount parsing failed:', error);
      throw new Error(`Invalid amount: ${amount}`);
    }
  };

  /**
   * Clear balance cache
   */
  export const clearBalanceCache = () => {
    console.warn('[RailgunBalances] 🗑️ BALANCE CACHE CLEARED - this should only happen intentionally!');
    console.trace('[RailgunBalances] Cache clear stack trace:');
    balanceCache.clear();
    console.log('[RailgunBalances] Balance cache cleared');
  };

  /**
   * Clear stale cache and force fresh balance update
   * Use this when cached data is incorrect or outdated
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   */
  export const clearStaleBalanceCacheAndRefresh = async (walletID, chainId) => {
    try {
      console.warn('[RailgunBalances] 🗑️ CLEARING STALE BALANCE CACHE AND FORCING REFRESH');
      
      // Clear the specific cache entry
      const cacheKey = `${walletID}-${chainId}`;
      const oldCache = balanceCache.get(cacheKey) || [];
      
      console.log('[RailgunBalances] OLD cached data being cleared:', {
        cacheKey,
        count: oldCache.length,
        tokens: oldCache.map(b => `${b.symbol}: ${b.formattedBalance} (addr: ${b.tokenAddress})`)
      });
      
      // Clear the cache for this wallet/chain
      balanceCache.set(cacheKey, []);
      
      // Force a balance refresh to get fresh data
      console.log('[RailgunBalances] 🔄 Forcing balance refresh to get fresh data...');
      await refreshPrivateBalances(walletID, chainId);
      
      console.log('[RailgunBalances] ✅ Stale cache cleared and refresh triggered');
      
    } catch (error) {
      console.error('[RailgunBalances] Failed to clear stale cache and refresh:', error);
      throw error;
    }
  };

  /**
   * Get balance for specific token
   * @param {string} walletID - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @param {string} tokenAddress - Token address
   * @returns {Object|null} Token balance object or null
   */
  export const getTokenBalance = async (walletID, chainId, tokenAddress) => {
    try {
      const balances = await getPrivateBalances(walletID, chainId);
      return balances.find(balance => balance.tokenAddress === tokenAddress) || null;
    } catch (error) {
      console.error('[RailgunBalances] Failed to get token balance:', error);
      return null;
    }
  };

  /**
   * Check if a token is supported by Railgun
   * @param {string} tokenAddress - Token contract address
   * @param {number} chainId - Chain ID
   * @returns {boolean} True if supported
   */
  export const isTokenSupportedByRailgun = (tokenAddress, chainId) => {
    try {
      // Check if network is supported
      const supportedChains = Object.keys(NETWORK_MAPPING).map(Number);
      if (!supportedChains.includes(chainId)) {
        return false;
      }

      // Native tokens are always supported on supported networks
      if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
        return true;
      }

      // ERC20 tokens need valid address format
      return isAddress(tokenAddress);
    } catch (error) {
      console.error('[RailgunBalances] Error checking token support:', error);
      return false;
    }
  };

  /**
   * Get tokens with shieldable balances (stub implementation)
   * @param {string} address - EOA address
   * @param {number} chainId - Chain ID
   * @returns {Array} Array of tokens that can be shielded
   */
  export const getShieldableTokens = async (address, chainId) => {
    try {
      console.log('[RailgunBalances] getShieldableTokens called - feature not implemented');
      return [];
    } catch (error) {
      console.error('[RailgunBalances] Failed to get shieldable tokens:', error);
      return [];
    }
  };

  /**
   * Handle Railgun balance update callback (official RailgunBalancesEvent structure)
   * OPTIMIZED: Use fresh callback data directly, save to cache, dispatch to UI immediately
   * @param {Object} balancesEvent - Official RailgunBalancesEvent from SDK
   */
  export const handleBalanceUpdateCallback = async (balancesEvent) => {
    try {
      console.log('[RailgunBalances] 🎯 Official RAILGUN balance callback triggered:', {
        txidVersion: balancesEvent.txidVersion,
        chainId: balancesEvent.chain?.id,
        chainType: balancesEvent.chain?.type,
        railgunWalletID: balancesEvent.railgunWalletID?.slice(0, 8) + '...',
        balanceBucket: balancesEvent.balanceBucket,
        erc20Count: balancesEvent.erc20Amounts?.length || 0,
      });
      
      const { 
        txidVersion, 
        chain, 
        erc20Amounts, 
        nftAmounts, 
        railgunWalletID, 
        balanceBucket 
      } = balancesEvent;
      
      // Only process spendable balances for the UI
      if (balanceBucket !== 'Spendable') {
        console.log(`[RailgunBalances] ⏭️ Ignoring non-spendable balance bucket: ${balanceBucket}`);
        return;
      }
      
      const chainId = chain.id;
      const networkName = chain.type === 'custom' ? `${chain.type}:${chain.id}` : NETWORK_MAPPING[chain.id];
      
      console.log('[RailgunBalances] ⚡ Processing FRESH balance data from callback:', {
        networkName,
        chainId,
        walletID: railgunWalletID?.slice(0, 8) + '...',
        tokenCount: erc20Amounts?.length || 0,
        balanceBucket,
      });
      
      // Debug: Log all token addresses and amounts
      if (erc20Amounts && Array.isArray(erc20Amounts)) {
        console.log('[RailgunBalances] 🔍 Raw ERC20 amounts from callback:', erc20Amounts.length);
        erc20Amounts.forEach((token, index) => {
          console.log(`  [${index}] Raw Token Address: ${token.tokenAddress || 'NULL/NATIVE'}`);
          console.log(`       Normalized Token Address: ${normalizeTokenAddress(token.tokenAddress) || 'NATIVE'}`);
          console.log(`       Amount: ${token.amount?.toString() || '0'}`);
          console.log(`       Amount type: ${typeof token.amount}`);
        });
      } else {
        console.log('[RailgunBalances] ⚠️ No erc20Amounts in callback!', { erc20Amounts });
      }
      
      // Process token balances from FRESH callback data
      const formattedBalances = [];
      
      if (erc20Amounts && Array.isArray(erc20Amounts)) {
        for (let i = 0; i < erc20Amounts.length; i++) {
          const rawToken = erc20Amounts[i];
          const tokenAddress = normalizeTokenAddress(rawToken.tokenAddress);
          const amount = rawToken.amount;
          
          console.log(`[RailgunBalances] 📋 Processing token [${i}]:`, {
            raw: rawToken.tokenAddress,
            normalized: tokenAddress,
            amount: amount?.toString()
          });
          
          try {
            // Skip zero balances
            if (!amount || amount.toString() === '0') {
              console.log(`[RailgunBalances] ⏭️ Skipping zero balance for token ${i}`);
              continue;
            }

            // Get token information - Use hardcoded tokens FIRST for known tokens, then SDK fallback
            let tokenData = null;
            
            console.log('[RailgunBalances] 🪙 Processing token from official callback:', {
              rawTokenAddress: rawToken.tokenAddress,
              normalizedTokenAddress: tokenAddress || 'NATIVE',
              tokenAddressLowerCase: tokenAddress?.toLowerCase(),
              amount: amount.toString(),
                chainId,
              tokenIndex: i
            });
            
            // Primary: Check hardcoded tokens FIRST (like transactionHistory.js does)
            if (chainId === 42161 && tokenAddress) {
              // Known tokens on Arbitrum
              const knownTokens = {
                '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { // USDC
                  symbol: 'USDC',
                  decimals: 6,
                  name: 'USD Coin'
                },
                '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { // USDT
                  symbol: 'USDT', 
                  decimals: 6,
                  name: 'Tether USD'
                }
              };
              
              const knownToken = knownTokens[tokenAddress.toLowerCase()];
              if (knownToken) {
                tokenData = {
                  address: tokenAddress,
                  ...knownToken
                };
                console.log('[RailgunBalances] ✅ Using hardcoded token data:', tokenData);
              }
            }
            
            // Fallback: Use SDK token lookup if not in hardcoded list
            if (!tokenData) {
              console.log('[RailgunBalances] 🔍 Token not in hardcoded list, using SDK lookup...');
              try {
                const { getERC20TokenInfo } = await import('@railgun-community/wallet');
                const result = await getERC20TokenInfo(
                  new NetworkName(),
                  tokenAddress,
                  chainId
                );
                
                if (result && result.symbol) {
                  tokenData = {
                    address: tokenAddress,
                    symbol: result.symbol,
                    decimals: result.decimals || 18,
                    name: result.name || result.symbol
                  };
                  console.log('[RailgunBalances] ✅ SDK token lookup successful:', tokenData);
            }
              } catch (sdkError) {
                console.warn('[RailgunBalances] SDK token lookup failed:', sdkError);
              }
            }
            
            // Final fallback: Create placeholder token
            if (!tokenData) {
              console.log('[RailgunBalances] ⚠️ Creating placeholder token data');
              tokenData = {
                address: tokenAddress,
                symbol: 'UNKNOWN',
                decimals: 18,
                name: 'Unknown Token'
              };
            }
            
            // Format balance using proper decimals
            const numericBalance = Number(formatUnits(amount.toString(), tokenData.decimals));
            const formattedBalance = numericBalance.toFixed(4).replace(/\.?0+$/, '');
            
            console.log('[RailgunBalances] 💰 Formatted balance:', {
              symbol: tokenData.symbol,
              rawAmount: amount.toString(),
              decimals: tokenData.decimals,
              numericBalance,
              formattedBalance
            });
            
            formattedBalances.push({
              address: tokenData.address,
              symbol: tokenData.symbol,
              decimals: tokenData.decimals,
              name: tokenData.name,
              rawBalance: amount.toString(),
              numericBalance,
              formattedBalance
            });
            
          } catch (tokenError) {
            console.error(`[RailgunBalances] Failed to process token ${i}:`, tokenError);
            console.error('Token data:', rawToken);
          }
        }
      }
      
      console.log('[RailgunBalances] 🚀 FRESH balance processing complete:', {
        totalTokens: formattedBalances.length,
        tokens: formattedBalances.map(t => `${t.symbol}: ${t.formattedBalance}`)
      });
      
      // BACKEND PERSISTENCE: Store fresh balance data via secure backend immediately 
      try {
        const success = await WalletService.storePrivateBalances(railgunWalletID, chainId, formattedBalances);
        if (success) {
          console.log('[RailgunBalances] ✅ Fresh balances successfully stored via backend:', {
            walletID: railgunWalletID?.slice(0, 8) + '...',
            chainId,
            balanceCount: formattedBalances.length
          });
        } else {
          console.warn('[RailgunBalances] ⚠️ Failed to store balances via backend (non-critical)');
        }
      } catch (backendError) {
        console.warn('[RailgunBalances] Backend storage error (non-critical):', backendError);
      }
      
      // OPTIMIZATION: Dispatch fresh data directly to UI (no cache reload needed!)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('railgun-balance-update', {
          detail: {
            railgunWalletID,
            chainId,
            balances: formattedBalances, // Fresh data from callback!
            timestamp: Date.now(),
            source: 'fresh-callback', // Indicates this is real-time data
            txidVersion,
          }
        }));
        
        console.log('[RailgunBalances] 📡 Fresh balance data dispatched to UI:', {
          eventType: 'railgun-balance-update',
          walletID: railgunWalletID?.slice(0, 8) + '...',
          chainId,
          tokenCount: formattedBalances.length,
          source: 'fresh-callback'
        });
      }
      
    } catch (error) {
      console.error('[RailgunBalances] 💥 Balance callback processing failed:', error);
      
      // Fallback: Try to load from backend if callback processing fails
      try {
        console.log('[RailgunBalances] 🔄 Falling back to backend after callback error...');
        const backendData = await WalletService.getPrivateBalances(
          balancesEvent.railgunWalletID, 
          balancesEvent.chain.id
        );
        
        if (backendData && backendData.balances && backendData.balances.length > 0) {
          window.dispatchEvent(new CustomEvent('railgun-balance-update', {
            detail: {
              railgunWalletID: balancesEvent.railgunWalletID,
              chainId: balancesEvent.chain.id,
              balances: backendData.balances,
              timestamp: Date.now(),
              source: 'backend-fallback',
              txidVersion: balancesEvent.txidVersion,
            }
          }));
          console.log('[RailgunBalances] 📦 Fallback backend data dispatched to UI');
        }
      } catch (fallbackError) {
        console.error('[RailgunBalances] Backend fallback also failed:', fallbackError);
      }
    }
  };

  /**
   * Get chain ID from network name
   * @param {string} networkName - Railgun network name
   * @returns {number|null} Chain ID
   */
  const getChainIdFromNetworkName = (networkName) => {
    const networkMapping = {
      [NetworkName.Ethereum]: 1,
      [NetworkName.Arbitrum]: 42161,
      [NetworkName.Polygon]: 137,
      [NetworkName.BNBChain]: 56,
    };
    return networkMapping[networkName] || null;
  };

  /**
   * Force a complete rescan of the merkle tree and wallets
   * This is more aggressive than refreshBalances and should fix balance update issues
   * @param {number} chainId - Chain ID
   * @param {string} walletID - Wallet ID to rescan
   */
  export const forceCompleteRescan = async (chainId, walletID) => {
    try {
      console.log('[RailgunBalances] Starting FORCE COMPLETE rescan...');
      
      await waitForRailgunReady();
      
      // Get network configuration
      const networkName = getRailgunNetworkName(chainId);
      const { chain } = NETWORK_CONFIG[networkName];
      
      console.log('[RailgunBalances] Force rescanning for:', {
        networkName,
        chainId,
        walletID: walletID?.slice(0, 8) + '...'
      });
      
      // First, try the standard refresh
      await refreshBalances(chain, [walletID]);
      
      // If we have fullRescanUTXOMerkletreesAndWalletsForNetwork available, use it
      if (fullRescanUTXOMerkletreesAndWalletsForNetwork) {
        console.log('[RailgunBalances] Performing full UTXO merkle tree rescan...');
        await fullRescanUTXOMerkletreesAndWalletsForNetwork(
          networkName,
          [walletID]
        );
      }
      
      console.log('[RailgunBalances] Force rescan completed');
      
      // Wait a bit for the scan to process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // After rescan, trigger a manual balance fetch to ensure UI updates
      const balances = await getPrivateBalances(walletID, chainId);
      console.log('[RailgunBalances] Fetched balances after rescan:', balances);
      
      return balances;
      
    } catch (error) {
      console.error('[RailgunBalances] Force rescan failed:', error);
      // Don't throw, just return current balances
      return await getPrivateBalances(walletID, chainId);
    }
  };

  // Expose debug functions to window for easy testing
  if (typeof window !== 'undefined') {
    window.__LEXIE_DEBUG__ = window.__LEXIE_DEBUG__ || {};
    window.__LEXIE_DEBUG__.clearStaleBalanceCache = clearStaleBalanceCacheAndRefresh;
    window.__LEXIE_DEBUG__.clearAllBalanceCache = clearBalanceCache;
    window.__LEXIE_DEBUG__.inspectBalanceCache = (walletID, chainId) => {
      const cacheKey = `${walletID}-${chainId}`;
      const cached = balanceCache.get(cacheKey) || [];
      console.log('🔍 Current cache contents:', cached);
      return cached;
    };
    window.__LEXIE_DEBUG__.monitorTransaction = async (txHash, chainId, type = 'shield') => {
      const { monitorTransactionInGraph } = await import('./transactionMonitor.js');
      return await monitorTransactionInGraph({
        txHash,
        chainId,
        transactionType: type,
        onFound: (event) => console.log('🎉 Transaction found in Graph!', event)
      });
    };
  }

  // Export for use in other modules
  export default {
    getPrivateBalances,
    getPrivateBalancesFromCache,
    refreshPrivateBalancesAndStore,
    getTokenInfo,
    refreshPrivateBalances,
    performFullRescan,
    performGlobalRescan,
    searchTokens,
    getCachedBalances,
    isCacheFresh,
    formatTokenAmount,
    parseTokenAmount,
    clearBalanceCache,
    clearStaleBalanceCacheAndRefresh,
    getTokenBalance,
    isTokenSupportedByRailgun,
    getShieldableTokens,
    handleBalanceUpdateCallback,
    forceCompleteRescan,
  }; 