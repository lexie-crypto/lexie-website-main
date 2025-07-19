/**
 * Cache Debug Utility for RAILGUN Balance Cache
 * Helps diagnose cache persistence issues
 */

/**
 * Debug the current state of the balance cache
 * @param {string} context - Context where this is being called
 */
export const debugBalanceCache = (context = 'Unknown') => {
  try {
    console.log(`[CacheDebug] 🔍 Cache state at: ${context}`);
    
    // Check localStorage directly
    const balanceKey = 'railgun-private-balances';
    const updateKey = 'railgun-balance-updates';
    
    const cachedBalances = localStorage.getItem(balanceKey);
    const cachedUpdates = localStorage.getItem(updateKey);
    
    console.log('[CacheDebug] localStorage contents:', {
      balances: cachedBalances ? JSON.parse(cachedBalances) : null,
      updates: cachedUpdates ? JSON.parse(cachedUpdates) : null,
      balancesSize: cachedBalances ? cachedBalances.length : 0,
      updatesSize: cachedUpdates ? cachedUpdates.length : 0
    });
    
    // Check for specific wallet cache
    if (cachedBalances) {
      const parsed = JSON.parse(cachedBalances);
      console.log('[CacheDebug] Cache keys found:', Object.keys(parsed));
      
      for (const [key, balances] of Object.entries(parsed)) {
        console.log(`[CacheDebug] Key: ${key}, Balances: ${balances.length} tokens`);
        balances.forEach(balance => {
          console.log(`  - ${balance.symbol}: ${balance.formattedBalance}`);
        });
      }
    }
    
  } catch (error) {
    console.error('[CacheDebug] Error debugging cache:', error);
  }
};

/**
 * Test cache persistence by setting and getting a test value
 */
export const testCachePersistence = () => {
  try {
    const testKey = 'railgun-cache-test';
    const testData = { 
      timestamp: Date.now(), 
      test: 'persistence-check',
      tokens: [{ symbol: 'TEST', amount: '100' }]
    };
    
    console.log('[CacheDebug] 🧪 Testing cache persistence...');
    
    // Set test data
    localStorage.setItem(testKey, JSON.stringify(testData));
    
    // Immediately read it back
    const retrieved = localStorage.getItem(testKey);
    const parsed = retrieved ? JSON.parse(retrieved) : null;
    
    console.log('[CacheDebug] Persistence test:', {
      set: testData,
      retrieved: parsed,
      success: parsed && parsed.timestamp === testData.timestamp
    });
    
    // Clean up
    localStorage.removeItem(testKey);
    
    return parsed && parsed.timestamp === testData.timestamp;
    
  } catch (error) {
    console.error('[CacheDebug] Cache persistence test failed:', error);
    return false;
  }
};

/**
 * Force cache a test balance to verify the caching system
 * @param {string} walletID - Test wallet ID
 * @param {number} chainId - Test chain ID
 */
export const forceCacheTestBalance = (walletID, chainId) => {
  try {
    const testBalance = [{
      tokenAddress: null,
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      balance: '1000000000000000000', // 1 ETH
      formattedBalance: '1.0',
      numericBalance: 1.0,
      hasBalance: true,
      isPrivate: true,
      chainId,
      networkName: 'Arbitrum'
    }];
    
    const balanceKey = 'railgun-private-balances';
    const updateKey = 'railgun-balance-updates';
    const cacheKey = `${walletID}-${chainId}`;
    
    // Get existing cache
    const existing = localStorage.getItem(balanceKey);
    const cache = existing ? JSON.parse(existing) : {};
    
    // Set test balance
    cache[cacheKey] = testBalance;
    localStorage.setItem(balanceKey, JSON.stringify(cache));
    
    // Set update timestamp
    const existingUpdates = localStorage.getItem(updateKey);
    const updates = existingUpdates ? JSON.parse(existingUpdates) : {};
    updates[cacheKey] = Date.now();
    localStorage.setItem(updateKey, JSON.stringify(updates));
    
    console.log('[CacheDebug] 🧪 Force cached test balance:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
      balance: testBalance[0]
    });
    
    return true;
    
  } catch (error) {
    console.error('[CacheDebug] Failed to force cache test balance:', error);
    return false;
  }
};

export default {
  debugBalanceCache,
  testCachePersistence,
  forceCacheTestBalance
}; 