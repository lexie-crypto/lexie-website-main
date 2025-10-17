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

// Native gas token mapping by chain ID
const NATIVE_GAS_TOKENS = {
  1: 'ETH',      // Ethereum
  137: 'POL',    // Polygon (POL after rebrand)
  56: 'BNB',     // BSC
  42161: 'ETH',  // Arbitrum (uses ETH)
};

/**
 * Get native gas token symbol for a chain ID
 */
export const getNativeGasToken = (chainId) => {
  return NATIVE_GAS_TOKENS[chainId] || 'ETH'; // Default to ETH
};

/**
 * Emergency hardcoded token decimals for critical tokens
 */
export const getKnownTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return null;

  const address = tokenAddress.toLowerCase();
  const knownTokens = {
    // Ethereum
    1: {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { decimals: 18, symbol: 'WETH' },
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { decimals: 6, symbol: 'USDT' },
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { decimals: 6, symbol: 'USDC' },
      '0x6b175474e89094c44da98b954eedeac495271d0f': { decimals: 18, symbol: 'DAI' },
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { decimals: 8, symbol: 'WBTC' },
      '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': { decimals: 18, symbol: 'MATIC' },
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { decimals: 18, symbol: 'WBNB' },
    },
    // Polygon
    137: {
      '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { decimals: 18, symbol: 'WETH' },
      '0x4557328f4c0e5f986bc92c6a6f25b7e9c6e25b9e': { decimals: 18, symbol: 'POL' },
      '0x6d1fdbb266fcc09a16a22016369210a15bb95761': { decimals: 18, symbol: 'WPOL' },
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { decimals: 6, symbol: 'USDT' },
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': { decimals: 6, symbol: 'USDC' },
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { decimals: 18, symbol: 'DAI' },
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { decimals: 8, symbol: 'WBTC' },
      '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': { decimals: 18, symbol: 'WMATIC' },
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { decimals: 18, symbol: 'WBNB' },
    },
    // BNB Chain
    56: {
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8': { decimals: 18, symbol: 'WETH' },
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { decimals: 18, symbol: 'WBNB' },
      '0x55d398326f99059ff775485246999027b3197955': { decimals: 18, symbol: 'USDT' },
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': { decimals: 18, symbol: 'USDC' },
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': { decimals: 18, symbol: 'DAI' },
      '0x0555e30da8f98308edb960aa94c0db47230d2b9c': { decimals: 8, symbol: 'WBTC' },
      '0xCC42724C6683B7E57334c4E856f4c9965ED682bD': { decimals: 18, symbol: 'MATIC' },
    },
    // Arbitrum
    42161: {
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { decimals: 18, symbol: 'WETH' },
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { decimals: 6, symbol: 'USDT' },
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { decimals: 6, symbol: 'USDC' },
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { decimals: 18, symbol: 'DAI' },
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { decimals: 8, symbol: 'WBTC' },
      '0x561877b6b3DD7651313794e5F2894B2F18bE0766': { decimals: 18, symbol: 'MATIC' },
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': { decimals: 18, symbol: 'WBNB' },
    },
  };

  const chainTokens = knownTokens[chainId];
  if (!chainTokens) return null;

  return chainTokens[address] || null;
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
 * Round balance down to 8 decimal places to prevent precision issues
 * @param {string} balanceWei - Balance in wei/base units
 * @param {number} decimals - Token decimals
 * @returns {string} Rounded balance in wei/base units
 */
export const roundBalanceTo8Decimals = (balanceWei, decimals) => {
  try {
    if (!balanceWei || balanceWei === '0' || decimals < 8) return balanceWei;

    // Convert to BigInt
    const balanceBigInt = BigInt(balanceWei);

    // For 8 decimal places, we truncate at the 10^(decimals-8) level
    // For 18 decimals, we truncate at 10^10 level
    const truncateLevel = decimals - 8;
    const divisor = BigInt(10) ** BigInt(truncateLevel);

    // Truncate by dividing and multiplying back
    const truncated = (balanceBigInt / divisor) * divisor;

    return truncated.toString();
  } catch (error) {
    console.error('[RailgunBalances] Failed to round balance:', error);
    return balanceWei;
  }
};

/**
 * Parse token amount from decimal string to base units
 * @param {string} amount - Amount in decimal format
 * @param {number} decimals - Token decimals
 * @returns {string} Amount in base units (always floored, never rounded up)
 */
export const parseTokenAmount = (amount, decimals) => {
  try {
    if (!amount || amount === '0') return '0';

    // Convert to BigInt with flooring to prevent rounding up
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    const fullAmount = whole + paddedFraction;

    // Remove leading zeros and handle negative
    const cleanAmount = fullAmount.replace(/^0+/, '') || '0';

    // Apply 8 decimal place rounding to prevent precision issues
    return roundBalanceTo8Decimals(cleanAmount, decimals);
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