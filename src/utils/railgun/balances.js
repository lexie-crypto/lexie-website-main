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

// Persistent balance cache using localStorage
const BALANCE_CACHE_KEY = 'railgun-private-balances';
const BALANCE_UPDATE_KEY = 'railgun-balance-updates';

/**
 * Persistent cache implementation using localStorage
 */
const createPersistentCache = () => {
  const getCache = () => {
    try {
      const cached = localStorage.getItem(BALANCE_CACHE_KEY);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('[RailgunBalances] Failed to read cache from localStorage:', error);
      return {};
    }
  };

  const setCache = (cache) => {
    try {
      localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      console.warn('[RailgunBalances] Failed to save cache to localStorage:', error);
    }
  };

  const getLastUpdates = () => {
    try {
      const cached = localStorage.getItem(BALANCE_UPDATE_KEY);
      return cached ? JSON.parse(cached) : {};
    } catch (error) {
      console.warn('[RailgunBalances] Failed to read updates from localStorage:', error);
      return {};
    }
  };

  const setLastUpdates = (updates) => {
    try {
      localStorage.setItem(BALANCE_UPDATE_KEY, JSON.stringify(updates));
    } catch (error) {
      console.warn('[RailgunBalances] Failed to save updates to localStorage:', error);
    }
  };

  return {
    get: (key) => getCache()[key] || [],
    set: (key, value) => {
      const cache = getCache();
      cache[key] = value;
      setCache(cache);
      
      // Also update the last update timestamp
      const updates = getLastUpdates();
      updates[key] = Date.now();
      setLastUpdates(updates);
      
      console.log('[RailgunBalances] 💾 Saved private balances to persistent cache:', {
        key,
        count: value.length,
        tokens: value.map(b => `${b.symbol}: ${b.formattedBalance}`)
      });
    },
    clear: () => {
      localStorage.removeItem(BALANCE_CACHE_KEY);
      localStorage.removeItem(BALANCE_UPDATE_KEY);
    },
    getLastUpdate: (key) => getLastUpdates()[key] || 0
  };
};

// Initialize persistent cache
const balanceCache = createPersistentCache();

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
 * Get private token balances for a wallet (callback-based like the old working code)
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of token balance objects from cache
 */
export const getPrivateBalances = async (walletID, chainId) => {
  try {
    console.log('[RailgunBalances] Getting private balances from persistent cache:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
    });
    
    // Return cached balances from persistent storage
    const cacheKey = `${walletID}-${chainId}`;
    const cachedBalances = balanceCache.get(cacheKey) || [];
    
    console.log('[RailgunBalances] 📱 Retrieved private balances from persistent cache:', {
      count: cachedBalances.length,
      tokens: cachedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
      lastUpdate: balanceCache.getLastUpdate(cacheKey)
    });
    
    return cachedBalances;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get private balances:', error);
    return [];
  }
};

/**
 * Get private balances from cache immediately (for initial load)
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Cached balance array or empty array
 */
export const getPrivateBalancesFromCache = (walletID, chainId) => {
  try {
    if (!walletID || !chainId) {
      return [];
    }

    const cacheKey = `${walletID}-${chainId}`;
    const cachedBalances = balanceCache.get(cacheKey) || [];
    const lastUpdate = balanceCache.getLastUpdate(cacheKey);
    
    console.log('[RailgunBalances] 🚀 Loading private balances from cache on init:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
      count: cachedBalances.length,
      tokens: cachedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
      lastUpdate: lastUpdate ? new Date(lastUpdate).toLocaleString() : 'Never',
      cacheAge: lastUpdate ? `${Math.round((Date.now() - lastUpdate) / 1000)}s ago` : 'Unknown'
    });
    
    return cachedBalances;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get cached balances:', error);
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
    
    console.log('[RailgunBalances] Triggering private balance refresh...');
    
    // Get the chain configuration
    const { chain } = NETWORK_CONFIG[networkName];
    
    // Trigger RAILGUN balance refresh - this will cause callbacks to fire
    await refreshBalances(chain, [walletID]);
    
    console.log('[RailgunBalances] Private balance refresh triggered - waiting for callbacks');
    
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
    
    console.log('[RailgunBalances] 📦 Processing official balance update:', {
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
    
    // Process token balances
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

          // Get token information - handle both native tokens (null) and ERC20 tokens
          const tokenData = await getTokenInfo(tokenAddress, chainId);
          
          console.log('[RailgunBalances] 🪙 Processing token from official callback:', {
            tokenAddress: tokenAddress || 'NATIVE',
            tokenAddressLowerCase: tokenAddress?.toLowerCase(),
            amount: amount.toString(),
            chainId,
            tokenData: tokenData ? {
              symbol: tokenData.symbol,
              name: tokenData.name,
              decimals: tokenData.decimals
            } : 'RESOLUTION_FAILED'
          });
          
          // Special handling for known stablecoins on Arbitrum
          if (chainId === 42161 && !tokenData && tokenAddress) {
            const knownTokens = {
              '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
              '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
            };
            
            const tokenInfo = knownTokens[tokenAddress.toLowerCase()];
            if (tokenInfo) {
              console.log('[RailgunBalances] 🎯 Using hardcoded token info for:', tokenInfo.symbol);
              const formattedBalance = formatUnits(amount.toString(), tokenInfo.decimals);
              const numericBalance = parseFloat(formattedBalance);
              
              const balance = {
                tokenAddress: tokenAddress,
                symbol: tokenInfo.symbol,
                name: tokenInfo.name,
                decimals: tokenInfo.decimals,
                balance: amount.toString(),
                formattedBalance,
                numericBalance,
                hasBalance: numericBalance > 0,
                isPrivate: true,
                chainId,
                networkName,
                balanceBucket,
              };
              
              formattedBalances.push(balance);
              continue;
            }
          }
          
          if (tokenData) {
            const formattedBalance = formatUnits(amount.toString(), tokenData.decimals);
            const numericBalance = parseFloat(formattedBalance);
            
            const balance = {
              tokenAddress: tokenAddress || null, // Ensure null for native tokens
              symbol: tokenData.symbol || 'UNKNOWN',
              name: tokenData.name || 'Unknown Token',
              decimals: tokenData.decimals || 18,
              balance: amount.toString(),
              formattedBalance,
              numericBalance,
              hasBalance: numericBalance > 0,
              isPrivate: true,
              chainId,
              networkName,
            };
            
            console.log('[RailgunBalances] ✅ Processed private token balance:', {
              symbol: balance.symbol,
              formattedBalance: balance.formattedBalance,
              decimals: balance.decimals
            });
            
            formattedBalances.push(balance);
          } else {
            console.warn('[RailgunBalances] ⚠️ Could not resolve token metadata for:', tokenAddress);
            
            // Fallback: create balance with unknown token info but correct formatting
            const decimals = 18; // Default to 18 decimals if unknown
            const formattedBalance = formatUnits(amount.toString(), decimals);
            const numericBalance = parseFloat(formattedBalance);
            
            const balance = {
              tokenAddress: tokenAddress || null,
              symbol: 'UNKNOWN',
              name: 'Unknown Token',
              decimals,
              balance: amount.toString(),
              formattedBalance,
              numericBalance,
              hasBalance: numericBalance > 0,
              isPrivate: true,
              chainId,
              networkName,
            };
            
            formattedBalances.push(balance);
          }
        } catch (error) {
          console.warn('[RailgunBalances] Failed to process token in callback:', tokenAddress, error);
        }
      }
    }
    
    // Update cache
    const cacheKey = `${railgunWalletID}-${chainId}`;
    balanceCache.set(cacheKey, formattedBalances);
    // Timestamp is automatically updated when balanceCache.set() is called
    
    console.log('[RailgunBalances] Cache updated with callback data:', {
      cacheKey,
      count: formattedBalances.length,
      tokens: formattedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
    });
    
    // Dispatch event for UI updates AND directly update React state
    if (typeof window !== 'undefined') {
      console.log('[RailgunBalances] 🔄 Dispatching UI update events...');
      
      // Dispatch custom event
      window.dispatchEvent(new CustomEvent('railgun-balance-update', {
        detail: {
          railgunWalletID,
          chainId,
          balances: formattedBalances,
          networkName,
          timestamp: Date.now()
        }
      }));

      // Direct update to ensure immediate UI sync
      if (window.__LEXIE_HOOKS__?.setPrivateBalances) {
        console.log('[RailgunBalances] ⚡ Direct UI update via global hook reference');
        window.__LEXIE_HOOKS__.setPrivateBalances(formattedBalances);
      } else {
        console.warn('[RailgunBalances] ⚠️ Global hook reference not available for direct UI update');
      }
    }
    
  } catch (error) {
    console.error('[RailgunBalances] Error in balance callback:', error);
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

// Export for use in other modules
export default {
  getPrivateBalances,
  getPrivateBalancesFromCache,
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
  getTokenBalance,
  isTokenSupportedByRailgun,
  getShieldableTokens,
  handleBalanceUpdateCallback,
  forceCompleteRescan,
}; 