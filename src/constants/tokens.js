/**
 * Supported tokens across different networks
 * Used for shielding, unshielding, and private transfers
 */

export const SUPPORTED_TOKENS = {
  // Ethereum Mainnet (Chain ID: 1)
  1: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      address: null, // Native token
      coingeckoId: 'ethereum',
      isNative: true,
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ethereum',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      coingeckoId: 'weth',
      isNative: false,
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xA0b86a33E6441c8D2c7Fc09C31a8b1C53a4e8C45',
      coingeckoId: 'usd-coin',
      isNative: false,
    },
    USDT: {
      symbol: 'USDT', 
      name: 'Tether USD',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      coingeckoId: 'tether',
      isNative: false,
    },
    DAI: {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      coingeckoId: 'dai',
      isNative: false,
    },
    WBTC: {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      coingeckoId: 'wrapped-bitcoin',
      isNative: false,
    },
    UNI: {
      symbol: 'UNI',
      name: 'Uniswap',
      decimals: 18,
      address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      coingeckoId: 'uniswap',
      isNative: false,
    },
  },

  // Polygon (Chain ID: 137)
  137: {
    MATIC: {
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18,
      address: null, // Native token
      coingeckoId: 'matic-network',
      isNative: true,
    },
    WMATIC: {
      symbol: 'WMATIC',
      name: 'Wrapped MATIC',
      decimals: 18,
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      coingeckoId: 'wmatic',
      isNative: false,
    },
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum (Bridged)',
      decimals: 18,
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      coingeckoId: 'ethereum',
      isNative: false,
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      coingeckoId: 'usd-coin',
      isNative: false,
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      coingeckoId: 'tether',
      isNative: false,
    },
    DAI: {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      coingeckoId: 'dai',
      isNative: false,
    },
  },

  // Arbitrum One (Chain ID: 42161)
  42161: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      address: null, // Native token
      coingeckoId: 'ethereum',
      isNative: true,
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ethereum',
      decimals: 18,
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      coingeckoId: 'weth',
      isNative: false,
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      coingeckoId: 'usd-coin',
      isNative: false,
    },
    'USDC.e': {
      symbol: 'USDC.e',
      name: 'USD Coin (Bridged)',
      decimals: 6,
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      coingeckoId: 'usd-coin',
      isNative: false,
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      coingeckoId: 'tether',
      isNative: false,
    },
    DAI: {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      coingeckoId: 'dai',
      isNative: false,
    },
    ARB: {
      symbol: 'ARB',
      name: 'Arbitrum',
      decimals: 18,
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      coingeckoId: 'arbitrum',
      isNative: false,
    },
  },

  // BSC (Chain ID: 56)
  56: {
    BNB: {
      symbol: 'BNB',
      name: 'BNB',
      decimals: 18,
      address: null, // Native token
      coingeckoId: 'binancecoin',
      isNative: true,
    },
    WBNB: {
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      decimals: 18,
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      coingeckoId: 'wbnb',
      isNative: false,
    },
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum (Bridged)',
      decimals: 18,
      address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      coingeckoId: 'ethereum',
      isNative: false,
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 18,
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      coingeckoId: 'usd-coin',
      isNative: false,
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 18,
      address: '0x55d398326f99059fF775485246999027B3197955',
      coingeckoId: 'tether',
      isNative: false,
    },
    BUSD: {
      symbol: 'BUSD',
      name: 'BUSD Token',
      decimals: 18,
      address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      coingeckoId: 'binance-usd',
      isNative: false,
    },
    CAKE: {
      symbol: 'CAKE',
      name: 'PancakeSwap Token',
      decimals: 18,
      address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      coingeckoId: 'pancakeswap-token',
      isNative: false,
    },
  },

  // Note: Optimism (Chain ID: 10) temporarily disabled until Railgun SDK adds full support
  // 10: {
  //   ETH: {
  //     symbol: 'ETH',
  //     name: 'Ethereum',
  //     decimals: 18,
  //     address: null, // Native token
  //     coingeckoId: 'ethereum',
  //     isNative: true,
  //   },
  //   WETH: {
  //     symbol: 'WETH',
  //     name: 'Wrapped Ethereum',
  //     decimals: 18,
  //     address: '0x4200000000000000000000000000000000000006',
  //     coingeckoId: 'weth',
  //     isNative: false,
  //   },
  //   USDC: {
  //     symbol: 'USDC',
  //     name: 'USD Coin',
  //     decimals: 6,
  //     address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  //     coingeckoId: 'usd-coin',
  //     isNative: false,
  //   },
  //   'USDC.e': {
  //     symbol: 'USDC.e',
  //     name: 'USD Coin (Bridged)',
  //     decimals: 6,
  //     address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  //     coingeckoId: 'usd-coin',
  //     isNative: false,
  //   },
  //   USDT: {
  //     symbol: 'USDT',
  //     name: 'Tether USD',
  //     decimals: 6,
  //     address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  //     coingeckoId: 'tether',
  //     isNative: false,
  //   },
  //   DAI: {
  //     symbol: 'DAI',
  //     name: 'Dai Stablecoin',
  //     decimals: 18,
  //     address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  //     coingeckoId: 'dai',
  //     isNative: false,
  //   },
  //   OP: {
  //     symbol: 'OP',
  //     name: 'Optimism',
  //     decimals: 18,
  //     address: '0x4200000000000000000000000000000000000042',
  //     coingeckoId: 'optimism',
  //     isNative: false,
  //   },
  // },
};

// Get token by symbol and chain ID
export const getToken = (chainId, symbol) => {
  return SUPPORTED_TOKENS[chainId]?.[symbol] || null;
};

// Get all tokens for a chain
export const getTokensForChain = (chainId) => {
  return SUPPORTED_TOKENS[chainId] || {};
};

// Get token list as array for UI
export const getTokenArray = (chainId) => {
  const tokens = getTokensForChain(chainId);
  return Object.values(tokens);
};

// Check if token is supported
export const isTokenSupported = (chainId, tokenAddress) => {
  const tokens = getTokensForChain(chainId);
  return Object.values(tokens).some(token => 
    token.address?.toLowerCase() === tokenAddress?.toLowerCase() ||
    (token.isNative && !tokenAddress)
  );
};

// Get native token for a chain
export const getNativeToken = (chainId) => {
  const tokens = getTokensForChain(chainId);
  return Object.values(tokens).find(token => token.isNative) || null;
};

// Search tokens by symbol across all chains
export const findTokenBySymbol = (symbol) => {
  const results = [];
  Object.entries(SUPPORTED_TOKENS).forEach(([chainId, tokens]) => {
    Object.values(tokens).forEach(token => {
      if (token.symbol.toLowerCase() === symbol.toLowerCase()) {
        results.push({ ...token, chainId: parseInt(chainId) });
      }
    });
  });
  return results;
};

export default SUPPORTED_TOKENS; 