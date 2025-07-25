/**
 * RAILGUN Private Balance Management - SIMPLIFIED NO CACHE VERSION
 * Always fetches live from Railgun SDK - no caching
 */

import { 
  refreshBalances,
  getWalletBalance,
  getRailgunBalances 
} from '@railgun-community/wallet';
import { parseUnits } from 'ethers';
import { waitForRailgunReady } from './engine.js';
import { getCurrentWalletID } from './wallet.js';

// Helper to normalize token addresses (following official V2 pattern)
const normalizeTokenAddress = (tokenAddress) => {
  if (!tokenAddress || tokenAddress === '0x00' || tokenAddress === '0x0000000000000000000000000000000000000000') {
    return undefined; // Native token
  }
  return tokenAddress.toLowerCase();
};

// Network mapping for chain ID to Railgun network names
const getRailgunNetworkName = (chainId) => {
  const mapping = {
    1: 'Ethereum',
    42161: 'Arbitrum', 
    137: 'Polygon',
    56: 'BNBChain'
  };
  return mapping[chainId] || 'Ethereum';
};

/**
 * Get private RAILGUN balances - always live from SDK
 */
export const getPrivateBalances = async (walletID, chainId) => {
  try {
    console.log('[RailgunBalances] 🚀 Fetching live private balances from Railgun SDK:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId
    });

    await waitForRailgunReady();
    
    // Get fresh balances from Railgun SDK
    const networkName = getRailgunNetworkName(chainId);
    const balances = await getRailgunBalances(networkName, walletID);
    
    if (!balances || balances.length === 0) {
      console.log('[RailgunBalances] No private balances found');
      return [];
    }

    console.log('[RailgunBalances] ✅ Retrieved live private balances:', {
      count: balances.length,
      tokens: balances.map(b => `${b.tokenHash}: ${b.amount}`)
    });

    return balances;
  } catch (error) {
    console.error('[RailgunBalances] ❌ Failed to get private balances:', error);
    return [];
  }
};

/**
 * Refresh private balances - triggers Railgun SDK refresh
 */
export const refreshPrivateBalances = async (walletID, chainId) => {
  try {
    console.log('[RailgunBalances] 🔄 Refreshing private balances via Railgun SDK');
    
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    await refreshBalances(networkName, [walletID]);
    
    console.log('[RailgunBalances] ✅ Private balance refresh completed');
    return true;
  } catch (error) {
    console.error('[RailgunBalances] ❌ Failed to refresh private balances:', error);
    return false;
  }
};

/**
 * Refresh and get fresh balances 
 */
export const refreshPrivateBalancesAndStore = async (walletID, chainId) => {
  await refreshPrivateBalances(walletID, chainId);
  return await getPrivateBalances(walletID, chainId);
};

/**
 * Parse token amount from decimal string to base units
 * @param {string} amount - Amount in decimal format
 * @param {number} decimals - Token decimals
 * @returns {string} Amount in base units
 */
export const parseTokenAmount = (amount, decimals) => {
  try {
    if (!amount || amount === '0') return '0';
    return parseUnits(amount, decimals).toString();
  } catch (error) {
    console.error('[RailgunBalances] Failed to parse token amount:', error);
    return '0';
  }
};

// Backward compatibility exports
export const getPrivateBalancesFromCache = getPrivateBalances; // No cache, just fetch live
export { getPrivateBalances as default }; 