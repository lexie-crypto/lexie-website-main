/**
 * useBalances Hook - Redis-Only Balance Management
 * Public balances: Real-time from blockchain
 * Private balances: Redis-only with optimistic updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, formatUnits, Contract } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { fetchTokenPrices } from '../utils/pricing/coinGecko';
import { RPC_URLS } from '../config/environment';

// ERC20 ABI for balance checking
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// Token lists by chain
const TOKEN_LISTS = {
  1: [ // Ethereum
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: 1 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, chainId: 1 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, chainId: 1 },
    { address: '0x2260FAC5E5542a773Aa44fBcfeDf7C193bc2c599', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chainId: 1 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, chainId: 1 },
  ],
  42161: [ // Arbitrum
    { address: '0x82af49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, chainId: 42161 },
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: 42161 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, chainId: 42161 },
    { address: '0x2f2a2543B76A4166549F7AaB2e75BEF0aefC5b0f', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chainId: 42161 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6, chainId: 42161 },
  ],
  137: [ // Polygon
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, chainId: 137 },
    { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WMATIC', name: 'Wrapped MATIC', decimals: 18, chainId: 137 },
    { address: '0x4557328F4C0E5F986bC92c6a6f25b7E9C6E25B9e', symbol: 'POL', name: 'Polygon Ecosystem Token', decimals: 18, chainId: 137 },
    { address: '0x6d1fdBB266fCc09A16a22016369210a15bb95761', symbol: 'WPOL', name: 'Wrapped POL', decimals: 18, chainId: 137 },
    { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: 137 },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', name: 'USD Coin (PoS)', decimals: 6, chainId: 137 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin (PoS)', decimals: 18, chainId: 137 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chainId: 137 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD (PoS)', decimals: 6, chainId: 137 },
  ],
  56: [ // BSC
    { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, chainId: 56 },
    { address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18, chainId: 56 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, chainId: 56 },
    { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Token', decimals: 18, chainId: 56 },
    { address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, chainId: 56 },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18, chainId: 56 }, // BSC USDT uses 18 decimals
  ],
};

// Function to get token decimals by address and chain
export const getTokenDecimals = (tokenAddress, chainId) => {
  const tokenList = TOKEN_LISTS[chainId];
  if (!tokenList) return 18; // Default fallback
  
      const token = tokenList.find(
        t => t.address.toLowerCase() === tokenAddress.toLowerCase()
      );
  
  return token ? token.decimals : 18;
};

// Function to get token info by address and chain
export const getTokenInfo = (tokenAddress, chainId) => {
  const tokenList = TOKEN_LISTS[chainId];
  if (!tokenList) return null;
  
  return tokenList.find(
    t => t.address.toLowerCase() === tokenAddress.toLowerCase()
  );
};

// Chain ID to RPC URL mapping
const CHAIN_RPC_MAPPING = {
  1: RPC_URLS.ethereum,
  42161: RPC_URLS.arbitrum,
  137: RPC_URLS.polygon,
  56: RPC_URLS.bsc,
};

export function useBalances() {
  const { address, chainId, railgunWalletId, isRailgunInitialized } = useWallet();

  // State
  const [publicBalances, setPublicBalances] = useState([]);
  const [privateBalances, setPrivateBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tokenPrices, setTokenPrices] = useState({});
  const [isPrivateBalancesLoading, setIsPrivateBalancesLoading] = useState(false);
  const [bootstrappedChains, setBootstrappedChains] = useState(new Set());

  // Stable refs for event listeners
  const stableRefs = useRef({});
  const lastSpendableUpdateRef = useRef(0); // timestamp of last SDK Spendable update
  const hasAutoRefreshed = useRef(false);

  // Listen for disconnect events to abort ongoing requests
  useEffect(() => {
    const handleWalletDisconnecting = () => {
      console.log('[useBalances] 📡 Received wallet disconnecting event - aborting all requests');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('abort-all-requests'));
      }
      setLoading(false);
    };

    const handleAbortAllRequests = () => {
      console.log('[useBalances] 🛑 Received abort-all-requests event - stopping all operations');
      setLoading(false);
    };

    const handleForceDisconnect = () => {
      console.log('[useBalances] 💥 Received force-disconnect event - IMMEDIATE ABORT');
      // Force clear all state immediately
      setPublicBalances([]);
      setPrivateBalances([]);
      setLoading(false);
      setError(null);
      setLastUpdated(null);
      setTokenPrices({});
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('wallet-disconnecting', handleWalletDisconnecting);
      window.addEventListener('abort-all-requests', handleAbortAllRequests);
      window.addEventListener('force-disconnect', handleForceDisconnect);
      return () => {
        window.removeEventListener('wallet-disconnecting', handleWalletDisconnecting);
        window.removeEventListener('abort-all-requests', handleAbortAllRequests);
        window.removeEventListener('force-disconnect', handleForceDisconnect);
      };
    }
  }, []);

  useEffect(() => {
    stableRefs.current = {
      address,
      chainId,
      railgunWalletId,
      publicBalances,
      privateBalances,
      tokenPrices
    };
  });

  // Get RPC provider for specific chain
  const getProvider = useCallback((targetChainId) => {
    const rpcUrl = CHAIN_RPC_MAPPING[targetChainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${targetChainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl);
  }, []);

  // Fetch and cache token prices
  const fetchAndCachePrices = useCallback(async (symbols) => {
    try {
      // Include wrapped base-token symbols to ensure pricing coverage
      const priceSymbols = [
        ...symbols,
        'WETH', 'WMATIC', 'WPOL', 'WBNB', 'WBTC', // wrapped base tokens
      ];
      const uniqueSymbols = [...new Set(priceSymbols)];
      const prices = await fetchTokenPrices(uniqueSymbols);
      setTokenPrices(prev => ({ ...prev, ...prices }));
      return prices;
    } catch (error) {
      console.error('[useBalances] Failed to fetch token prices:', error);
      return {};
    }
  }, []);

  // Calculate USD value for a balance
  const calculateUSDValue = useCallback((numericBalance, symbol, pricesOverride = null) => {
    const prices = pricesOverride || stableRefs.current.tokenPrices;
    // Resolve common wrapper/alias symbols to their base asset prices if needed
    const aliasMap = {
      WETH: 'ETH',
      WMATIC: 'MATIC',
      WPOL: 'POL', // WPOL wraps POL
      WBNB: 'BNB',
      WBTC: 'BTC',
      'USDC.e': 'USDC',
    };
    const resolvedSymbol = prices[symbol] != null ? symbol : (aliasMap[symbol] || symbol);
    const price = prices[resolvedSymbol];
    if (price && typeof price === 'number' && numericBalance > 0) {
      return (numericBalance * price).toFixed(2);
    }
    return '0.00';
  }, []); // No dependencies - access prices via stableRefs

  // Filter balances by USD value >= $0.01
  const filterBalancesByUSDValue = useCallback((balances) => {
    if (!Array.isArray(balances)) return [];
    return balances.filter(token => {
      const usdValue = parseFloat(token.balanceUSD || '0');
      return usdValue >= 0.01;
    });
  }, []);

  // Format balance for display
  const formatBalance = useCallback((balance, decimals = 2) => {
    if (typeof balance !== 'number') return '0.00';
    if (balance === 0) return '0.00';
    if (balance < 0.001) return '<0.001';
    if (balance < 1) return balance.toFixed(Math.min(decimals + 2, 6));
    return balance.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }, []);

  // Fetch native token balance
  const fetchNativeBalance = useCallback(async (userAddress, targetChainId) => {
    try {
      const provider = getProvider(targetChainId);
      const balance = await provider.getBalance(userAddress);
      
      const nativeTokens = {
        1: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        42161: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
        137: { symbol: 'MATIC', name: 'Polygon', decimals: 18 },
        56: { symbol: 'BNB', name: 'BNB Smart Chain', decimals: 18 },
      };

      const nativeToken = nativeTokens[targetChainId];
      if (!nativeToken) return null;

      const formattedBalance = formatUnits(balance, nativeToken.decimals);
      const numericBalance = parseFloat(formattedBalance);

      return {
        address: undefined, // Native token has no address
        symbol: nativeToken.symbol,
        name: nativeToken.name,
        decimals: nativeToken.decimals,
        balance: balance.toString(),
        formattedBalance: formattedBalance,
        numericBalance: numericBalance,
        hasBalance: numericBalance > 0,
        chainId: targetChainId,
      };
    } catch (error) {
      console.error('[useBalances] Failed to fetch native balance:', error);
      return null;
    }
  }, [getProvider]);

  // Fetch ERC20 token balance
  const fetchTokenBalance = useCallback(async (userAddress, tokenInfo, targetChainId) => {
    try {
      // Skip tokens that don't belong to the active chain
      if (tokenInfo.chainId && tokenInfo.chainId !== targetChainId) {
        return null;
      }

      const provider = getProvider(targetChainId);
      // Normalize address to lowercase to avoid checksum mismatches from different libs
      const normalizedAddress = (tokenInfo.address || '').trim().toLowerCase();

      // Check if address is actually a contract to avoid BAD_DATA errors
      const code = await provider.getCode(normalizedAddress);
      if (code === "0x") {
        console.warn(`[useBalances] Skipping non-contract address: ${normalizedAddress}`);
        return null;
      }

      const contract = new Contract(normalizedAddress, ERC20_ABI, provider);
      
      const [balance, decimals, symbol, name] = await Promise.all([
        contract.balanceOf(userAddress),
        contract.decimals().catch(() => tokenInfo.decimals),
        Promise.resolve(tokenInfo.symbol),
        contract.name().catch(() => tokenInfo.name),
      ]);

      const formattedBalance = formatUnits(balance, decimals);
      const numericBalance = parseFloat(formattedBalance);

      return {
        address: normalizedAddress,
        symbol: symbol,
        name: name,
        decimals: Number(decimals),
        balance: balance.toString(),
        balanceUnits: balance, // BigInt balance for precise comparisons
        formattedBalance: formattedBalance,
        numericBalance: numericBalance,
        hasBalance: numericBalance > 0,
        chainId: targetChainId,
      };
    } catch (error) {
      console.error(`[useBalances] Failed to fetch balance for ${tokenInfo.symbol}:`, error);
      return null;
    }
  }, [getProvider]);

  // Fetch all public balances from blockchain
  const fetchPublicBalances = useCallback(async () => {
    if (!address || !chainId) {
      console.log('[useBalances] ⏸️ Public balance fetch blocked - no wallet connected');
      return [];
    }

    try {
      console.log('[useBalances] 🔄 Fetching public balances from blockchain...');
      setError(null);

      const tokenList = TOKEN_LISTS[chainId] || [];

      // Fetch native token and ERC20 tokens in parallel
      const balancePromises = [
        fetchNativeBalance(address, chainId),
        ...tokenList.map(token => fetchTokenBalance(address, token, chainId))
      ];

      const results = await Promise.allSettled(balancePromises);

      const balances = results
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);

      console.log('[useBalances] ✅ Fetched public balances:', {
        total: balances.length,
        withBalance: balances.filter(b => b.hasBalance).length
      });

      return balances;
    } catch (error) {
      console.error('[useBalances] Failed to fetch public balances:', error);
      setError(error.message);
      return [];
    }
  }, [address, chainId, fetchNativeBalance, fetchTokenBalance]);

  // Load private balances from Redis ONLY
  const loadPrivateBalancesFromMetadata = useCallback(async (walletAddress, railgunWalletId) => {
    try {
      console.log('[useBalances] 🛡️ Loading private balances from Redis...');

      // 1) Prefer the dedicated balances endpoint (authoritative, chain-aware)
      try {
        const balancesResp = await fetch(`/api/wallet-metadata?action=balances&walletAddress=${encodeURIComponent(walletAddress)}&walletId=${encodeURIComponent(railgunWalletId)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (balancesResp.ok) {
          const balancesJson = await balancesResp.json();
          const allBalances = balancesJson?.balances?.balances || balancesJson?.balances || [];
          const balancesForCurrentChain = allBalances.filter(b => b.chainId === chainId);

          if (Array.isArray(balancesForCurrentChain) && balancesForCurrentChain.length > 0) {
            const privateBalancesFromRedis = balancesForCurrentChain.map(balance => {
              const tokenInfo = getTokenInfo(balance.tokenAddress, chainId);
              // Handle Redis balance - could be wei string, decimal string, or scientific notation
              const storedBalance = balance.numericBalance || 0;
              const balanceStr = String(storedBalance);
              let numeric, weiBalanceStr;

              const decimals = balance.decimals ?? 18;

              if (typeof storedBalance === 'string' && (balanceStr.includes('.') || balanceStr.includes('e'))) {
                // Stored as decimal string (possibly scientific notation)
                numeric = Number(storedBalance);
                // Convert scientific notation to decimal string for parseUnits
                const decimalStr = numeric.toFixed(20).replace(/\.?0+$/, ''); // Remove trailing zeros
                weiBalanceStr = ethers.parseUnits(decimalStr, decimals).toString();
              } else if (typeof storedBalance === 'number') {
                // Stored as decimal number
                numeric = storedBalance;
                weiBalanceStr = ethers.parseUnits(storedBalance.toString(), decimals).toString();
              } else {
                // Assume stored as wei string
                weiBalanceStr = balanceStr;
                try {
                  numeric = parseFloat(ethers.formatUnits(weiBalanceStr, decimals));
                } catch (e) {
                  console.warn('[useBalances] Failed to parse Redis wei balance, trying as decimal:', weiBalanceStr);
                  // Try parsing as decimal instead
                  try {
                    numeric = Number(weiBalanceStr);
                    weiBalanceStr = ethers.parseUnits(weiBalanceStr, decimals).toString();
                  } catch (e2) {
                    console.warn('[useBalances] Failed to parse Redis balance, falling back to 0:', weiBalanceStr);
                    numeric = 0;
                    weiBalanceStr = '0';
                  }
                }
              }
              return {
                symbol: balance.symbol,
                address: balance.tokenAddress,
                tokenAddress: balance.tokenAddress,
                name: tokenInfo?.name || `${balance.symbol} Token`,
                numericBalance: numeric,
                formattedBalance: numeric.toFixed(6),
                balance: weiBalanceStr, // Wei string for precision
                decimals: balance.decimals ?? 18,
                hasBalance: numeric > 0,
                isPrivate: true,
                lastUpdated: balance.lastUpdated,
                balanceUSD: calculateUSDValue(numeric, balance.symbol)
              };
            });

            console.log('[useBalances] ✅ Loaded private balances via balances endpoint:', {
              chainId,
              count: privateBalancesFromRedis.length,
              tokens: privateBalancesFromRedis.map(b => `${b.symbol}: ${b.numericBalance}`)
            });

            setPrivateBalances(filterBalancesByUSDValue(privateBalancesFromRedis));
            return true;
          }
        } else {
          console.log('[useBalances] ℹ️ Balances endpoint not available or returned non-200, falling back to metadata');
        }
      } catch (e) {
        console.warn('[useBalances] ⚠️ Balances endpoint failed, falling back to metadata:', e?.message);
      }

      // 2) Fallback to legacy metadata format
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        console.log('[useBalances] No wallet metadata found in Redis');
        return false;
      }
      const result = await response.json();
      if (!result.success || !result.keys || result.keys.length === 0) {
        console.log('[useBalances] No wallet metadata keys found');
        return false;
      }
      const metadata = result.keys.find(k => k.walletId === railgunWalletId);
      if (!metadata || !metadata.privateBalances || metadata.privateBalances.length === 0) {
        console.log('[useBalances] No private balances found in Redis (metadata fallback)');
        return false;
      }
      const balancesForCurrentChain = metadata.privateBalances.filter(balance => balance.chainId === chainId);
      if (balancesForCurrentChain.length === 0) {
        console.log(`[useBalances] No private balances found for chain ${chainId} (metadata fallback)`);
        // Per-network view: clear stale balances from previous chain
        setPrivateBalances([]);
        return false;
      }
      const privateBalancesFromRedis = balancesForCurrentChain.map(balance => {
        const tokenInfo = getTokenInfo(balance.tokenAddress, chainId);
        // Handle Redis balance - could be wei string, decimal string, or scientific notation
        const storedBalance = balance.numericBalance || 0;
        const balanceStr = String(storedBalance);
        let numeric, weiBalanceStr;

        const decimals = balance.decimals ?? 18;

        if (typeof storedBalance === 'string' && (balanceStr.includes('.') || balanceStr.includes('e'))) {
          // Stored as decimal string (possibly scientific notation)
          numeric = Number(storedBalance);
          // Convert scientific notation to decimal string for parseUnits
          const decimalStr = numeric.toFixed(20).replace(/\.?0+$/, ''); // Remove trailing zeros
          weiBalanceStr = ethers.parseUnits(decimalStr, decimals).toString();
        } else if (typeof storedBalance === 'number') {
          // Stored as decimal number
          numeric = storedBalance;
          weiBalanceStr = ethers.parseUnits(storedBalance.toString(), decimals).toString();
        } else {
          // Assume stored as wei string
          weiBalanceStr = balanceStr;
          try {
            numeric = parseFloat(ethers.formatUnits(weiBalanceStr, decimals));
          } catch (e) {
            console.warn('[useBalances] Failed to parse Redis wei balance (fallback), trying as decimal:', weiBalanceStr);
            // Try parsing as decimal instead
            try {
              numeric = Number(weiBalanceStr);
              weiBalanceStr = ethers.parseUnits(weiBalanceStr, decimals).toString();
            } catch (e2) {
              console.warn('[useBalances] Failed to parse Redis balance (fallback), using 0:', weiBalanceStr);
              numeric = 0;
              weiBalanceStr = '0';
            }
          }
        }

        return {
          symbol: balance.symbol,
          address: balance.tokenAddress,
          tokenAddress: balance.tokenAddress,
          name: tokenInfo?.name || `${balance.symbol} Token`,
          numericBalance: numeric,
          formattedBalance: numeric.toFixed(6),
          balance: weiBalanceStr, // Wei string for precision
          decimals: balance.decimals,
          hasBalance: numeric > 0,
          isPrivate: true,
          lastUpdated: balance.lastUpdated,
          balanceUSD: calculateUSDValue(numeric, balance.symbol)
        };
      });
      console.log('[useBalances] ✅ Loaded private balances from Redis (metadata fallback):', {
        chainId,
        count: privateBalancesFromRedis.length,
        totalInRedis: metadata.privateBalances.length,
        tokens: privateBalancesFromRedis.map(b => `${b.symbol}: ${b.numericBalance}`)
      });
      setPrivateBalances(filterBalancesByUSDValue(privateBalancesFromRedis));
      return true;
      
    } catch (error) {
      console.error('[useBalances] Failed to load private balances from Redis:', error);
      return false;
    }
  }, [chainId]);

  // Refresh all balances
  const refreshAllBalances = useCallback(async () => {
    if (!address) {
      console.log('[useBalances] ⏸️ Balance refresh blocked - no wallet connected');
      return;
    }

    setLoading(true);
    try { window.dispatchEvent(new CustomEvent('vault-balances-refresh-start')); } catch {}
    try {
      console.log('[useBalances] 🔄 Refreshing balances...');

      // Fetch prices
      const allSymbols = [
        ...new Set([
          ...(TOKEN_LISTS[chainId] || []).map(t => t.symbol),
          'ETH', 'MATIC', 'POL', 'BNB', 'BTC', // Native tokens + BTC for WBTC pricing
        ])
      ];
      const freshPrices = await fetchAndCachePrices(allSymbols);

      // Fetch public balances from blockchain
      const publicBals = await fetchPublicBalances();

      // Add USD values to public balances
      const publicWithUSD = publicBals.map(token => ({
        ...token,
        balanceUSD: calculateUSDValue(token.numericBalance, token.symbol, freshPrices)
      }));

      // Set public balances
      setPublicBalances(publicWithUSD);
      setLastUpdated(Date.now());

            // Refresh private balances from backend (no SDK refresh here - only on explicit Refresh button)
      try {
        if (railgunWalletId) {
          const resp = await fetch(`/api/wallet-metadata?action=balances&walletAddress=${address}&walletId=${railgunWalletId}`);
          if (resp.ok) {
            const json = await resp.json();
            const list = json?.balances?.balances || [];
            // Per-network view: only keep balances for the active chain
            const listForChain = list.filter(t => Number(t.chainId) === Number(chainId));
            if (Array.isArray(listForChain) && listForChain.length > 0) {
              const privateWithUSD = listForChain.map(token => {
                // Handle backend balance - convert to wei for consistency
                const backendBalance = token.numericBalance || 0;
                let numeric, weiBalanceStr;

                if (typeof backendBalance === 'string' && (backendBalance.includes('.') || backendBalance.includes('e'))) {
                  // Backend returned decimal string (possibly scientific notation)
                  numeric = Number(backendBalance);
                  const decimals = token.decimals ?? 18;
                  // Convert scientific notation to decimal string for parseUnits
                  const decimalStr = numeric.toFixed(20).replace(/\.?0+$/, ''); // Remove trailing zeros
                  weiBalanceStr = ethers.parseUnits(decimalStr, decimals).toString();
                } else if (typeof backendBalance === 'number') {
                  // Backend returned decimal number
                  numeric = backendBalance;
                  const decimals = token.decimals ?? 18;
                  weiBalanceStr = ethers.parseUnits(backendBalance.toString(), decimals).toString();
                } else {
                  // Backend returned wei string
                  const decimals = token.decimals ?? 18;
                  weiBalanceStr = backendBalance.toString();
                  try {
                    numeric = parseFloat(ethers.formatUnits(weiBalanceStr, decimals));
                  } catch (e) {
                    console.warn('[useBalances] Failed to parse refresh wei balance, using 0:', weiBalanceStr);
                    numeric = 0;
                  }
                }

                const tokenInfo = getTokenInfo(token.tokenAddress, chainId);
                return {
                  ...token,
                  address: token.tokenAddress,
                  tokenAddress: token.tokenAddress,
                  name: tokenInfo?.name || `${token.symbol} Token`,
                  numericBalance: numeric,
                  hasBalance: numeric > 0,
                  decimals: token.decimals ?? 18,
                  formattedBalance: Number(numeric).toFixed(6),
                  balance: weiBalanceStr, // Store as wei string for precision
                  balanceUSD: calculateUSDValue(numeric, token.symbol)
                };
              });
              setPrivateBalances(filterBalancesByUSDValue(privateWithUSD));
            } else {
              // No balances for this chain from backend; clear to avoid cross-chain carryover
              setPrivateBalances([]);
            }
          }
        }
      } catch (e) {
        console.warn('[useBalances] Private balances backend refresh failed:', e?.message);
      }

      console.log('[useBalances] ✅ Balances refreshed:', {
        public: publicBals.length,
        publicWithBalance: publicBals.filter(b => b.hasBalance).length
      });

    } catch (error) {
      console.error('[useBalances] Failed to refresh balances:', error);
      setError(error.message);
    } finally {
      setLoading(false);
      try { window.dispatchEvent(new CustomEvent('vault-balances-refresh-complete')); } catch {}
    }
  }, [address, chainId, fetchAndCachePrices, fetchPublicBalances]);

  // ONLY write to Redis after confirmed transactions
  const persistPrivateBalancesToWalletMetadata = async (walletAddress, railgunWalletId, privateBalances, chainId) => {
    if (!walletAddress || !railgunWalletId || !privateBalances.length) {
      console.warn('[useBalances] Skipping Redis write - missing data or empty balances');
      return;
    }
    
    try {
      // Get existing metadata to preserve non-balance fields
      let existingMetadata = {};
      try {
        const getResponse = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (getResponse.ok) {
          const result = await getResponse.json();
          if (result.success && result.keys && result.keys.length > 0) {
            const metadata = result.keys.find(k => k.walletId === railgunWalletId);
            if (metadata) {
              existingMetadata = {
                railgunAddress: metadata.railgunAddress,
                signature: metadata.signature,
                encryptedMnemonic: metadata.encryptedMnemonic
              };
            }
          }
        }
      } catch (error) {
        console.warn('[useBalances] Could not retrieve existing metadata:', error);
      }
      
      // Prepare balances for storage (use balance string to preserve precision for large amounts)
      const balancesToStore = privateBalances
        .filter(token => token.hasBalance && token.numericBalance > 0)
        .map(token => ({
          symbol: token.symbol,
          tokenAddress: token.address || token.tokenAddress,
          numericBalance: token.balance || token.numericBalance.toString(), // Store as string to preserve precision
          decimals: token.decimals,
          chainId: chainId,
          isPrivate: true,
          lastUpdated: token.lastUpdated || new Date().toISOString()
        }));
      
      // Store updated metadata
      const metadataToStore = {
        walletAddress,
        walletId: railgunWalletId,
        ...existingMetadata,
        privateBalances: balancesToStore,
        lastBalanceUpdate: new Date().toISOString()
      };
      
      console.log('[useBalances] 💾 Writing private balances to Redis:', {
        walletAddress: walletAddress.slice(0, 8) + '...',
        balanceCount: balancesToStore.length,
        tokens: balancesToStore.map(b => `${b.symbol}: ${b.numericBalance}`)
      });
      
      const response = await fetch('/api/wallet-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadataToStore)
      });
      
      if (!response.ok) {
        throw new Error(`Redis write failed: ${response.status}`);
      }
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(`Redis write failed: ${result.error}`);
      }
      
    } catch (error) {
      console.error('[useBalances] Failed to write private balances to Redis:', error);
      throw error;
    }
  };

  // Apply optimistic update for shield transactions (ONLY place that writes to Redis)
  const applyOptimisticShieldUpdate = async (tokenAddress, tokenSymbol, shieldedAmount, validatedDecimals) => {
    const { address: currentAddress, railgunWalletId: currentRailgunWalletId, chainId: currentChainId, publicBalances: currentPublicBalances, privateBalances: currentPrivateBalances } = stableRefs.current;
    
    // Convert display amount to base units using validated decimals, then back to display units
    const shieldedNumeric = parseFloat(shieldedAmount);
    const baseUnits = BigInt(Math.round(shieldedNumeric * Math.pow(10, validatedDecimals)));
    
    // Calculate RAILGUN fee (25 basis points = 0.25%) on base units
    const RAILGUN_FEE_BPS = 25n;
    const railgunFeeUnits = (baseUnits * RAILGUN_FEE_BPS) / 10000n;
    const actualPrivateUnits = baseUnits - railgunFeeUnits;
    
    // Convert back to display units using correct decimals
    const actualPrivateAmount = Number(actualPrivateUnits) / Math.pow(10, validatedDecimals);
    
    console.log('[Shield Debug] Applying optimistic update with validated decimals', { 
      tokenSymbol, 
      decimals: validatedDecimals, 
      amount: shieldedAmount,
      baseUnits: baseUnits.toString(),
      railgunFeeUnits: railgunFeeUnits.toString(),
      actualPrivateUnits: actualPrivateUnits.toString(),
      actualPrivateAmount: actualPrivateAmount,
      currentPublicCount: currentPublicBalances.length,
      currentPrivateCount: currentPrivateBalances.length
    });
    
    // Load existing private balances from Redis for accumulation
    let existingPrivateBalances = [];
    try {
      const getResponse = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(currentAddress)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (getResponse.ok) {
        const result = await getResponse.json();
        if (result.success && result.keys && result.keys.length > 0) {
          const metadata = result.keys.find(k => k.walletId === currentRailgunWalletId);
          if (metadata && metadata.privateBalances) {
            existingPrivateBalances = metadata.privateBalances;
          }
        }
      }
    } catch (error) {
      console.warn('[useBalances] Could not load existing balances for accumulation:', error);
    }
    
    // Find existing balance and calculate accumulated total
    const existingTokenBalance = existingPrivateBalances.find(token => {
      const addressMatch = token.tokenAddress?.toLowerCase() === tokenAddress?.toLowerCase();
      const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
      return addressMatch || symbolMatch;
    });
    
    const existingBalance = existingTokenBalance ? existingTokenBalance.numericBalance : 0;
    const accumulatedBalance = existingBalance + actualPrivateAmount;
    
    console.log('[useBalances] 📊 Balance accumulation:', {
      tokenSymbol,
      existingBalance,
      newAmount: actualPrivateAmount,
      accumulatedTotal: accumulatedBalance
    });
    
    // Update UI - public balances (decrease) using current values from stableRefs
    const updatedPublic = currentPublicBalances.map(token => {
      const isMatch = (token.address?.toLowerCase() === tokenAddress?.toLowerCase()) || 
                     (token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase());
      
      if (isMatch) {
        const newBalance = Math.max(0, token.numericBalance - shieldedNumeric);
        return {
          ...token,
          numericBalance: newBalance,
          hasBalance: newBalance > 0,
          balance: newBalance.toString(),
          formattedBalance: newBalance.toFixed(6)
        };
      }
      return token;
    });
    
    // Update UI - private balances (accumulated total) using current values from stableRefs
    let updatedPrivate = [...currentPrivateBalances];
    const currentUIIndex = updatedPrivate.findIndex(token => {
      const addressMatch = token.address?.toLowerCase() === tokenAddress?.toLowerCase();
      const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
      return addressMatch || symbolMatch;
    });
    
    if (currentUIIndex >= 0) {
      // Update existing token
      updatedPrivate[currentUIIndex] = {
        ...updatedPrivate[currentUIIndex],
        decimals: validatedDecimals, // Ensure decimals are correct
        numericBalance: accumulatedBalance,
        hasBalance: true,
        balance: accumulatedBalance.toString(),
        formattedBalance: accumulatedBalance.toFixed(6),
        lastUpdated: new Date().toISOString(),
        balanceUSD: calculateUSDValue(accumulatedBalance, updatedPrivate[currentUIIndex].symbol)
      };
    } else {
      // Create new token entry
      const publicToken = currentPublicBalances.find(token => {
        const addressMatch = token.address?.toLowerCase() === tokenAddress?.toLowerCase();
        const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
        return addressMatch || symbolMatch;
      });
      
      if (publicToken) {
        updatedPrivate.push({
          symbol: publicToken.symbol,
          address: publicToken.address,
          tokenAddress: publicToken.address,
          decimals: validatedDecimals,
          name: publicToken.name || `${publicToken.symbol} Token`,
          numericBalance: accumulatedBalance,
          balance: accumulatedBalance.toString(),
          formattedBalance: accumulatedBalance.toFixed(6),
          hasBalance: true,
          isPrivate: true,
          chainId: currentChainId,
          lastUpdated: new Date().toISOString(),
          balanceUSD: calculateUSDValue(accumulatedBalance, publicToken.symbol)
        });
      }
    }
    
    // Update UI immediately
    setPublicBalances(updatedPublic);
    setPrivateBalances(filterBalancesByUSDValue(updatedPrivate));
    setLastUpdated(new Date().toISOString());
    
    console.log('[useBalances] ⚡ Optimistic update applied to UI:', {
      updatedPublicCount: updatedPublic.length,
      updatedPrivateCount: updatedPrivate.length,
      publicWithBalance: updatedPublic.filter(t => t.hasBalance).length,
      privateWithBalance: updatedPrivate.filter(t => t.hasBalance).length
    });
    
    // Write to Redis in background (ONLY place that writes to Redis)
    persistPrivateBalancesToWalletMetadata(
      currentAddress, 
      currentRailgunWalletId, 
      updatedPrivate, 
      currentChainId
    ).then(() => {
      console.log('[useBalances] ✅ Private balances written to Redis (background)');
    }).catch((error) => {
      console.error('[useBalances] ❌ Failed to write private balances to Redis:', error);
    });
  };

  // Auto-fetch public balances on wallet connect (ONCE per connection)
  useEffect(() => {
    if (address && chainId && !hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      console.log('[useBalances] ✅ Running public balance refresh ONCE after connect');
      refreshAllBalances();
    } else if (!address) {
      // Reset flag when wallet disconnects so new connections can auto-refresh
      hasAutoRefreshed.current = false;
    }
  }, [address, chainId]);

  // Proactively refresh PUBLIC balances on chain switch to avoid stale dropdowns in Add tab
  useEffect(() => {
    if (!address || !chainId) {
      setPublicBalances([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        console.log('[useBalances] 🔁 Chain changed → refreshing public balances for chain', chainId);
        const freshPublicBalances = await fetchPublicBalances();
        if (cancelled) return;
        const publicWithUSD = freshPublicBalances.map(token => ({
          ...token,
          balanceUSD: calculateUSDValue(token.numericBalance, token.symbol)
        }));
        setPublicBalances(publicWithUSD);
        setLastUpdated(Date.now());
      } catch (e) {
        if (!cancelled) {
          console.warn('[useBalances] ⚠️ Public balance refresh on chain switch failed:', e?.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [chainId, address, fetchPublicBalances, calculateUSDValue]);

  // Reload private balances on chain switch; keep previous balances until new ones arrive
  useEffect(() => {
    if (!address || !railgunWalletId) return;
    setIsPrivateBalancesLoading(true);
    try { window.dispatchEvent(new CustomEvent('vault-private-refresh-start')); } catch {}
    // Clear immediately to avoid showing previous-chain balances
    setPrivateBalances([]);
    // Load for the active chain
    loadPrivateBalancesFromMetadata(address, railgunWalletId)
      .finally(() => {
        setIsPrivateBalancesLoading(false);
        try { window.dispatchEvent(new CustomEvent('vault-private-refresh-complete')); } catch {}
      });
  }, [chainId]);

  // Load private balances using SDK refresh when Railgun wallet is ready (same as refresh button)
  useEffect(() => {
    if (railgunWalletId && address && isRailgunInitialized && bootstrappedChains.has(chainId)) {
      console.log('[useBalances] 🛡️ Railgun wallet ready - triggering SDK balance refresh (like refresh button)...');
      setIsPrivateBalancesLoading(true);
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-start')); } catch {}

      // Use the same SDK refresh + persist logic as the refresh button
      (async () => {
        try {
          const { syncBalancesAfterTransaction } = await import('../utils/railgun/syncBalances.js');
          await syncBalancesAfterTransaction({
            walletAddress: address,
            walletId: railgunWalletId,
            chainId,
          });
          console.log('[useBalances] ✅ SDK balance refresh completed on wallet connect');
        } catch (error) {
          console.error('[useBalances] ❌ SDK balance refresh failed on wallet connect:', error.message);
        } finally {
          setIsPrivateBalancesLoading(false);
          try { window.dispatchEvent(new CustomEvent('vault-private-refresh-complete')); } catch {}
        }
      })();
    }
  }, [railgunWalletId, address, isRailgunInitialized, chainId, bootstrappedChains]);

  // Listen for chain bootstrap completion to sequence balance refresh
  useEffect(() => {
    const handleChainBootstrapComplete = (event) => {
      const { chainId: bootstrappedChainId } = event.detail || {};
      if (bootstrappedChainId) {
        console.log('[useBalances] ✅ Chain bootstrap completed:', bootstrappedChainId);
        setBootstrappedChains(prev => new Set([...prev, bootstrappedChainId]));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('chain-bootstrap-complete', handleChainBootstrapComplete);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('chain-bootstrap-complete', handleChainBootstrapComplete);
      }
    };
  }, []);

  // Listen for Railgun SDK balance updates (real-time balance updates from SDK callbacks)
  useEffect(() => {
    const handleRailgunBalanceUpdate = (event) => {
      const balanceEvent = event.detail;
      const { address: currentAddress, railgunWalletId: currentWalletId, chainId: currentChainId } = stableRefs.current;
      
      // Only process updates for our wallet and chain
      if (balanceEvent.railgunWalletID === currentWalletId && 
          balanceEvent.chain?.id === currentChainId && 
          currentAddress) {
        
        console.log('[useBalances] 🎯 Railgun SDK balance update received:', {
          walletId: currentWalletId?.slice(0, 8) + '...',
          bucket: balanceEvent.balanceBucket,
          erc20Count: balanceEvent.erc20Amounts?.length || 0,
          chainId: currentChainId
        });
        
        // Convert SDK balance format to our UI format
        if (balanceEvent.erc20Amounts && balanceEvent.erc20Amounts.length > 0) {
          const updatedPrivateBalances = balanceEvent.erc20Amounts.map(token => {
            const tokenInfo = getTokenInfo(token.tokenAddress, currentChainId);
            // Handle the case where getTokenInfo might fail - use fallback token data
            const symbol = tokenInfo?.symbol || `TOKEN_${token.tokenAddress?.slice(-6)}` || 'UNKNOWN';
            const decimals = tokenInfo?.decimals || 18;
            const balanceStr = token.amount?.toString() || '0';

            // Convert wei amount to decimal without precision loss
            let numericBalance;
            try {
              numericBalance = parseFloat(ethers.formatUnits(balanceStr, decimals));
            } catch (e) {
              console.warn('[useBalances] Failed to parse SDK balance, using 0:', balanceStr);
              numericBalance = 0;
            }

            console.log('[useBalances] 🔍 Processing token from SDK:', {
              tokenAddress: token.tokenAddress,
              amount: token.amount,
              balanceStr,
              tokenInfo: tokenInfo,
              symbol,
              decimals,
              numericBalance,
              hasBalance: numericBalance > 0
            });

            return {
              symbol,
              address: token.tokenAddress,
              balance: balanceStr, // Store precise wei amount as string
              numericBalance,
              decimals,
              hasBalance: numericBalance > 0,
              formattedBalance: Number.isFinite(numericBalance) ? numericBalance.toFixed(6) : '0.000000',
              balanceUSD: calculateUSDValue(numericBalance, symbol),
              type: 'private'
            };
          });
          
          console.log('[useBalances] 🔄 Updating private balances from SDK callback:', {
            rawBalances: balanceEvent.erc20Amounts.map(t => ({ address: t.tokenAddress, amount: t.amount })),
            processedTokens: updatedPrivateBalances.map(t => ({ symbol: t.symbol, numericBalance: t.numericBalance, hasBalance: t.hasBalance })),
            tokensWithBalance: updatedPrivateBalances.filter(t => t.hasBalance).length,
            bucket: balanceEvent.balanceBucket
          });
          
          // Only update state for Spendable bucket (most important for UI)
          if (balanceEvent.balanceBucket === 'Spendable') {
            setPrivateBalances(filterBalancesByUSDValue(updatedPrivateBalances));
            lastSpendableUpdateRef.current = Date.now();

            // IMPORTANT: Do not write SDK callback balances to Redis.
            // The transaction monitor is the single source of truth and will
            // persist confirmed balances after Graph confirmation, then the
            // UI refreshes from Redis via the transaction-confirmed handler.
          } else {
            console.log('[useBalances] ℹ️ Ignoring non-spendable bucket update:', balanceEvent.balanceBucket);
          }
        } else {
          console.log('[useBalances] ℹ️ No ERC20 amounts in balance update:', {
            erc20Count: balanceEvent.erc20Amounts?.length || 0,
            bucket: balanceEvent.balanceBucket
          });
        }
      }
    };
    
    window.addEventListener('railgun-balance-update', handleRailgunBalanceUpdate);
    return () => {
      window.removeEventListener('railgun-balance-update', handleRailgunBalanceUpdate);
    };
  }, [calculateUSDValue]);

  // Optimistic UI update for unshield/send: decrement private balance immediately
  useEffect(() => {
    const onOptimisticUnshield = (event) => {
      try {
        const detail = event?.detail || {};
        const tokenAddress = String((detail.tokenAddress || '').toLowerCase());
        const tokenSymbol = detail.tokenSymbol;
        const amountDec = Number(detail.amount || 0);
        if (!amountDec || amountDec <= 0) return;

        setPrivateBalances((current) => {
          if (!Array.isArray(current) || current.length === 0) return current;
          const updated = current.map((tok) => {
            const tokKey = String((tok.address || tok.tokenAddress || '').toLowerCase());
            const isMatch = (tokenAddress && tokKey === tokenAddress) || (!tokenAddress && tokenSymbol && tok.symbol === tokenSymbol);
            if (!isMatch) return tok;
            const currentNumeric = Number(tok.numericBalance || 0);
            const nextNumeric = Math.max(0, currentNumeric - amountDec);
            return {
              ...tok,
              numericBalance: nextNumeric,
              balance: String(nextNumeric),
              hasBalance: nextNumeric > 0,
              formattedBalance: Number.isFinite(nextNumeric) ? nextNumeric.toFixed(6) : tok.formattedBalance,
              balanceUSD: calculateUSDValue(nextNumeric, tok.symbol)
            };
          });
          return filterBalancesByUSDValue(updated);
        });
      } catch (e) {
        console.warn('[useBalances] ⚠️ Optimistic unshield update failed:', e?.message || e);
      }
    };

    window.addEventListener('railgun-optimistic-unshield', onOptimisticUnshield);
    return () => window.removeEventListener('railgun-optimistic-unshield', onOptimisticUnshield);
  }, [calculateUSDValue]);

  // Listen for transaction confirmations (auto-refresh UI after confirmed transactions)
  useEffect(() => {
    const handleTransactionConfirmed = async (event) => {
      const { chainId: currentChainId, railgunWalletId: currentWalletId } = stableRefs.current;
      
      console.log('[useBalances] 🎯 Transaction confirmed:', {
        txHash: event.detail?.txHash,
        chainId: event.detail?.chainId,
        transactionType: event.detail?.transactionType,
        amount: event.detail?.amount,
        tokenSymbol: event.detail?.tokenSymbol
      });
      
      // Auto-refresh UI after confirmed transactions for good UX
      if (event.detail?.chainId === currentChainId && currentWalletId) {
        try { window.dispatchEvent(new CustomEvent('vault-balances-refresh-start')); } catch {}
        const { transactionType, amount, tokenAddress, tokenSymbol } = event.detail;
        const currentWalletAddress = stableRefs.current.address;
        
        if (transactionType === 'shield' && amount && tokenAddress && tokenSymbol) {
          console.log('[useBalances] 🛡️ Shield confirmed - refreshing balances from Redis...');
          try {
            // Just refresh private balances from Redis (where transaction monitor already saved the correct balance)
            await loadPrivateBalancesFromMetadata(currentWalletAddress, currentWalletId);
            console.log('[useBalances] ✅ Private balances refreshed from Redis after shield');
            
            // Also refresh public balances from blockchain now that transaction is indexed
            console.log('[useBalances] 🔄 Refreshing public balances from blockchain...');
            const freshPublicBalances = await fetchPublicBalances();
            const publicWithUSD = freshPublicBalances.map(token => ({
              ...token,
              balanceUSD: calculateUSDValue(token.numericBalance, token.symbol)
            }));
            setPublicBalances(publicWithUSD);
            console.log('[useBalances] ✅ Public balances refreshed after transaction');
            
          } catch (error) {
            console.error('[useBalances] Failed to refresh balances after shield:', error);
          }
        } else if ((transactionType === 'unshield' || transactionType === 'transfer') && currentWalletId) {
          console.log('[useBalances] 🔓 Handling unshield/transfer confirmation - refreshing private balances...');
          try {
            // Call the balances endpoint to get updated notes and balances
            const response = await fetch(`/api/wallet-metadata?action=balances&walletAddress=${currentWalletAddress}&walletId=${currentWalletId}`);
            if (response.ok) {
              const result = await response.json();
              if (result.success && result.balances) {
                console.log('[useBalances] ✅ Updated private balances from note tracking:', {
                  tokenCount: result.balances.balances?.length || 0,
                  totalNotes: result.balances.balances?.reduce((sum, token) => sum + (token.notes?.length || 0), 0) || 0
                });
                
                // If a Spendable update just occurred, avoid overwriting it with potentially stale backend data
                const elapsedSinceSpendable = Date.now() - lastSpendableUpdateRef.current;
                const recentSpendable = elapsedSinceSpendable < 60000; // 60s window
                
                const backendList = result.balances.balances || [];
                const backendMap = new Map(backendList.map(t => [String((t.tokenAddress || '').toLowerCase()), t]));

                // Merge with current UI state, biasing toward the most conservative (lower) spendable to avoid overstatement
                let balancesToPersist = null;
                setPrivateBalances(current => {
                  let updatedBalances;
                  if (!current || current.length === 0) {
                    const fromBackend = backendList.map(token => {
                      // Handle backend balance - backend returns decimal amounts, convert to wei for consistency
                      const backendBalance = token.numericBalance || 0;
                      let numeric, weiBalanceStr;

                      if (typeof backendBalance === 'string' && (backendBalance.includes('.') || backendBalance.includes('e'))) {
                        // Backend returned decimal string (possibly scientific notation) - convert to numeric then to wei
                        numeric = Number(backendBalance);
                        const decimals = token.decimals ?? 18;
                        // Convert scientific notation to decimal string for parseUnits
                        const decimalStr = numeric.toFixed(20).replace(/\.?0+$/, ''); // Remove trailing zeros
                        weiBalanceStr = ethers.parseUnits(decimalStr, decimals).toString();
                      } else if (typeof backendBalance === 'number') {
                        // Backend returned decimal number - convert to wei
                        numeric = backendBalance;
                        const decimals = token.decimals ?? 18;
                        weiBalanceStr = ethers.parseUnits(backendBalance.toString(), decimals).toString();
                      } else {
                        // Backend returned wei string - convert to decimal
                        const decimals = token.decimals ?? 18;
                        weiBalanceStr = backendBalance.toString();
                        try {
                          numeric = parseFloat(ethers.formatUnits(weiBalanceStr, decimals));
                        } catch (e) {
                          console.warn('[useBalances] Failed to parse backend wei balance, using 0:', weiBalanceStr);
                          numeric = 0;
                        }
                      }

                      return {
                        ...token,
                        address: token.tokenAddress,
                        tokenAddress: token.tokenAddress,
                        numericBalance: numeric,
                        hasBalance: numeric > 0,
                        decimals: token.decimals ?? 18,
                        formattedBalance: Number(numeric).toFixed(6),
                        balance: weiBalanceStr, // Store as wei string for precision
                        balanceUSD: calculateUSDValue(numeric, token.symbol)
                      };
                    });
                    updatedBalances = recentSpendable ? current : fromBackend;
                  } else {
                    const merged = current.map(tok => {
                      const key = String((tok.address || tok.tokenAddress || '').toLowerCase());
                      const b = backendMap.get(key);
                     if (!b) return tok; // keep current when backend missing
                      // Compare balances as BigInts for precision
                      const currentBalance = BigInt(tok.balance || '0');
                      const backendBalanceStr = String(b.numericBalance || '0');
                      let backendBalance;
                      if (backendBalanceStr.includes('.')) {
                        // Decimal - convert to wei for comparison
                        const decimals = tok.decimals ?? 18;
                        backendBalance = BigInt(Math.floor(Number(backendBalanceStr) * 10**decimals));
                      } else {
                        backendBalance = BigInt(backendBalanceStr);
                      }
                      const minBalance = currentBalance < backendBalance ? currentBalance : backendBalance;

                      // Convert back to decimal for UI
                      const decimals = tok.decimals ?? 18;
                      const numeric = parseFloat(ethers.formatUnits(minBalance.toString(), decimals));

                      return {
                        ...tok,
                        numericBalance: numeric,
                        balance: minBalance.toString(),
                        formattedBalance: Number.isFinite(numeric) ? Number(numeric).toFixed(6) : tok.formattedBalance,
                        balanceUSD: calculateUSDValue(numeric, tok.symbol)
                      };
                    });
                    // Also include any backend tokens not present in current (e.g., new dust asset symbols)
                    const currentKeys = new Set(merged.map(t => String((t.address || t.tokenAddress || '').toLowerCase())));
                     backendList.forEach(b => {
                      const key = String((b.tokenAddress || '').toLowerCase());
                      if (!currentKeys.has(key)) {
                        // Handle new backend balance - convert to wei for consistency
                        const backendBalance = b.numericBalance || 0;
                        let numeric, weiBalanceStr;

                        if (typeof backendBalance === 'string' && (backendBalance.includes('.') || backendBalance.includes('e'))) {
                          // Backend returned decimal string (possibly scientific notation)
                          numeric = Number(backendBalance);
                          const decimals = b.decimals ?? 18;
                          // Convert scientific notation to decimal string for parseUnits
                          const decimalStr = numeric.toFixed(20).replace(/\.?0+$/, ''); // Remove trailing zeros
                          weiBalanceStr = ethers.parseUnits(decimalStr, decimals).toString();
                        } else if (typeof backendBalance === 'number') {
                          // Backend returned decimal number
                          numeric = backendBalance;
                          const decimals = b.decimals ?? 18;
                          weiBalanceStr = ethers.parseUnits(backendBalance.toString(), decimals).toString();
                        } else {
                          // Backend returned wei string
                          const decimals = b.decimals ?? 18;
                          weiBalanceStr = backendBalance.toString();
                          try {
                            numeric = parseFloat(ethers.formatUnits(weiBalanceStr, decimals));
                          } catch (e) {
                            console.warn('[useBalances] Failed to parse new backend wei balance, using 0:', weiBalanceStr);
                            numeric = 0;
                          }
                        }

                        merged.push({
                          ...b,
                          address: b.tokenAddress,
                          tokenAddress: b.tokenAddress,
                          numericBalance: numeric,
                          hasBalance: numeric > 0,
                          decimals: b.decimals ?? 18,
                          formattedBalance: Number(numeric).toFixed(6),
                          balance: weiBalanceStr, // Store as wei string for precision
                          balanceUSD: calculateUSDValue(numeric, b.symbol)
                        });
                      }
                    });
                    updatedBalances = recentSpendable ? current : merged;
                  }

                  // Store balances for persistence (only if they were updated)
                  if (!recentSpendable && updatedBalances && updatedBalances.length > 0) {
                    balancesToPersist = updatedBalances;
                  }

                  return filterBalancesByUSDValue(updatedBalances);
                });

                // Persist the updated balances to Redis (with wei strings for precision)
                // This ensures future loads get the correct balances, not corrupted decimal versions
                if (balancesToPersist) {
                  console.log('[useBalances] 💾 Persisting updated balances to Redis after transaction confirmation...');
                  persistPrivateBalancesToWalletMetadata(
                    currentWalletAddress,
                    currentWalletId,
                    balancesToPersist,
                    currentChainId
                  ).catch(error => {
                    console.error('[useBalances] Failed to persist balances after transaction:', error);
                  });
                }

                // Also refresh public balances
                const freshPublicBalances = await fetchPublicBalances();
                const publicWithUSD = freshPublicBalances.map(token => ({
                  ...token,
                  balanceUSD: calculateUSDValue(token.numericBalance, token.symbol)
                }));
                setPublicBalances(publicWithUSD);

                console.log('[useBalances] ✅ All balances refreshed and persisted after unshield/transfer confirmation');
              }
            } else {
              const errorText = await response.text();
              console.warn('[useBalances] ⚠️ Failed to fetch updated balances from note tracking:', {
                status: response.status,
                error: errorText
              });
            }
          } catch (error) {
            console.error('[useBalances] Failed to update balances after unshield/transfer:', error);
          }
        }
        try { window.dispatchEvent(new CustomEvent('vault-balances-refresh-complete')); } catch {}
      }
    };

    window.addEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    return () => {
      window.removeEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    };
  }, []);

  // Listen for explicit public refresh trigger (after SDK persist completes)
  useEffect(() => {
    const onPublicRefresh = async () => {
      try {
        const freshPublicBalances = await fetchPublicBalances();
        const publicWithUSD = freshPublicBalances.map(token => ({
          ...token,
          balanceUSD: calculateUSDValue(token.numericBalance, token.symbol)
        }));
        setPublicBalances(publicWithUSD);
        console.log('[useBalances] ✅ Public balances refreshed (event)');
      } catch (e) {
        console.warn('[useBalances] ⚠️ Public refresh failed:', e?.message);
      }
    };
    window.addEventListener('railgun-public-refresh', onPublicRefresh);
    return () => window.removeEventListener('railgun-public-refresh', onPublicRefresh);
  }, [fetchPublicBalances, calculateUSDValue]);

  return {
    // Balance data
    publicBalances,
    privateBalances,
    
    // State
    loading,
    lastUpdated,
    lastUpdateTime: lastUpdated,
    error,
    
    // Functions
    refreshAllBalances,
    loadPrivateBalancesFromMetadata,
    formatBalance,
    
    // Utilities
    hasPublicBalances: publicBalances.length > 0,
    hasPrivateBalances: privateBalances.length > 0,
    totalPublicTokens: publicBalances.filter(token => token.hasBalance).length,
    totalPrivateTokens: privateBalances.length,
    isPrivateBalancesLoading,
  };
}

export default useBalances; 