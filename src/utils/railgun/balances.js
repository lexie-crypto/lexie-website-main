/**
 * RAILGUN Private Balance Management - SIMPLIFIED NO CACHE VERSION
 * Always fetches live from Railgun SDK - no caching
 */

// ✅ REMOVED: getRailgunBalances doesn't exist - we use callback system now
// refreshBalances will be imported dynamically when needed
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
 * Get private RAILGUN balances - DEPRECATED: Use SDK callbacks instead
 * This function now triggers a refresh and relies on callbacks for data
 */
export const getPrivateBalances = async (walletID, chainId) => {
  console.warn('[RailgunBalances] ⚠️ getPrivateBalances is deprecated - use SDK callbacks instead');
  
  // Trigger a refresh but don't return data directly
  // The actual data will come through the callback system
  await refreshPrivateBalances(walletID, chainId);
  
  // Return empty array - data comes through callbacks
  return [];
};

/**
 * Refresh private balances - triggers Railgun SDK refresh with restrictions preserved
 */
export const refreshPrivateBalances = async (walletID, chainId) => {
  try {
    console.log('[RailgunBalances] 🔄 Triggering RAILGUN SDK refresh (callbacks will handle results)');
    
    await waitForRailgunReady();
    
    // ✅ FIXED: Use correct SDK function that exists
    const { refreshBalances } = await import('@railgun-community/wallet');
    
    // Map chainId to proper Chain object (as expected by SDK)
    const { NetworkName, NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const networkName = getRailgunNetworkName(chainId);
    const networkConfig = NETWORK_CONFIG[networkName];
    
    if (!networkConfig) {
      throw new Error(`No network config found for ${networkName}`);
    }
    
    // Use the chain object from network config
    const chain = networkConfig.chain;
    
    // ✅ CORRECT: refreshBalances expects (chain, walletIdFilter)
    await refreshBalances(chain, [walletID]);
    
    console.log('[RailgunBalances] ✅ SDK refresh triggered - results will come via callbacks');
    return true;
  } catch (error) {
    console.error('[RailgunBalances] ❌ Failed to trigger SDK refresh:', error);
    return false;
  }
};

/**
 * Refresh and get fresh balances - UPDATED: Callback-based approach
 */
export const refreshPrivateBalancesAndStore = async (walletID, chainId) => {
  console.log('[RailgunBalances] 🔄 Triggering refresh - data will come via callbacks');
  
  // Trigger the refresh - actual data comes through callback system
  const success = await refreshPrivateBalances(walletID, chainId);
  
  if (success) {
    console.log('[RailgunBalances] ✅ Refresh triggered successfully - waiting for callback data');
  }
  
  // Return empty array - actual data comes through SDK callbacks to useBalances
  return [];
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

/**
 * Handle balance update callback from Railgun SDK
 * This integrates with useBalances hook to update UI state
 * @param {Object} balancesEvent - Balance update event from Railgun SDK
 */
export const handleBalanceUpdateCallback = async (balancesEvent) => {
  try {
    console.log('[RailgunBalances] 🎯 Balance update callback fired:', {
      walletID: balancesEvent.railgunWalletID?.slice(0, 8) + '...',
      chainId: balancesEvent.chain?.id,
      chainType: balancesEvent.chain?.type,
      bucket: balancesEvent.balanceBucket,
      erc20Count: balancesEvent.erc20Amounts?.length || 0,
      nftCount: balancesEvent.nftAmounts?.length || 0
    });

    // Dispatch custom event for useBalances hook to listen to
    const event = new CustomEvent('railgun-balance-update', {
      detail: balancesEvent
    });
    
    window.dispatchEvent(event);
    
    console.log('[RailgunBalances] ✅ Balance update event dispatched to UI');
    
  } catch (error) {
    console.error('[RailgunBalances] ❌ Error handling balance update callback:', error);
  }
};

// Backward compatibility exports - UPDATED: All callback-based now
export const getPrivateBalancesFromCache = () => {
  console.warn('[RailgunBalances] ⚠️ getPrivateBalancesFromCache is deprecated - use SDK callbacks');
  return []; // No cache, data comes from callbacks
};
export { getPrivateBalances as default }; 