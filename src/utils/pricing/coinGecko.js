/**
 * CoinGecko Price Fetching Utility
 * Fetches real-time cryptocurrency prices for USD value calculations
 */

// CoinGecko token ID mappings for supported tokens
const COINGECKO_TOKEN_IDS = {
  // Ethereum Network
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'WETH': 'weth',
  'WBTC': 'wrapped-bitcoin',

  // Polygon Network
  'MATIC': 'matic-network',
  'POL': 'polygon-ecosystem-token',
  'WMATIC': 'wmatic',
  'WPOL': 'wrapped-polygon-ecosystem-token',

  // Arbitrum Network
  'ARB': 'arbitrum',

  // Optimism Network
  'OP': 'optimism',

  // BSC Network
  'BNB': 'binancecoin',
  'WBNB': 'wbnb',
  'BUSD': 'binance-usd',
  'CAKE': 'pancakeswap-token',
};

// Price cache to avoid excessive API calls
const priceCache = new Map();
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch prices for multiple tokens from CoinGecko
 * @param {Array<string>} tokenSymbols - Array of token symbols to fetch prices for
 * @returns {Object} Object mapping token symbols to USD prices
 */
export const fetchTokenPrices = async (tokenSymbols) => {
  try {
    if (!tokenSymbols || tokenSymbols.length === 0) {
      return {};
    }

    console.log('[CoinGecko] Fetching prices for tokens:', tokenSymbols);

    // Filter out tokens we don't have CoinGecko IDs for
    const supportedTokens = tokenSymbols.filter(symbol => COINGECKO_TOKEN_IDS[symbol]);
    const unsupportedTokens = tokenSymbols.filter(symbol => !COINGECKO_TOKEN_IDS[symbol]);

    if (unsupportedTokens.length > 0) {
      console.warn('[CoinGecko] Unsupported tokens (no CoinGecko ID):', unsupportedTokens);
    }

    if (supportedTokens.length === 0) {
      console.warn('[CoinGecko] No supported tokens to fetch prices for');
      return {};
    }

    // Check cache first
    const currentTime = Date.now();
    const cachedPrices = {};
    const tokensToFetch = [];

    supportedTokens.forEach(symbol => {
      const cached = priceCache.get(symbol);
      if (cached && (currentTime - cached.timestamp) < CACHE_DURATION) {
        cachedPrices[symbol] = cached.price;
      } else {
        tokensToFetch.push(symbol);
      }
    });

    // Return cached prices if all are cached
    if (tokensToFetch.length === 0) {
      console.log('[CoinGecko] Using cached prices:', cachedPrices);
      return cachedPrices;
    }

    // Build CoinGecko API URL
    const coinIds = tokensToFetch.map(symbol => COINGECKO_TOKEN_IDS[symbol]).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`;

    console.log('[CoinGecko] Fetching from API:', url);

    // Fetch prices from CoinGecko
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[CoinGecko] API response:', data);

    // Map CoinGecko response back to token symbols
    const prices = { ...cachedPrices };
    
    tokensToFetch.forEach(symbol => {
      const coinId = COINGECKO_TOKEN_IDS[symbol];
      const priceData = data[coinId];
      
      if (priceData && typeof priceData.usd === 'number') {
        prices[symbol] = priceData.usd;
        
        // Cache the price
        priceCache.set(symbol, {
          price: priceData.usd,
          timestamp: currentTime,
          change24h: priceData.usd_24h_change || 0,
        });
      } else {
        console.warn(`[CoinGecko] No price data for ${symbol} (${coinId})`);
        prices[symbol] = 0;
      }
    });

    console.log('[CoinGecko] Fetched prices:', prices);
    return prices;
  } catch (error) {
    console.error('[CoinGecko] Error fetching token prices:', error);
    
    // Return cached prices as fallback
    const fallbackPrices = {};
    tokenSymbols.forEach(symbol => {
      const cached = priceCache.get(symbol);
      if (cached) {
        fallbackPrices[symbol] = cached.price;
      } else {
        fallbackPrices[symbol] = 0;
      }
    });
    
    return fallbackPrices;
  }
};

/**
 * Get cached price for a single token
 * @param {string} tokenSymbol - Token symbol
 * @returns {number} Cached price or 0 if not available
 */
export const getCachedPrice = (tokenSymbol) => {
  const cached = priceCache.get(tokenSymbol);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.price;
  }
  return 0;
};

/**
 * Calculate USD value for a token amount
 * @param {string} tokenSymbol - Token symbol
 * @param {number} tokenAmount - Token amount (numeric, not wei)
 * @param {number} [price] - Optional price override (otherwise fetches from cache/API)
 * @returns {string} USD value formatted as string
 */
export const calculateUSDValue = async (tokenSymbol, tokenAmount, price = null) => {
  try {
    if (!tokenAmount || tokenAmount <= 0) {
      return '0.00';
    }

    let tokenPrice = price;
    
    if (tokenPrice === null) {
      // Try to get cached price first
      tokenPrice = getCachedPrice(tokenSymbol);
      
      // If no cached price, fetch it
      if (tokenPrice === 0) {
        const prices = await fetchTokenPrices([tokenSymbol]);
        tokenPrice = prices[tokenSymbol] || 0;
      }
    }

    if (tokenPrice === 0) {
      console.warn(`[CoinGecko] No price available for ${tokenSymbol}`);
      return '0.00';
    }

    const usdValue = tokenAmount * tokenPrice;
    
    // Format USD value
    if (usdValue < 0.01 && usdValue > 0) {
      return '< 0.01';
    }
    
    return usdValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (error) {
    console.error('[CoinGecko] Error calculating USD value:', error);
    return '0.00';
  }
};

/**
 * Clear price cache (useful for manual refresh)
 */
export const clearPriceCache = () => {
  priceCache.clear();
  console.log('[CoinGecko] Price cache cleared');
};

/**
 * Get cache status for debugging
 */
export const getCacheStatus = () => {
  const currentTime = Date.now();
  const cacheStatus = {};
  
  priceCache.forEach((data, symbol) => {
    const age = currentTime - data.timestamp;
    cacheStatus[symbol] = {
      price: data.price,
      ageMs: age,
      isValid: age < CACHE_DURATION,
    };
  });
  
  return cacheStatus;
};

export default {
  fetchTokenPrices,
  getCachedPrice,
  calculateUSDValue,
  clearPriceCache,
  getCacheStatus,
}; 