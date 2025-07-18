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
  getERC20Balances,
  refreshRailgunBalances,
  rescanFullUTXOMerkletreesAndWallets,
  fullRescanUTXOMerkletreesAndWalletsForNetwork,
  getTokenDataERC20,
  searchableERC20s,
} from '@railgun-community/wallet';
import { 
  NetworkName,
  formatToLocaleWithMinDecimals,
  RailgunERC20Amount,
} from '@railgun-community/shared-models';
import { formatUnits, parseUnits, isAddress } from 'ethers';
import { waitForRailgunReady, refreshBalances } from './engine.js';
import { getCurrentWalletID } from './wallet.js';

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
 * Get private token balances for a wallet
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of token balance objects
 */
export const getPrivateBalances = async (walletID, chainId) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    
    console.log('[RailgunBalances] Getting private balances:', {
      walletID: walletID?.slice(0, 8) + '...',
      networkName,
    });
    
    // Get ERC20 balances
    const erc20Balances = await getERC20Balances(networkName, walletID);
    
    // Process and format balances
    const formattedBalances = [];
    
    for (const [tokenAddress, railgunAmount] of Object.entries(erc20Balances)) {
      try {
        // Get token information
        const tokenData = await getTokenInfo(tokenAddress, chainId);
        
        if (tokenData && railgunAmount.amountString !== '0') {
          const balance = {
            tokenAddress,
            symbol: tokenData.symbol,
            name: tokenData.name,
            decimals: tokenData.decimals,
            balance: railgunAmount.amountString,
            formattedBalance: formatUnits(railgunAmount.amountString, tokenData.decimals),
            numericBalance: parseFloat(formatUnits(railgunAmount.amountString, tokenData.decimals)),
            hasBalance: railgunAmount.amountString !== '0',
            isPrivate: true,
            chainId,
            networkName,
          };
          
          formattedBalances.push(balance);
        }
      } catch (error) {
        console.warn('[RailgunBalances] Failed to process token:', tokenAddress, error);
      }
    }
    
    // Cache the balances
    const cacheKey = `${walletID}-${chainId}`;
    balanceCache.set(cacheKey, formattedBalances);
    lastBalanceUpdate.set(cacheKey, Date.now());
    
    console.log('[RailgunBalances] Retrieved private balances:', {
      count: formattedBalances.length,
      tokens: formattedBalances.map(b => `${b.symbol}: ${b.formattedBalance}`),
    });
    
    return formattedBalances;
    
  } catch (error) {
    console.error('[RailgunBalances] Failed to get private balances:', error);
    throw new Error(`Private balance retrieval failed: ${error.message}`);
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
 * Refresh private balances for a wallet
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Updated balance array
 */
export const refreshPrivateBalances = async (walletID, chainId) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    
    console.log('[RailgunBalances] Refreshing private balances...');
    
    // Refresh RAILGUN balances
    await refreshBalances(walletID, networkName);
    
    // Get updated balances
    const updatedBalances = await getPrivateBalances(walletID, chainId);
    
    console.log('[RailgunBalances] Private balances refreshed');
    
    return updatedBalances;
    
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
}; 