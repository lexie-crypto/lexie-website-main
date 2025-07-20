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
 * Network mapping for UI display
 */
const NETWORK_DISPLAY_MAPPING = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  137: 'Polygon',
  56: 'BSC',
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
    
    // DETAILED CACHE INSPECTION
    console.log('[RailgunBalances] 🔍 DETAILED cache inspection:');
    cachedBalances.forEach((balance, index) => {
      console.log(`  [${index}] Token Details:`, {
        symbol: balance.symbol,
        name: balance.name,
        tokenAddress: balance.tokenAddress,
        decimals: balance.decimals,
        rawBalance: balance.balance,
        formattedBalance: balance.formattedBalance,
        numericBalance: balance.numericBalance,
        chainId: balance.chainId
      });
    });
    
    return cachedBalances;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get cached balances:', error);
    return [];
  }
};

/**
 * Get token information using simple mapping (like transactionHistory.js)
 * @param {string} tokenAddress - Token contract address
 * @param {number} chainId - Chain ID
 * @returns {Object} Token information
 */
export const getTokenInfo = async (tokenAddress, chainId) => {
  try {
    // Handle native token (null, undefined, or zero address)
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000' || tokenAddress === null) {
      const nativeInfo = getNativeTokenInfo(chainId);
      console.log('[RailgunBalances] Resolved native token info:', nativeInfo);
      return nativeInfo;
    }
    
    // Use simple token mapping
    const symbol = getTokenSymbol(tokenAddress, chainId);
    const decimals = getTokenDecimals(tokenAddress, chainId);
    
    const result = {
      address: tokenAddress,
      symbol,
      name: symbol,
      decimals,
      isNative: false,
    };
    
    console.log('[RailgunBalances] ✅ Resolved token info using simple mapping:', result);
    return result;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get token info:', error);
    return null;
  }
};

/**
 * Get token symbol for display (copied from transactionHistory.js)
 * @param {string} tokenAddress - Token address  
 * @param {number} chainId - Chain ID
 * @returns {string} Token symbol
 */
const getTokenSymbol = (tokenAddress, chainId) => {
  if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
    const nativeSymbols = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
    return nativeSymbols[chainId] || 'ETH';
  }
  
  // Known tokens on Ethereum
  if (chainId === 1) {
    const knownTokens = {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  // Known tokens on Polygon
  if (chainId === 137) {
    const knownTokens = {
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 'DAI',
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  // Known tokens on BSC
  if (chainId === 56) {
    const knownTokens = {
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 'DAI',
      '0x55d398326f99059ff775485246999027b3197955': 'USDT',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  return 'UNKNOWN';
};

/**
 * Get token decimals (copied from transactionHistory.js)
 * @param {string} tokenAddress - Token address
 * @param {number} chainId - Chain ID  
 * @returns {number} Token decimals
 */
const getTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return 18; // Native tokens
  
  // Known tokens on Ethereum
  if (chainId === 1) {
    const knownTokens = {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC
      '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  // Known tokens on Polygon
  if (chainId === 137) {
    const knownTokens = {
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6, // USDC
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 18, // DAI
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6, // USDT
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  // Known tokens on BSC
  if (chainId === 56) {
    const knownTokens = {
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18, // USDC
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 18, // DAI
      '0x55d398326f99059ff775485246999027b3197955': 18, // USDT
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  return 18; // Default
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
        
        // Skip zero balances
        if (!amount || amount.toString() === '0') {
          console.log(`[RailgunBalances] ⏭️ Skipping zero balance for token ${i}`);
          continue;
        }

        console.log('[RailgunBalances] 🪙 Processing token from official callback:', {
          rawTokenAddress: rawToken.tokenAddress,
          normalizedTokenAddress: tokenAddress || 'NATIVE',
          amount: amount.toString(),
          chainId,
          tokenIndex: i
        });
        
        // Use the same simple token mapping as transactionHistory.js
        let symbol, decimals, name;
        
        if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
          // Native tokens
          const nativeTokens = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
          symbol = nativeTokens[chainId] || 'ETH';
          decimals = 18;
          name = symbol;
        } else {
          // ERC20 tokens - use same mapping as transactionHistory.js
          symbol = getTokenSymbol(tokenAddress, chainId);
          decimals = getTokenDecimals(tokenAddress, chainId);
          name = symbol;
        }
        
        console.log('[RailgunBalances] ✅ Using simple token mapping:', { symbol, decimals, name });
        
        // Format balance using proper decimals
        const numericBalance = Number(formatUnits(amount.toString(), decimals));
        const formattedBalance = numericBalance.toFixed(4).replace(/\.?0+$/, '');
        
        console.log('[RailgunBalances] 💰 Formatted balance:', {
          symbol,
          rawAmount: amount.toString(),
          decimals,
          numericBalance,
          formattedBalance
        });
        
        formattedBalances.push({
          // Use UI-compatible structure
          tokenAddress: tokenAddress,
          address: tokenAddress, // Keep both for compatibility
          symbol,
          decimals,
          name,
          balance: amount.toString(), // UI expects 'balance' not 'rawBalance'
          rawBalance: amount.toString(), // Keep for compatibility
          numericBalance,
          formattedBalance,
          hasBalance: numericBalance > 0,
          isPrivate: true,
          chainId: chainId,
          networkName: NETWORK_DISPLAY_MAPPING[chainId] || `Chain ${chainId}`
        });
      }
    }
    
    console.log('[RailgunBalances] 🚀 FRESH balance processing complete:', {
      totalTokens: formattedBalances.length,
      tokens: formattedBalances.map(t => `${t.symbol}: ${t.formattedBalance}`)
    });
    
    // OPTIMIZATION: Save fresh data to cache immediately
    const cacheKey = `${railgunWalletID}-${chainId}`;
    balanceCache.set(cacheKey, formattedBalances);
    
    // Save to localStorage for persistence
    try {
      localStorage.setItem(
        `railgun_balances_${cacheKey}`, 
        JSON.stringify({
          balances: formattedBalances,
          timestamp: Date.now(),
          chainId,
          walletID: railgunWalletID
        })
      );
      console.log('[RailgunBalances] 💾 Fresh balances saved to persistent cache');
    } catch (storageError) {
      console.warn('[RailgunBalances] Failed to save to localStorage:', storageError);
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
    
          // Fallback: Try to load from cache if callback processing fails
      try {
        console.log('[RailgunBalances] 🔄 Falling back to cache after callback error...');
        const cacheKey = `${balancesEvent.railgunWalletID}-${balancesEvent.chain.id}`;
        const cachedBalances = balanceCache.get(cacheKey) || [];
        
        if (cachedBalances && cachedBalances.length > 0) {
          window.dispatchEvent(new CustomEvent('railgun-balance-update', {
            detail: {
              railgunWalletID: balancesEvent.railgunWalletID,
              chainId: balancesEvent.chain.id,
              balances: cachedBalances,
              timestamp: Date.now(),
              source: 'cache-fallback',
              txidVersion: balancesEvent.txidVersion,
            }
          }));
          console.log('[RailgunBalances] 📦 Fallback cache data dispatched to UI');
        }
      } catch (fallbackError) {
        console.error('[RailgunBalances] Cache fallback also failed:', fallbackError);
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