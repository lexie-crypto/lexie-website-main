/**
 * useBalances Hook - PRODUCTION READY WITH UI SYNC FIX
 * Manages public and private token balances with real blockchain data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, formatUnits, Contract } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getPrivateBalances, getPrivateBalancesFromCache, refreshPrivateBalances } from '../utils/railgun/balances';
import { debugBalanceCache, testCachePersistence } from '../utils/railgun/cache-debug';
import { fetchTokenPrices } from '../utils/pricing/coinGecko';
import { RPC_URLS } from '../config/environment';

// Network mapping for UI display  
const NETWORK_MAPPING = {
  1: 'Ethereum',
  42161: 'Arbitrum',
  137: 'Polygon',
  56: 'BNBChain',
};

// ERC20 ABI for balance checking
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

// Common token addresses by chain
const TOKEN_LISTS = {
  1: [ // Ethereum
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  42161: [ // Arbitrum
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  ],
  137: [ // Polygon
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', name: 'USD Coin (PoS)', decimals: 6 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin (PoS)', decimals: 18 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD (PoS)', decimals: 6 },
  ],
  56: [ // BSC
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
    { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Token', decimals: 18 },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
  ],
};

// Chain ID to RPC URL mapping using environment configuration
const CHAIN_RPC_MAPPING = {
  1: RPC_URLS.ethereum,
  42161: RPC_URLS.arbitrum,
  137: RPC_URLS.polygon,
  56: RPC_URLS.bsc,
};

export function useBalances() {
  const { address, chainId, railgunWalletId, isRailgunInitialized, railgunAddress } = useWallet();
  const [publicBalances, setPublicBalances] = useState([]);
  const [privateBalances, setPrivateBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tokenPrices, setTokenPrices] = useState({});
  
  // 🔍 DEBUG: Log wallet state changes to understand the issue
  useEffect(() => {
    console.log('[useBalances] 🔍 WALLET STATE DEBUG:', {
      address: address?.slice(0, 8) + '...' || 'null',
      chainId,
      railgunWalletId: railgunWalletId?.slice(0, 8) + '...' || 'null',
      isRailgunInitialized,
      railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null',
      timestamp: new Date().toISOString()
    });
  }, [address, chainId, railgunWalletId, isRailgunInitialized, railgunAddress]);
  
  // 🛑 CRITICAL: Add a disabled state to completely stop all balance operations when wallet disconnected
  const [isBalanceSystemEnabled, setIsBalanceSystemEnabled] = useState(false);
  
  // Force re-render counter to fix UI desync issues - FIXED: Make more stable
  const [, forceUpdate] = useState({});
  const forceRerender = useCallback(() => {
    console.log('[useBalances] 🔄 Force re-render triggered');
    forceUpdate({});
  }, []); // Empty dependency array to make it stable
  
  // 🛑 CRITICAL: Master switch to enable/disable balance system based on wallet connection
  useEffect(() => {
    const shouldBeEnabled = !!(address && chainId);
    
    if (shouldBeEnabled !== isBalanceSystemEnabled) {
      if (shouldBeEnabled) {
        console.log('[useBalances] 🟢 ENABLING balance system - wallet connected:', {
          address: address?.slice(0, 8) + '...',
          chainId,
          railgunReady: isRailgunInitialized && !!railgunWalletId
        });
        setIsBalanceSystemEnabled(true);
      } else {
        console.log('[useBalances] 🔴 DISABLING balance system - wallet disconnected');
        setIsBalanceSystemEnabled(false);
        
        // 🧹 AGGRESSIVE CLEANUP when disabling
        setPublicBalances([]);
        setPrivateBalances([]);
        setLastUpdated(null);
        setError(null);
        setLoading(false);
        setTokenPrices({});
        
        // Clear global balance exposure
        if (typeof window !== 'undefined') {
          window.__LEXIE_BALANCES__ = [];
        }
      }
    }
  }, [address, chainId, isBalanceSystemEnabled, isRailgunInitialized, railgunWalletId]);
  
  // Stable reference for setter functions
  const setPrivateBalancesRef = useRef(setPrivateBalances);
  setPrivateBalancesRef.current = setPrivateBalances;

  // Enhanced balance setter with force re-render - FIXED: More stable dependencies
  const updatePrivateBalances = useCallback((newBalances) => {
    console.log('[useBalances] 🔄 Updating private balances with force re-render:', {
      count: newBalances?.length || 0,
      tokens: newBalances?.map(b => `${b.symbol}: ${b.formattedBalance}`) || []
    });
    
    // Ensure we create a completely new array to trigger React updates
    const freshBalances = Array.isArray(newBalances) 
      ? newBalances.map((balance, index) => ({
          ...balance,
          // Add unique ID for React keys to prevent rendering issues
          _id: `${balance.tokenAddress || 'native'}-${balance.symbol}-${index}`,
          _timestamp: Date.now()
        }))
      : [];
    
    setPrivateBalances(freshBalances);
    setLastUpdated(Date.now());
    
    // Force a re-render to ensure UI updates
    forceRerender();
  }, []); // Empty dependency array - use the stable forceRerender

  // Register global hook reference for direct UI updates from balance callbacks - CRITICAL: Only when system enabled
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (isBalanceSystemEnabled) {
        console.log('[useBalances] 🔗 Registering enhanced global hook reference for direct UI updates');
        window.__LEXIE_HOOKS__ = {
          ...window.__LEXIE_HOOKS__,
          setPrivateBalances: updatePrivateBalances,
          forceRerender,
        };
      } else {
        console.log('[useBalances] 🔗 Cleaning up global hook reference - system disabled');
        if (window.__LEXIE_HOOKS__?.setPrivateBalances === updatePrivateBalances) {
          delete window.__LEXIE_HOOKS__.setPrivateBalances;
          delete window.__LEXIE_HOOKS__.forceRerender;
        }
      }
      
      // Cleanup on unmount
      return () => {
        if (window.__LEXIE_HOOKS__?.setPrivateBalances === updatePrivateBalances) {
          delete window.__LEXIE_HOOKS__.setPrivateBalances;
          delete window.__LEXIE_HOOKS__.forceRerender;
          console.log('[useBalances] 🔗 Cleaned up enhanced global hook reference on unmount');
        }
      };
    }
  }, [isBalanceSystemEnabled, updatePrivateBalances, forceRerender]); // Added system enabled dependency

  // Load cached private balances immediately on mount - CRITICAL: Only when system enabled
  useEffect(() => {
    // 🛑 CRITICAL: Only load cache when balance system is enabled AND RAILGUN fully ready
    if (isBalanceSystemEnabled && railgunWalletId && chainId && address && isRailgunInitialized) {
      console.log('[useBalances] 🚀 Loading cached private balances for enabled system...', {
        address: address?.slice(0, 8) + '...',
        walletId: railgunWalletId?.slice(0, 8) + '...',
        systemEnabled: isBalanceSystemEnabled,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
      
      // Test cache persistence first - only when we have a wallet
      try {
        const persistenceTest = testCachePersistence();
        console.log('[useBalances] Cache persistence test result:', persistenceTest);
        
        // Debug current cache state
        debugBalanceCache('useBalances mount');
      } catch (error) {
        console.warn('[useBalances] Cache debug functions failed (non-critical):', error);
      }
      
      const cachedPrivateBalances = getPrivateBalancesFromCache(railgunWalletId, chainId);
      
      if (cachedPrivateBalances.length > 0) {
        console.log('[useBalances] ✅ Found cached private balances, loading immediately:', {
          count: cachedPrivateBalances.length,
          tokens: cachedPrivateBalances.map(b => `${b.symbol}: ${b.formattedBalance}`)
        });
        updatePrivateBalances(cachedPrivateBalances);
      } else {
        console.log('[useBalances] No cached private balances found for enabled system');
        try {
          debugBalanceCache('after failed cache load');
        } catch (error) {
          console.warn('[useBalances] Debug cache function failed (non-critical):', error);
        }
      }
    } else {
      console.log('[useBalances] ⏸️ Cache load blocked - waiting for RAILGUN:', {
        systemEnabled: isBalanceSystemEnabled,
        hasWallet: !!railgunWalletId,
        walletIdValue: railgunWalletId?.slice(0, 8) + '...' || 'null',
        hasChain: !!chainId,
        hasAddress: !!address,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
    }
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, address, isRailgunInitialized, railgunAddress, updatePrivateBalances]); // Added system enabled check

  // Fetch and cache token prices
  const fetchAndCachePrices = useCallback(async (symbols) => {
    try {
      const uniqueSymbols = [...new Set(symbols)];
      const prices = await fetchTokenPrices(uniqueSymbols);
      
      setTokenPrices(prev => ({
        ...prev,
        ...prices
      }));
      
      console.log('[useBalances] Fetched fresh prices:', prices);
      return prices;
    } catch (error) {
      console.error('[useBalances] Failed to fetch token prices:', error);
      return {};
    }
  }, []);

  // Calculate USD value for a balance
  const calculateUSDValue = useCallback((numericBalance, symbol) => {
    const price = tokenPrices[symbol];
    console.log(`[useBalances] Calculating USD for ${symbol}:`, { numericBalance, price, tokenPrices });
    if (price && typeof price === 'number' && numericBalance > 0) {
      const usdValue = (numericBalance * price).toFixed(2);
      console.log(`[useBalances] USD calculation result: ${symbol} = $${usdValue}`);
      return usdValue;
    }
    console.log(`[useBalances] USD calculation failed for ${symbol}: price=${price}, numericBalance=${numericBalance}`);
    return '0.00';
  }, [tokenPrices]);

  // Get RPC provider for specific chain
  const getProvider = useCallback((targetChainId) => {
    const rpcUrl = CHAIN_RPC_MAPPING[targetChainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${targetChainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl);
  }, []); // Remove chainId dependency since it's not used in the function

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
      const provider = getProvider(targetChainId);
      const contract = new Contract(tokenInfo.address, ERC20_ABI, provider);
      
      const [balance, decimals, symbol, name] = await Promise.all([
        contract.balanceOf(userAddress),
        contract.decimals().catch(() => tokenInfo.decimals),
        Promise.resolve(tokenInfo.symbol),
        contract.name().catch(() => tokenInfo.name),
      ]);

      const formattedBalance = formatUnits(balance, decimals);
      const numericBalance = parseFloat(formattedBalance);

      return {
        address: tokenInfo.address,
        symbol: symbol,
        name: name,
        decimals: Number(decimals),
        balance: balance.toString(),
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

  // Fetch all public balances - CRITICAL: Check if balance system is enabled
  const fetchPublicBalances = useCallback(async () => {
    // 🛑 CRITICAL: Prevent RPC calls when balance system is disabled
    if (!isBalanceSystemEnabled || !address || !chainId) {
      console.log('[useBalances] ⏸️ Public balance fetch blocked - system disabled or wallet disconnected');
      return [];
    }

    try {
      console.log('[useBalances] Fetching public balances for chain:', chainId);
      
      // Clear previous error
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

      console.log('[useBalances] Fetched public balances:', {
        total: balances.length,
        withBalance: balances.filter(b => b.hasBalance).length,
      });

      return balances;
    } catch (error) {
      console.error('[useBalances] Failed to fetch public balances:', error);
      setError(error.message);
      return [];
    }
  }, [isBalanceSystemEnabled, address, chainId, fetchNativeBalance, fetchTokenBalance]);

  // Fetch private balances using Railgun - CRITICAL: Only when wallet connected AND system enabled
  const fetchPrivateBalances = useCallback(async () => {
    // 🛑 CRITICAL: Prevent RAILGUN RPC calls when balance system disabled or wallet disconnected
    if (!isBalanceSystemEnabled || !railgunWalletId || !chainId || !address || !isRailgunInitialized) {
      console.log('[useBalances] ⏸️ Private balance fetch blocked:', {
        systemEnabled: isBalanceSystemEnabled,
        hasWalletId: !!railgunWalletId,
        walletIdValue: railgunWalletId?.slice(0, 8) + '...' || 'null',
        hasChainId: !!chainId,
        hasAddress: !!address,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
      return [];
    }

    try {
      console.log('[useBalances] Fetching private balances...');
      // Clear previous error
      setError(null);
      
      const balances = await getPrivateBalances(railgunWalletId, chainId);
      return balances;
    } catch (error) {
      console.error('[useBalances] Failed to fetch private balances:', error);
      setError(error.message);
      return [];
    }
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, address, isRailgunInitialized, railgunAddress]);

  // Refresh all balances - CRITICAL: Check if balance system is enabled
  const refreshAllBalances = useCallback(async () => {
    // 🛑 CRITICAL: Prevent all balance operations when system is disabled
    if (!isBalanceSystemEnabled || !address) {
      console.log('[useBalances] ⏸️ Balance refresh blocked - system disabled or no wallet');
      return;
    }

    setLoading(true);
    try {
      console.log('[useBalances] Refreshing all balances...');

      // Fetch prices first and get them directly
      const allSymbols = [
        ...new Set([
          ...(TOKEN_LISTS[chainId] || []).map(t => t.symbol),
          'ETH', 'MATIC', 'BNB', // Native tokens
        ])
      ];
      const freshPrices = await fetchAndCachePrices(allSymbols);

      // Fetch public and private balances in parallel
      const [publicBals, privateBals] = await Promise.all([
        fetchPublicBalances(),
        fetchPrivateBalances(),
      ]);

      // Add USD values using fresh prices directly
      const calculateUSD = (numericBalance, symbol) => {
        const price = freshPrices[symbol] || tokenPrices[symbol];
        if (price && typeof price === 'number' && numericBalance > 0) {
          return (numericBalance * price).toFixed(2);
        }
        return '0.00';
      };

      const publicWithUSD = publicBals.map(token => ({
        ...token,
        balanceUSD: calculateUSD(token.numericBalance, token.symbol)
      }));

      const privateWithUSD = privateBals.map(token => ({
        ...token,
        balanceUSD: calculateUSD(token.numericBalance, token.symbol)
      }));

      setPublicBalances(publicWithUSD);
      updatePrivateBalances(privateWithUSD);
      setLastUpdated(Date.now());
      
      // Expose balances globally for balance checking
      window.__LEXIE_BALANCES__ = publicWithUSD;

      console.log('[useBalances] Balances refreshed:', {
        public: publicBals.length,
        publicWithBalance: publicBals.filter(b => b.hasBalance).length,
        private: privateBals.length,
        privateWithBalance: privateBals.filter(b => b.hasBalance).length,
      });

    } catch (error) {
      console.error('[useBalances] Failed to refresh balances:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [isBalanceSystemEnabled, address, chainId]); // Added isBalanceSystemEnabled to prevent calls when disabled

  // Refresh balances after transactions - CRITICAL: Only when system enabled
  const refreshBalancesAfterTransaction = useCallback(async () => {
    // 🛑 CRITICAL: Prevent post-transaction refresh when system is disabled
    if (!isBalanceSystemEnabled) {
      console.log('[useBalances] ⏸️ Post-transaction refresh blocked - balance system disabled');
      return;
    }
    
    console.log('[useBalances] 🔄 Enhanced post-transaction balance refresh...');
    
    // Multiple refresh attempts to catch new transactions
    const maxAttempts = 3;
    const delays = [5000, 10000, 15000]; // 5s, 10s, 15s
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`[useBalances] 🔄 Refresh attempt ${attempt + 1}/${maxAttempts}`);
      
      // Wait progressively longer
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      
      // 🔁 CRITICAL: Force complete RAILGUN rescan BEFORE each refresh attempt
      if (railgunWalletId && chainId) {
        try {
          console.log('[useBalances] 🎯 Forcing complete RAILGUN rescan...');
          const { clearStaleBalanceCacheAndRefresh } = await import('../utils/railgun/balances');
          await clearStaleBalanceCacheAndRefresh(railgunWalletId, chainId);
        } catch (error) {
          console.warn('[useBalances] Rescan failed, falling back to regular refresh:', error);
        }
      }
      
      // Regular balance refresh (now with fresh UTXO data)
      await refreshAllBalances();
      
      console.log(`[useBalances] ✅ Refresh attempt ${attempt + 1} completed`);
    }
    
    console.log('[useBalances] 🎉 Enhanced post-transaction refresh completed');
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, refreshAllBalances]); // Added refreshAllBalances dependency

  // Format balance for display
  const formatBalance = useCallback((balance, decimals = 2) => {
    if (typeof balance !== 'number') {
      return '0.00';
    }

    if (balance === 0) {
      return '0.00';
    }

    if (balance < 0.001) {
      return '<0.001';
    }

    if (balance < 1) {
      return balance.toFixed(Math.min(decimals + 2, 6));
    }

    return balance.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }, []);

  // Initial load when wallet connects - CRITICAL: Only when system is enabled
  useEffect(() => {
    // 🛑 CRITICAL: Only fetch when balance system is enabled AND wallet connected
    if (isBalanceSystemEnabled && address && chainId) {
      console.log('[useBalances] 🚀 Balance system enabled - fetching balances:', { 
        address: address?.slice(0, 8) + '...', 
        chainId,
        systemEnabled: isBalanceSystemEnabled
      });
      refreshAllBalances();
    } else {
      console.log('[useBalances] ⏸️ Balance fetching blocked:', {
        systemEnabled: isBalanceSystemEnabled,
        hasAddress: !!address,
        hasChainId: !!chainId
      });
    }
  }, [isBalanceSystemEnabled, address, chainId, refreshAllBalances]); // Added refreshAllBalances back since we need stable dependencies

  // Refresh private balances when Railgun wallet changes - CRITICAL: Only when system enabled
  useEffect(() => {
    // 🛑 CRITICAL: Only fetch when balance system is enabled AND RAILGUN fully ready
    if (isBalanceSystemEnabled && railgunWalletId && chainId && address && isRailgunInitialized) {
      console.log('[useBalances] 🔐 RAILGUN wallet available - fetching private balances:', { 
        walletId: railgunWalletId?.slice(0, 8) + '...', 
        chainId, 
        address: address?.slice(0, 8) + '...',
        systemEnabled: isBalanceSystemEnabled,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
      fetchPrivateBalances().then(balances => {
        updatePrivateBalances(balances);
      });
    } else {
      console.log('[useBalances] ⏸️ Private balance fetch blocked - waiting for RAILGUN:', {
        systemEnabled: isBalanceSystemEnabled,
        hasRailgunWallet: !!railgunWalletId,
        walletIdValue: railgunWalletId?.slice(0, 8) + '...' || 'null',
        hasChainId: !!chainId,
        hasAddress: !!address,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
      // Only clear if system is disabled (not just missing data)
      if (!isBalanceSystemEnabled) {
        updatePrivateBalances([]);
      }
    }
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, address, isRailgunInitialized, railgunAddress, fetchPrivateBalances, updatePrivateBalances]);

  // Create stable refs to avoid stale closures in event listeners
  const stableRefs = useRef({
    railgunWalletId,
    chainId,
    updatePrivateBalances,
    calculateUSDValue,
    fetchPrivateBalances,
    refreshAllBalances
  });
  
  // Update refs on each render to avoid stale closures
  useEffect(() => {
    stableRefs.current = {
      railgunWalletId,
      chainId,
      updatePrivateBalances,
      calculateUSDValue,
      fetchPrivateBalances,
      refreshAllBalances
    };
  });

  // Listen for Railgun balance updates with stable refs to avoid stale closures - CRITICAL: Only when system enabled
  useEffect(() => {
    // 🛑 CRITICAL: Only set up event listeners when balance system is enabled
    if (!isBalanceSystemEnabled) {
      console.log('[useBalances] ⏸️ Balance system disabled - skipping event listener setup');
      return;
    }
    
    console.log('[useBalances] 🎧 Setting up balance update event listeners');
    
    const handleBalanceUpdate = (event) => {
      const {
        railgunWalletId: currentWalletId,
        chainId: currentChainId,
        updatePrivateBalances: currentUpdateFn,
        calculateUSDValue: currentCalculateUSD
      } = stableRefs.current;
      
      console.log('[useBalances] 📡 Received Railgun balance update event:', {
        railgunWalletId: event.detail?.railgunWalletID?.slice(0, 8) + '...',
        chainId: event.detail?.chainId,
        balanceCount: event.detail?.balances?.length,
        timestamp: event.detail?.timestamp,
        source: event.detail?.source, // NEW: Track data source
        currentWalletId: currentWalletId?.slice(0, 8) + '...',
        currentChainId: currentChainId
      });

      // Check if this update is for the current wallet and chain
      if (event.detail?.railgunWalletID === currentWalletId && 
          event.detail?.chainId === currentChainId) {
        
        console.log('[useBalances] ✅ Balance update matches current wallet/chain, applying immediately');
        
        // OPTIMIZATION: Use fresh callback data directly (no cache reload needed!)
        if (event.detail?.source === 'fresh-callback' && event.detail?.balances && Array.isArray(event.detail.balances)) {
          console.log('[useBalances] ⚡ Using FRESH balance data from callback (no cache reload):', {
            count: event.detail.balances.length,
            tokens: event.detail.balances.map(b => `${b.symbol}: ${b.formattedBalance}`)
          });
          
          // Add USD values to the fresh balances
          const balancesWithUSD = event.detail.balances.map(token => ({
            // Convert to legacy format for UI compatibility
            tokenAddress: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            balance: token.rawBalance,
            formattedBalance: token.formattedBalance,
            numericBalance: token.numericBalance,
            hasBalance: token.numericBalance > 0,
            isPrivate: true,
            chainId: currentChainId,
            networkName: NETWORK_MAPPING[currentChainId] || `Chain ${currentChainId}`,
            // Add USD value calculation
            balanceUSD: currentCalculateUSD(token.numericBalance, token.symbol)
          }));
          
          currentUpdateFn(balancesWithUSD);
          console.log('[useBalances] 🚀 Applied FRESH balances from callback with USD values:', {
            count: balancesWithUSD.length,
            tokens: balancesWithUSD.map(b => `${b.symbol}: ${b.formattedBalance} ($${b.balanceUSD})`)
          });
          
        } else if (event.detail?.balances && Array.isArray(event.detail.balances)) {
          // Fallback: Handle legacy cache-sourced data
          console.log('[useBalances] 📦 Using cache-sourced balance data:', {
            source: event.detail?.source || 'unknown',
            count: event.detail.balances.length
          });
          
          // Use the balances from the event detail if available (already formatted)
          const balancesWithUSD = event.detail.balances.map(token => ({
            ...token,
            balanceUSD: currentCalculateUSD(token.numericBalance, token.symbol)
          }));
          
          currentUpdateFn(balancesWithUSD);
          console.log('[useBalances] 🚀 Applied cache balances with USD values:', {
            count: balancesWithUSD.length,
            tokens: balancesWithUSD.map(b => `${b.symbol}: ${b.formattedBalance} ($${b.balanceUSD})`)
          });
          
        } else {
          // Final fallback: fetch from cache if no balance data in event
          console.log('[useBalances] 📦 No balance data in event, fetching from cache...');
          stableRefs.current.fetchPrivateBalances().then(balances => {
            const balancesWithUSD = balances.map(token => ({
              ...token,
              balanceUSD: stableRefs.current.calculateUSDValue(token.numericBalance, token.symbol)
            }));
            stableRefs.current.updatePrivateBalances(balancesWithUSD);
          });
        }
      } else {
        console.log('[useBalances] ⏭️ Balance update for different wallet/chain, ignoring');
      }
    };

    // Handle transaction confirmation events from Graph monitoring
    const handleTransactionConfirmed = (event) => {
      const { chainId: currentChainId, refreshAllBalances: currentRefresh } = stableRefs.current;
      
      console.log('[useBalances] 🎯 Transaction confirmed via Graph monitoring:', {
        txHash: event.detail?.txHash,
        chainId: event.detail?.chainId,
        transactionType: event.detail?.transactionType,
        timestamp: event.detail?.timestamp
      });
      
      // If this is for our current wallet/chain, refresh balances immediately
      if (event.detail?.chainId === currentChainId) {
        console.log('[useBalances] ⚡ Immediate balance refresh triggered by transaction confirmation');
        // Small delay to ensure the balance callback has processed
        setTimeout(() => {
          stableRefs.current.refreshAllBalances();
        }, 1000);
      }
    };

    window.addEventListener('railgun-balance-update', handleBalanceUpdate);
    window.addEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    
    return () => {
      console.log('[useBalances] 🎧 Cleaning up balance update event listeners');
      window.removeEventListener('railgun-balance-update', handleBalanceUpdate);
      window.removeEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    };
  }, [isBalanceSystemEnabled]); // Only set up listeners when system is enabled

  return {
    // Balance data
    publicBalances,
    privateBalances,
    
    // State
    loading,
    lastUpdated,
    lastUpdateTime: lastUpdated, // Add alias for backward compatibility
    error,
    
    // Functions
    refreshAllBalances,
    refreshBalancesAfterTransaction: refreshAllBalances, // Alias for backward compatibility
    formatBalance,
    
    // Utilities
    hasPublicBalances: publicBalances.length > 0,
    hasPrivateBalances: privateBalances.length > 0,
    totalPublicTokens: publicBalances.filter(token => token.hasBalance).length,
    totalPrivateTokens: privateBalances.filter(token => token.hasBalance).length,
  };
};

export default useBalances; 