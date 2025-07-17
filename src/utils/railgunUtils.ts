import { formatUnits, formatEther, createPublicClient, custom } from 'viem';
import { mainnet, polygon, bsc, arbitrum } from 'viem/chains';

// Supported chains configuration with custom RPC URLs
export const SUPPORTED_CHAINS = {
  1: { 
    id: 1, 
    name: 'Ethereum', 
    shortName: 'ETH',
    chain: {
      ...mainnet,
      rpcUrls: {
        default: {
          http: ['/api/get-balance']
        }
      }
    },
    nativeSymbol: 'ETH'
  },
  137: { 
    id: 137, 
    name: 'Polygon', 
    shortName: 'MATIC',
    chain: {
      ...polygon,
      rpcUrls: {
        default: {
          http: ['/api/get-balance']
        }
      }
    },
    nativeSymbol: 'MATIC'
  },
  56: { 
    id: 56, 
    name: 'BNB Chain', 
    shortName: 'BNB',
    chain: {
      ...bsc,
      rpcUrls: {
        default: {
          http: ['/api/get-balance']
        }
      }
    },
    nativeSymbol: 'BNB'
  },
  42161: { 
    id: 42161, 
    name: 'Arbitrum One', 
    shortName: 'ARB',
    chain: {
      ...arbitrum,
      rpcUrls: {
        default: {
          http: ['/api/get-balance']
        }
      }
    },
    nativeSymbol: 'ETH'
  }
};

// Supported tokens per chain
export const SUPPORTED_TOKENS = {
  ETH: {
    1: { address: null, decimals: 18 }, // Native ETH
    137: { address: null, decimals: 18 }, // Native MATIC  
    56: { address: null, decimals: 18 }, // Native BNB
    42161: { address: null, decimals: 18 }, // Native ETH on Arbitrum
  },
  USDC: {
    1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }, // Official USDC on Ethereum
    137: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }, // Official USDC on Polygon
    56: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }, // Binance-Peg USDC on BSC
    42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }, // Official USDC on Arbitrum
  },
  USDT: {
    1: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    137: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    56: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    42161: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 }, // USDT on Arbitrum
  },
  DAI: {
    1: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    137: { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
    56: { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
    42161: { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 }, // DAI on Arbitrum
  },
  BUSD: {
    56: { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 }, // Native BUSD on BSC
  }
};

// ERC-20 ABI for balance queries
export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Simple in-memory cache for balance results
interface BalanceCache {
  [key: string]: {
    balance: string;
    timestamp: number;
    ttl: number;
  };
}

const balanceCache: BalanceCache = {};

const CACHE_TTL = 45 * 1000; // 45 seconds

// Helper function to create cache key
function createCacheKey(type: 'public' | 'private', chainId: number, tokenSymbol: string, address: string): string {
  return `${type}:${chainId}:${tokenSymbol}:${address.toLowerCase()}`;
}

// Check if cache entry is valid
function isCacheValid(cacheKey: string): boolean {
  const entry = balanceCache[cacheKey];
  if (!entry) return false;
  return Date.now() - entry.timestamp < entry.ttl;
}

// Get from cache
function getFromCache(cacheKey: string): string | null {
  if (isCacheValid(cacheKey)) {
    return balanceCache[cacheKey].balance;
  }
  return null;
}

// Set cache
function setCache(cacheKey: string, balance: string): void {
  balanceCache[cacheKey] = {
    balance,
    timestamp: Date.now(),
    ttl: CACHE_TTL
  };
}

// Create a custom transport that routes through our Vercel API
const createCustomTransport = (chainId: number) => custom({
  async request({ method, params }: any) {
    const response = await fetch('/api/get-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chainId,
        method,
        params,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }
    
    const { result, error } = await response.json();
    if (error) {
      throw new Error(`RPC error: ${JSON.stringify(error)}`);
    }
    
    return result;
  },
});

// Create public clients for each chain using custom transport
const publicClients = Object.fromEntries(
  Object.entries(SUPPORTED_CHAINS).map(([chainId, config]) => [
    chainId,
    createPublicClient({
      chain: config.chain,
      transport: createCustomTransport(parseInt(chainId))
    })
  ])
);

// Fetch public balances for all chains and tokens
export async function fetchPublicBalances(userAddress: string): Promise<Record<number, Record<string, string>>> {
  const balances: Record<number, Record<string, string>> = {};

  for (const [chainIdStr, chainConfig] of Object.entries(SUPPORTED_CHAINS)) {
    const chainId = parseInt(chainIdStr);
    balances[chainId] = {};
    const client = publicClients[chainId];

    for (const [tokenSymbol, tokenChains] of Object.entries(SUPPORTED_TOKENS)) {
      const tokenConfig = tokenChains[chainId];
      if (!tokenConfig) continue;

      const cacheKey = createCacheKey('public', chainId, tokenSymbol, userAddress);
      const cachedBalance = getFromCache(cacheKey);

      if (cachedBalance) {
        balances[chainId][tokenSymbol] = cachedBalance;
        continue;
      }

      try {
        let balance: bigint;

        if (tokenConfig.address === null) {
          // Native token (ETH, MATIC, BNB)
          balance = await client.getBalance({ address: userAddress as `0x${string}` });
        } else {
          // ERC-20 token
          balance = await client.readContract({
            address: tokenConfig.address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [userAddress as `0x${string}`],
          });
        }

        const formattedBalance = parseFloat(formatUnits(balance, tokenConfig.decimals)).toFixed(
          tokenConfig.decimals === 18 ? 4 : 2
        );

        balances[chainId][tokenSymbol] = formattedBalance;
        setCache(cacheKey, formattedBalance);

      } catch (error) {
        console.error(`Failed to fetch ${tokenSymbol} balance on chain ${chainId}:`, error);
        balances[chainId][tokenSymbol] = '0.0000';
      }
    }
  }

  return balances;
}

// Fetch private Railgun balances for all chains and tokens
export async function fetchPrivateBalances(
  railgunAddress: string, 
  userAddress: string
): Promise<Record<number, Record<string, string>>> {
  const balances: Record<number, Record<string, string>> = {};

  try {
    const railgunWallet = await import('@railgun-community/wallet');
    
    console.log('Available RAILGUN functions:', Object.keys(railgunWallet));
    
    for (const [chainIdStr, chainConfig] of Object.entries(SUPPORTED_CHAINS)) {
      const chainId = parseInt(chainIdStr);
      balances[chainId] = {};

      for (const [tokenSymbol, tokenChains] of Object.entries(SUPPORTED_TOKENS)) {
        const tokenConfig = tokenChains[chainId];
        if (!tokenConfig) continue;

        const cacheKey = createCacheKey('private', chainId, tokenSymbol, userAddress);
        const cachedBalance = getFromCache(cacheKey);

        if (cachedBalance) {
          balances[chainId][tokenSymbol] = cachedBalance;
          continue;
        }

        try {
          let railgunBalance = tokenConfig.decimals === 18 ? '0.0000' : '0.00';

          // Try to find and use available balance methods
          const walletMethods = railgunWallet as any;
          
          // Check for common balance function patterns
          const possibleMethods = [
            'getWalletBalanceERC20',
            'getRailgunWalletBalanceERC20', 
            'getBalance',
            'getTokenBalance',
            'getWalletBalance'
          ];

          for (const methodName of possibleMethods) {
            if (typeof walletMethods[methodName] === 'function') {
              console.log(`Trying ${methodName} for ${tokenSymbol} on chain ${chainId}`);
              try {
                const tokenAddress = tokenConfig.address || '0x0000000000000000000000000000000000000000';
                
                // Try different parameter combinations
                let balance;
                if (methodName.includes('ERC20')) {
                  balance = await walletMethods[methodName](railgunAddress, tokenAddress, chainIdStr);
                } else {
                  balance = await walletMethods[methodName](railgunAddress, chainIdStr, tokenAddress);
                }
                
                                 if (balance) {
                   if (typeof balance === 'object' && balance.balance) {
                     railgunBalance = parseFloat(formatUnits(balance.balance, tokenConfig.decimals)).toFixed(
                       tokenConfig.decimals === 18 ? 4 : 2
                     );
                   } else if (typeof balance === 'bigint') {
                     railgunBalance = parseFloat(formatUnits(balance, tokenConfig.decimals)).toFixed(
                       tokenConfig.decimals === 18 ? 4 : 2
                     );
                   } else if (typeof balance === 'string') {
                     // Handle string balance (might be hex or decimal)
                     try {
                       const bigintBalance = BigInt(balance);
                       railgunBalance = parseFloat(formatUnits(bigintBalance, tokenConfig.decimals)).toFixed(
                         tokenConfig.decimals === 18 ? 4 : 2
                       );
                     } catch (e) {
                       console.log(`Failed to convert string balance to bigint: ${balance}`);
                     }
                   }
                   console.log(`${methodName} succeeded for ${tokenSymbol}:`, railgunBalance);
                   break; // Exit loop if successful
                 }
              } catch (methodError) {
                console.log(`${methodName} failed for ${tokenSymbol}:`, methodError.message);
              }
            }
          }

          balances[chainId][tokenSymbol] = railgunBalance;
          setCache(cacheKey, railgunBalance);

        } catch (error) {
          console.error(`Failed to fetch Railgun ${tokenSymbol} balance on chain ${chainId}:`, error);
          balances[chainId][tokenSymbol] = tokenConfig.decimals === 18 ? '0.0000' : '0.00';
        }
      }
    }

  } catch (importError) {
    console.log('Railgun balance functions not available, showing zero private balances');
    
    // Initialize with zeros if Railgun unavailable
    for (const [chainIdStr] of Object.entries(SUPPORTED_CHAINS)) {
      const chainId = parseInt(chainIdStr);
      balances[chainId] = {};
      
      for (const tokenSymbol of Object.keys(SUPPORTED_TOKENS)) {
        const tokenConfig = SUPPORTED_TOKENS[tokenSymbol][chainId];
        if (tokenConfig) {
          balances[chainId][tokenSymbol] = tokenConfig.decimals === 18 ? '0.0000' : '0.00';
        }
      }
    }
  }

  return balances;
}

// Refresh Railgun balances (call before fetching private balances)
export async function refreshRailgunBalances(userAddress: string, railgunAddress: string): Promise<void> {
  try {
    const railgunWallet = await import('@railgun-community/wallet');
    
    // Try various refresh methods
    const walletMethods = railgunWallet as any;
    
    if (typeof walletMethods.refreshBalances === 'function') {
      console.log('Refreshing Railgun balances using refreshBalances...');
      await walletMethods.refreshBalances(userAddress, railgunAddress);
      console.log('Railgun balances refreshed successfully');
    } else if (typeof walletMethods.refreshRailgunBalances === 'function') {
      console.log('Refreshing Railgun balances using refreshRailgunBalances...');
      await walletMethods.refreshRailgunBalances(userAddress, railgunAddress);
      console.log('Railgun balances refreshed successfully');
    } else {
      console.log('No refresh balance method found in RAILGUN SDK');
    }
  } catch (error) {
    console.log('Failed to refresh Railgun balances:', error);
  }
}

// Clear cache (useful for manual refresh)
export function clearBalanceCache(): void {
  Object.keys(balanceCache).forEach(key => delete balanceCache[key]);
}

// Get token configuration for a specific chain and symbol
export function getTokenConfig(chainId: number, tokenSymbol: string) {
  return SUPPORTED_TOKENS[tokenSymbol]?.[chainId];
}

// Get chain configuration
export function getChainConfig(chainId: number) {
  return SUPPORTED_CHAINS[chainId];
}

// Format balance for display
export function formatBalanceForDisplay(balance: string, decimals: number): string {
  const num = parseFloat(balance);
  if (num === 0) return decimals === 18 ? '0.0000' : '0.00';
  return num.toFixed(decimals === 18 ? 4 : 2);
} 