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
import { formatUnits, parseUnits, isAddress } from 'ethers';
import { waitForRailgunReady } from './engine.js';
import { getCurrentWalletID } from './wallet.js';
import { refreshBalances } from '@railgun-community/wallet';

// Balance cache
let balanceCache = new Map();
let lastBalanceUpdate = new Map();

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
    console.log('[RailgunBalances] Getting private balances from cache:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
    });
    
    // Return cached balances - the real balances come through callbacks
    const cacheKey = `${walletID}-${chainId}`;
    const cachedBalances = balanceCache.get(cacheKey) || [];
    
    console.log('[RailgunBalances] Retrieved private balances from cache:', {
      count: cachedBalances.length,
      tokens: cachedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
    });
    
    return cachedBalances;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get private balances:', error);
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
    
    // Handle native token (undefined address)
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      return getNativeTokenInfo(chainId);
    }
    
    // Get ERC20 token data
    const tokenData = await getTokenDataERC20(networkName, tokenAddress);
    
    if (tokenData) {
      return {
        address: tokenAddress,
        symbol: tokenData.symbol,
        name: tokenData.name,
        decimals: tokenData.decimals,
        isNative: false,
      };
    }
    
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
  const lastUpdate = lastBalanceUpdate.get(cacheKey);
  
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
  balanceCache.clear();
  lastBalanceUpdate.clear();
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
 * Handle Railgun balance update callback (like the old working code)
 * @param {Object} balanceEvent - Balance update event from Railgun
 */
export const handleBalanceUpdateCallback = async (balanceEvent) => {
  try {
    console.log('[RailgunBalances] Balance callback triggered:', balanceEvent);
    
    const { networkName, railgunWalletID, erc20Amounts, balanceBucket } = balanceEvent;
    
    // Only process spendable balances
    if (balanceBucket !== 'Spendable') {
      console.log(`[RailgunBalances] Ignoring non-spendable balance bucket: ${balanceBucket}`);
      return;
    }
    
    // Get chain ID from network name
    const chainId = getChainIdFromNetworkName(networkName);
    if (!chainId) {
      console.warn('[RailgunBalances] Unknown network name:', networkName);
      return;
    }
    
    console.log('[RailgunBalances] Processing balance update for:', {
      networkName,
      chainId,
      walletID: railgunWalletID?.slice(0, 8) + '...',
      tokenCount: erc20Amounts?.length || 0,
    });
    
    // Process token balances
    const formattedBalances = [];
    
    if (erc20Amounts) {
      for (const { tokenAddress, amount } of erc20Amounts) {
        try {
          // Get token information
          const tokenData = await getTokenInfo(tokenAddress, chainId);
          
          if (tokenData && amount.toString() !== '0') {
            const balance = {
              tokenAddress,
              symbol: tokenData.symbol,
              name: tokenData.name,
              decimals: tokenData.decimals,
              balance: amount.toString(),
              formattedBalance: formatUnits(amount.toString(), tokenData.decimals),
              numericBalance: parseFloat(formatUnits(amount.toString(), tokenData.decimals)),
              hasBalance: amount.toString() !== '0',
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
    lastBalanceUpdate.set(cacheKey, Date.now());
    
    console.log('[RailgunBalances] Cache updated with callback data:', {
      count: formattedBalances.length,
      tokens: formattedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
    });
    
    // Dispatch custom event for UI to listen to
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('railgun-balance-update', {
        detail: { railgunWalletID, chainId, balances: formattedBalances }
      }));
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