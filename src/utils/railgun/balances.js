/**
 * Official RAILGUN Balances Implementation
 * Converted from wallet/src/services/railgun/wallets/balances.ts
 */

import { refreshBalances as officialRefreshBalances } from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';

/**
 * Network mapping for Railgun
 */
const NETWORK_MAPPING = {
  1: 'Ethereum',
  42161: 'Arbitrum', 
  137: 'Polygon',
  56: 'BNBChain',
};

/**
 * Get Railgun network name from chain ID
 */
const getRailgunNetworkName = (chainId) => {
  const networkName = NETWORK_MAPPING[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Get chain configuration for network
 */
const getChainConfig = (networkName) => {
  // Import NETWORK_CONFIG dynamically to avoid circular imports
  const { NETWORK_CONFIG } = require('@railgun-community/shared-models');
  return NETWORK_CONFIG[networkName];
};

/**
 * Refresh balances for specific wallets (official implementation)
 * @param {number} chainId - Chain ID
 * @param {string[]} walletIdFilter - Array of wallet IDs to refresh
 */
export const refreshBalances = async (chainId, walletIdFilter) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    const { chain } = getChainConfig(networkName);
    
    console.log('[RailgunBalances] 🔄 Refreshing balances (official):', {
      chainId,
      networkName,
      walletCount: walletIdFilter?.length || 0
    });

    // Wallet will trigger .emit('scanned', {chain}) event when finished,
    // which calls `onBalancesUpdate` (balance-update.ts).

    // Kick off a background merkletree scan.
    // This will call wallet.scanBalances when it's done, but may take some time.
    await officialRefreshBalances(chain, walletIdFilter);
    
    console.log('[RailgunBalances] ✅ Balance refresh initiated');
  } catch (err) {
    console.error('[RailgunBalances] Balance refresh failed:', err);
    throw new Error(`Balance refresh failed: ${err.message}`);
  }
};

/**
 * Perform full rescan of UTXO merkletrees and wallets (official implementation)
 * @param {number} chainId - Chain ID  
 * @param {string[]} walletIdFilter - Array of wallet IDs to rescan
 */
export const rescanFullUTXOMerkletreesAndWallets = async (chainId, walletIdFilter) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    const { chain } = getChainConfig(networkName);
    
    console.log('[RailgunBalances] 🔄 Full UTXO rescan (official):', {
      chainId,
      networkName,
      walletCount: walletIdFilter?.length || 0
    });

    // Use the official rescan function
    const { rescanFullUTXOMerkletreesAndWallets: officialRescan } = await import('@railgun-community/wallet');
    await officialRescan(chain, walletIdFilter);

    // Wallet will trigger .emit('scanned', {chain}) event when finished,
    // which calls `onBalancesUpdate` (balance-update.ts).
    
    console.log('[RailgunBalances] ✅ Full UTXO rescan initiated');
  } catch (err) {
    console.error('[RailgunBalances] Full UTXO rescan failed:', err);
    throw new Error(`Full UTXO rescan failed: ${err.message}`);
  }
};

/**
 * Reset full TXID merkletrees V2 (official implementation)
 * @param {number} chainId - Chain ID
 */
export const resetFullTXIDMerkletreesV2 = async (chainId) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    const { chain } = getChainConfig(networkName);
    
    console.log('[RailgunBalances] 🔄 Resetting TXID merkletrees V2 (official):', {
      chainId,
      networkName
    });

    // Use the official reset function
    const { resetFullTXIDMerkletreesV2: officialReset } = await import('@railgun-community/wallet');
    await officialReset(chain);
    
    console.log('[RailgunBalances] ✅ TXID merkletrees V2 reset completed');
  } catch (err) {
    console.error('[RailgunBalances] TXID merkletrees reset failed:', err);
    throw new Error(`TXID merkletrees reset failed: ${err.message}`);
  }
};

// Persistent balance cache using localStorage (restored working version)
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
 * Get private balances from cache
 * @param {string} walletID - RAILGUN wallet ID  
 * @param {number} chainId - Chain ID
 * @returns {Array} Cached private balances
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
 * @returns {Array} Cached balance array
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
 * Refresh private balances (official implementation)
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 */
export const refreshPrivateBalances = async (walletID, chainId) => {
  console.log('[RailgunBalances] Refreshing private balances for wallet:', walletID?.slice(0, 8) + '...');
  await refreshBalances(chainId, [walletID]);
};

/**
 * Handle balance update callback from official RAILGUN SDK
 * This will be called by the official balance callback system
 * @param {Object} balancesEvent - Official RailgunBalancesEvent
 */
export const handleBalanceUpdateCallback = async (balancesEvent) => {
  try {
    const { 
      chain, 
      erc20Amounts, 
      railgunWalletID, 
      balanceBucket 
    } = balancesEvent;
    
    // Only process spendable balances
    if (balanceBucket !== 'Spendable') {
      return;
    }
    
    console.log('[RailgunBalances] 🎯 Official balance callback received:', {
      chainId: chain.id,
      railgunWalletID: railgunWalletID?.slice(0, 8) + '...',
      tokenCount: erc20Amounts?.length || 0,
      balanceBucket
    });
    
    // Format the balances for our UI
    const formattedBalances = [];
    
    if (erc20Amounts && Array.isArray(erc20Amounts)) {
      // Import formatUnits for balance formatting
      const { formatUnits } = await import('ethers');
      
      for (const { tokenAddress, amount } of erc20Amounts) {
        if (!amount || amount.toString() === '0') continue;
        
        // For now, use basic formatting - token resolution will come later
        const decimals = getTokenDecimals(tokenAddress, chain.id);
        const formattedBalance = formatUnits(amount.toString(), decimals);
        
        const balance = {
          tokenAddress: tokenAddress || null,
          symbol: getTokenSymbol(tokenAddress, chain.id),
          name: getTokenName(tokenAddress, chain.id),
          decimals,
          balance: amount.toString(),
          formattedBalance,
          numericBalance: parseFloat(formattedBalance),
          hasBalance: parseFloat(formattedBalance) > 0,
          isPrivate: true,
          chainId: chain.id,
        };
        
        formattedBalances.push(balance);
      }
    }
    
    // Update cache
    const cacheKey = `${railgunWalletID}-${chain.id}`;
    balanceCache.set(cacheKey, formattedBalances);
    
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
          chainId: chain.id,
          balances: formattedBalances,
                     networkName: getRailgunNetworkNameForEvent(chain.id),
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
    console.error('[RailgunBalances] Balance callback error:', error);
  }
};

/**
 * Get railgun network name from chain ID (helper for events)
 */
const getRailgunNetworkNameForEvent = (chainId) => {
  return NETWORK_MAPPING[chainId] || `Chain${chainId}`;
};

/**
 * Get token decimals (simplified - will be enhanced with proper token resolution)
 */
const getTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return 18; // Native tokens
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  return 18; // Default
};

/**
 * Get token symbol (simplified)
 */
const getTokenSymbol = (tokenAddress, chainId) => {
  if (!tokenAddress) {
    const nativeSymbols = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
    return nativeSymbols[chainId] || 'ETH';
  }
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  return 'UNKNOWN';
};

/**
 * Get token name (simplified)
 */
const getTokenName = (tokenAddress, chainId) => {
  if (!tokenAddress) {
    const nativeNames = { 1: 'Ethereum', 42161: 'Ethereum', 137: 'Polygon', 56: 'BNB Smart Chain' };
    return nativeNames[chainId] || 'Ethereum';
  }
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USD Coin',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'Tether USD',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'Unknown Token';
  }
  
  return 'Unknown Token';
};

/**
 * Parse token amount (utility function)
 * @param {string} amount - Amount to parse
 * @param {number} decimals - Token decimals
 * @returns {string} Parsed amount
 */
export const parseTokenAmount = (amount, decimals) => {
  if (!amount || amount === '0') return '0';
  
  try {
    const { parseUnits } = require('ethers');
    return parseUnits(amount.toString(), decimals).toString();
  } catch (error) {
    console.error('[RailgunBalances] Parse amount failed:', error);
    throw new Error(`Invalid amount: ${amount}`);
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

    // For now, assume all ERC20 tokens with valid addresses are supported
    const { isAddress } = require('ethers');
    return isAddress(tokenAddress);
  } catch (error) {
    console.error('[RailgunBalances] Error checking token support:', error);
    return false;
  }
};

/**
 * Get tokens with shieldable balances (placeholder implementation)
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

// Export for compatibility
export default {
  refreshBalances,
  rescanFullUTXOMerkletreesAndWallets,
  resetFullTXIDMerkletreesV2,
  getPrivateBalances,
  getPrivateBalancesFromCache,
  refreshPrivateBalances,
  handleBalanceUpdateCallback,
  parseTokenAmount,
  isTokenSupportedByRailgun,
  getShieldableTokens,
}; 