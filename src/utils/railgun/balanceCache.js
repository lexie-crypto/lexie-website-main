/**
 * Shielded Balance Cache System
 * Based on official Railgun SDK pattern from @railgun-community/wallet
 * Caches spendable balances to avoid repeated Merkle tree scans
 */

import { RailgunWalletBalanceBucket } from '@railgun-community/shared-models';

// Type definitions for the cache structure
// Structure: {chainType: {chainID: {walletID: {tokenAddress: CachedBalance}}}}
const shieldedTokenBalanceCache = {};

// Track pending balance promises for reliable waiting
const balancePromises = {}; // {walletID_chainID: {resolve: Function, reject: Function}}

export const CachedBalance = {
  erc20Amount: null,
  updatedAt: 0,
  chainId: 0,
  walletId: '',
};

/**
 * Reset the entire balance cache (useful for testing or wallet changes)
 */
export const resetShieldedTokenBalanceCache = () => {
  Object.keys(shieldedTokenBalanceCache).forEach(key => delete shieldedTokenBalanceCache[key]);
  console.log('[BalanceCache] 🧹 Cache reset');
};

/**
 * Reset cache for specific wallet (when wallet disconnects)
 * @param {string} walletId - Railgun wallet ID
 */
export const resetWalletBalanceCache = (walletId) => {
  Object.keys(shieldedTokenBalanceCache).forEach(chainType => {
    Object.keys(shieldedTokenBalanceCache[chainType] || {}).forEach(chainId => {
      if (shieldedTokenBalanceCache[chainType][chainId][walletId]) {
        delete shieldedTokenBalanceCache[chainType][chainId][walletId];
        console.log('[BalanceCache] 🧹 Reset cache for wallet:', walletId.slice(0, 8) + '...');
      }
    });
  });
};

/**
 * Get cached private token balances for a specific wallet and chain
 * @param {Object} chain - Chain object with type and id
 * @param {string} walletId - Railgun wallet ID
 * @returns {Array} Array of cached balance objects
 */
export const getPrivateTokenBalanceCache = (chain, walletId) => {
  if (!chain || !walletId) {
    console.warn('[BalanceCache] ⚠️ Missing chain or walletId for cache lookup');
    return [];
  }

  // Initialize cache structure if needed
  shieldedTokenBalanceCache[chain.type] = shieldedTokenBalanceCache[chain.type] || {};
  shieldedTokenBalanceCache[chain.type][chain.id] = shieldedTokenBalanceCache[chain.type][chain.id] || {};
  shieldedTokenBalanceCache[chain.type][chain.id][walletId] = shieldedTokenBalanceCache[chain.type][chain.id][walletId] || {};

  const walletCache = shieldedTokenBalanceCache[chain.type][chain.id][walletId];
  const cachedBalances = Object.values(walletCache).map(cached => ({
    erc20Amount: { ...cached.erc20Amount },
    updatedAt: cached.updatedAt,
    chainId: cached.chainId,
    walletId: cached.walletId,
  }));

  console.log('[BalanceCache] 📊 Retrieved cached balances:', {
    chainType: chain.type,
    chainId: chain.id,
    walletId: walletId.slice(0, 8) + '...',
    tokenCount: cachedBalances.length,
    tokens: cachedBalances.map(b => ({
      address: b.erc20Amount.tokenAddress.slice(0, 10) + '...',
      amount: b.erc20Amount.amount,
      symbol: b.erc20Amount.symbol || 'Unknown'
    }))
  });

  return cachedBalances;
};

/**
 * Get cached balance for a specific token
 * @param {Object} chain - Chain object with type and id
 * @param {string} walletId - Railgun wallet ID
 * @param {string} tokenAddress - Token contract address
 * @returns {Object|null} Cached balance object or null if not found
 */
export const getCachedTokenBalance = (chain, walletId, tokenAddress) => {
  if (!chain || !walletId || !tokenAddress) {
    return null;
  }

  const walletCache = shieldedTokenBalanceCache[chain.type]?.[chain.id]?.[walletId];
  if (!walletCache) {
    return null;
  }

  const cached = walletCache[tokenAddress.toLowerCase()];
  if (!cached) {
    return null;
  }

  console.log('[BalanceCache] 🎯 Found cached token balance:', {
    tokenAddress: tokenAddress.slice(0, 10) + '...',
    amount: cached.erc20Amount.amount,
    age: `${Math.round((Date.now() - cached.updatedAt) / 1000)}s ago`
  });

  return {
    erc20Amount: { ...cached.erc20Amount },
    updatedAt: cached.updatedAt,
    chainId: cached.chainId,
    walletId: cached.walletId,
  };
};

/**
 * Check if sufficient cached balance exists for a specific amount
 * @param {Object} chain - Chain object with type and id
 * @param {string} walletId - Railgun wallet ID
 * @param {string} tokenAddress - Token contract address
 * @param {string} requiredAmount - Required amount in base units
 * @returns {boolean} True if sufficient cached balance exists
 */
export const hasSufficientCachedBalance = (chain, walletId, tokenAddress, requiredAmount) => {
  const cached = getCachedTokenBalance(chain, walletId, tokenAddress);
  if (!cached) {
    return false;
  }

  const available = BigInt(cached.erc20Amount.amount || '0');
  const required = BigInt(requiredAmount);
  const sufficient = available >= required;

  console.log('[BalanceCache] 💰 Balance sufficiency check:', {
    tokenAddress: tokenAddress.slice(0, 10) + '...',
    available: available.toString(),
    required: required.toString(),
    sufficient
  });

  return sufficient;
};

/**
 * Wait for balance update after a transaction or sync
 * @param {string} walletId - Railgun wallet ID
 * @param {number} chainId - Chain ID
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} Resolves when balance update received or timeout
 */
export const waitForBalanceUpdate = (walletId, chainId, timeoutMs = 30000) => {
  const promiseKey = `${walletId}_${chainId}`;
  
  // If there's already a pending promise for this wallet/chain, return it
  if (balancePromises[promiseKey]) {
    console.log('[BalanceCache] ⏳ Reusing existing balance promise:', {
      walletId: walletId.slice(0, 8) + '...',
      chainId
    });
    return balancePromises[promiseKey].promise;
  }

  console.log('[BalanceCache] 🔄 Creating balance update promise:', {
    walletId: walletId.slice(0, 8) + '...',
    chainId,
    timeout: `${timeoutMs}ms`
  });

  let resolveFunction, rejectFunction;
  const promise = new Promise((resolve, reject) => {
    resolveFunction = resolve;
    rejectFunction = reject;
  });

  balancePromises[promiseKey] = {
    promise,
    resolve: resolveFunction,
    reject: rejectFunction,
    timestamp: Date.now()
  };

  // Set timeout
  setTimeout(() => {
    if (balancePromises[promiseKey]) {
      console.warn('[BalanceCache] ⏰ Balance update timeout:', {
        walletId: walletId.slice(0, 8) + '...',
        chainId,
        elapsed: `${timeoutMs}ms`
      });
      balancePromises[promiseKey].resolve(false); // Resolve with false on timeout
      delete balancePromises[promiseKey];
    }
  }, timeoutMs);

  return promise;
};

/**
 * Called by SDK when balances are updated - caches spendable balances
 * This is the core function that populates our cache
 * @param {Object} balancesEvent - Balance update event from Railgun SDK
 */
export const onBalanceUpdateCallback = ({
  chain,
  erc20Amounts,
  railgunWalletID,
  balanceBucket,
  txidVersion
}) => {
  // Only cache spendable balances
  if (balanceBucket !== RailgunWalletBalanceBucket.Spendable) {
    console.log('[BalanceCache] ℹ️ Ignoring non-spendable bucket:', balanceBucket);
    return;
  }

  console.log('[BalanceCache] 💎 Caching spendable balance update:', {
    walletId: railgunWalletID.slice(0, 8) + '...',
    chainType: chain.type,
    chainId: chain.id,
    tokenCount: erc20Amounts.length,
    bucket: balanceBucket
  });

  // Initialize cache structure
  shieldedTokenBalanceCache[chain.type] = shieldedTokenBalanceCache[chain.type] || {};
  shieldedTokenBalanceCache[chain.type][chain.id] = shieldedTokenBalanceCache[chain.type][chain.id] || {};
  shieldedTokenBalanceCache[chain.type][chain.id][railgunWalletID] = shieldedTokenBalanceCache[chain.type][chain.id][railgunWalletID] || {};

  const walletCache = shieldedTokenBalanceCache[chain.type][chain.id][railgunWalletID];
  const now = Date.now();

  // Cache each token balance
  erc20Amounts.forEach((erc20Amount) => {
    const tokenAddress = erc20Amount.tokenAddress.toLowerCase();
    walletCache[tokenAddress] = {
      erc20Amount: { ...erc20Amount },
      updatedAt: now,
      chainId: chain.id,
      walletId: railgunWalletID,
    };

    console.log('[BalanceCache] 📝 Cached token balance:', {
      tokenAddress: tokenAddress.slice(0, 10) + '...',
      amount: erc20Amount.amount,
      symbol: erc20Amount.symbol || 'Unknown'
    });
  });

  // Resolve any pending balance promises for this wallet/chain
  const promiseKey = `${railgunWalletID}_${chain.id}`;
  if (balancePromises[promiseKey]) {
    console.log('[BalanceCache] ✅ Resolving balance update promise:', {
      walletId: railgunWalletID.slice(0, 8) + '...',
      chainId: chain.id,
      tokensUpdated: erc20Amounts.length
    });
    
    balancePromises[promiseKey].resolve(true);
    delete balancePromises[promiseKey];
  }

  // Dispatch custom event for UI updates
  window.dispatchEvent(new CustomEvent('railgun-balance-cached', {
    detail: {
      walletId: railgunWalletID,
      chainId: chain.id,
      tokenCount: erc20Amounts.length,
      timestamp: now
    }
  }));
};

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export const getCacheStats = () => {
  let totalWallets = 0;
  let totalTokens = 0;
  let oldestUpdate = Date.now();
  let newestUpdate = 0;

  Object.values(shieldedTokenBalanceCache).forEach(chainTypeCache => {
    Object.values(chainTypeCache).forEach(chainIdCache => {
      Object.values(chainIdCache).forEach(walletCache => {
        totalWallets++;
        Object.values(walletCache).forEach(tokenCache => {
          totalTokens++;
          oldestUpdate = Math.min(oldestUpdate, tokenCache.updatedAt);
          newestUpdate = Math.max(newestUpdate, tokenCache.updatedAt);
        });
      });
    });
  });

  return {
    totalWallets,
    totalTokens,
    oldestUpdate: oldestUpdate === Date.now() ? null : oldestUpdate,
    newestUpdate: newestUpdate || null,
    pendingPromises: Object.keys(balancePromises).length
  };
};

/**
 * Clean up old cache entries (optional maintenance)
 * @param {number} maxAgeMs - Maximum age in milliseconds
 */
export const cleanupOldCache = (maxAgeMs = 24 * 60 * 60 * 1000) => { // 24 hours default
  const cutoff = Date.now() - maxAgeMs;
  let cleaned = 0;

  Object.keys(shieldedTokenBalanceCache).forEach(chainType => {
    Object.keys(shieldedTokenBalanceCache[chainType]).forEach(chainId => {
      Object.keys(shieldedTokenBalanceCache[chainType][chainId]).forEach(walletId => {
        const walletCache = shieldedTokenBalanceCache[chainType][chainId][walletId];
        Object.keys(walletCache).forEach(tokenAddress => {
          if (walletCache[tokenAddress].updatedAt < cutoff) {
            delete walletCache[tokenAddress];
            cleaned++;
          }
        });
      });
    });
  });

  if (cleaned > 0) {
    console.log('[BalanceCache] 🧹 Cleaned up old cache entries:', cleaned);
  }
};