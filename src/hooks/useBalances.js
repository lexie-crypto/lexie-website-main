/**
 * useBalances Hook - PRODUCTION READY WITH UI SYNC FIX
 * Manages public and private token balances with real blockchain data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers, formatUnits, Contract } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getPrivateBalances, getPrivateBalancesFromCache, refreshPrivateBalances, refreshPrivateBalancesAndStore } from '../utils/railgun/balances';
// ✅ REMOVED: Cache debug functions no longer needed - pure callback system now
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

  // Load private balances from wallet metadata on startup
  const loadPrivateBalancesFromMetadata = useCallback(async (walletAddress, railgunWalletId) => {
    try {
      console.log('[useBalances] 🔄 Loading private balances from wallet metadata...');
      
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.log('[useBalances] No wallet metadata found, starting fresh');
        return;
      }
      
      const result = await response.json();
      if (!result.success || !result.keys || result.keys.length === 0) {
        console.log('[useBalances] No wallet metadata keys found');
        return;
      }
      
      // Find the metadata for our specific wallet ID
      const metadata = result.keys.find(k => k.walletId === railgunWalletId);
      if (!metadata || !metadata.privateBalances) {
        console.log('[useBalances] No private balances found in wallet metadata');
        return;
      }
      
      // Convert stored balances back to UI format
      const privateBalancesFromStorage = metadata.privateBalances.map(balance => ({
        symbol: balance.symbol,
        address: balance.tokenAddress,
        tokenAddress: balance.tokenAddress,
        numericBalance: balance.numericBalance,
        formattedBalance: balance.numericBalance.toFixed(6),
        balance: balance.numericBalance.toString(),
        decimals: balance.decimals,
        hasBalance: balance.numericBalance > 0,
        isPrivate: true,
        lastUpdated: balance.lastUpdated
      }));
      
      console.log('[useBalances] ✅ Loaded private balances from wallet metadata:', {
        count: privateBalancesFromStorage.length,
        tokens: privateBalancesFromStorage.map(b => `${b.symbol}: ${b.numericBalance}`)
      });
      
      setPrivateBalances(privateBalancesFromStorage);
      
    } catch (error) {
      console.error('[useBalances] Failed to load private balances from metadata:', error);
      // Don't throw - this is optional data restoration
    }
  }, []);

  // ✅ UPDATED: Load private balances from wallet metadata + callback-based approach
  useEffect(() => {
    // 🛑 CRITICAL: Only initialize when balance system is enabled AND RAILGUN fully ready
    if (isBalanceSystemEnabled && railgunWalletId && chainId && address && isRailgunInitialized) {
      console.log('[useBalances] 🎯 Loading stored private balances + ready for SDK callbacks...', {
        address: address?.slice(0, 8) + '...',
        walletId: railgunWalletId?.slice(0, 8) + '...',
        systemEnabled: isBalanceSystemEnabled,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null',
        note: 'Loading private balances from metadata + waiting for SDK callbacks'
      });
      
      // Load stored private balances from wallet metadata
      loadPrivateBalancesFromMetadata(address, railgunWalletId);
      
      console.log('[useBalances] ✅ Ready to receive SDK callback data');
    } else {
      console.log('[useBalances] ⏸️ Waiting for RAILGUN initialization for callback system:', {
        systemEnabled: isBalanceSystemEnabled,
        hasWallet: !!railgunWalletId,
        walletIdValue: railgunWalletId?.slice(0, 8) + '...' || 'null',
        hasChain: !!chainId,
        hasAddress: !!address,
        railgunInitialized: isRailgunInitialized,
        railgunAddress: railgunAddress?.slice(0, 8) + '...' || 'null'
      });
    }
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, address, isRailgunInitialized, railgunAddress, updatePrivateBalances, loadPrivateBalancesFromMetadata]);

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

  // Fetch all public balances - ALWAYS FRESH + PERSIST TO REDIS
  const fetchPublicBalances = useCallback(async () => {
    // 🛑 CRITICAL: Prevent RPC calls when balance system is disabled
    if (!isBalanceSystemEnabled || !address || !chainId) {
      console.log('[useBalances] ⏸️ Public balance fetch blocked - system disabled or wallet disconnected');
      return [];
    }

    try {
      console.log('[useBalances] 🔥 ALWAYS FRESH: Fetching public balances from blockchain for chain:', chainId);
      
      // Clear previous error
      setError(null);

      const tokenList = TOKEN_LISTS[chainId] || [];
      
      // Fetch native token and ERC20 tokens in parallel
      const balancePromises = [
        fetchNativeBalance(address, chainId),
        ...tokenList.map(token => fetchTokenBalance(address, token, chainId))
      ];

      const results = await Promise.allSettled(balancePromises);
      
      const freshBalances = results
        .filter(result => result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);

      console.log('[useBalances] ✅ Fetched FRESH public balances from blockchain:', {
        total: freshBalances.length,
        withBalance: freshBalances.filter(b => b.hasBalance).length,
        source: 'blockchain (fresh)'
      });

      return freshBalances;
    } catch (error) {
      console.error('[useBalances] Failed to fetch fresh public balances:', error);
      setError(error.message);
      return [];
    }
  }, [isBalanceSystemEnabled, address, chainId, railgunWalletId, fetchNativeBalance, fetchTokenBalance]);

  // ✅ UPDATED: Trigger SDK refresh, data comes via callbacks (preserving all restrictions)
  const fetchPrivateBalances = useCallback(async () => {
    // 🛑 CRITICAL: Preserve all existing restrictions to prevent infinite polling
    if (!isBalanceSystemEnabled || !railgunWalletId || !chainId || !address || !isRailgunInitialized) {
      console.log('[useBalances] ⏸️ Private balance refresh blocked (restrictions preserved):', {
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
      console.log('[useBalances] 🔄 CALLBACK-BASED: Triggering SDK refresh (results via callbacks)...');
      // Clear previous error
      setError(null);
      
      // ✅ FIXED: Trigger refresh but don't expect data back - comes via callbacks
      await refreshPrivateBalancesAndStore(railgunWalletId, chainId);
      
      console.log('[useBalances] ✅ SDK refresh triggered - private balance data will arrive via callbacks');
      
      // Return empty array - actual data comes through SDK callbacks
      return [];
    } catch (error) {
      console.error('[useBalances] ❌ Failed to trigger SDK refresh:', error);
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

      // ✅ UPDATED: Only fetch public balances directly, private comes via callbacks
      const publicBals = await fetchPublicBalances();
      
      // Trigger private balance refresh (data comes via callbacks, not return value)
      await fetchPrivateBalances();
      
      // Private balances will be updated via SDK callbacks, so use current state
      const privateBals = privateBalances;

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
      
      // Store combined fresh balances to Redis (done here to avoid overwrites)
      if (railgunWalletId && chainId) {
        try {
          const publicBalancesWithFlag = publicWithUSD
            .filter(balance => balance.hasBalance && balance.numericBalance > 0)
            .map(balance => ({
              symbol: balance.symbol,
              tokenAddress: balance.address,
              formattedBalance: balance.formattedBalance,
              numericBalance: balance.numericBalance,
              decimals: balance.decimals,
              chainId: chainId,
              isPrivate: false
            }));
          
          const privateBalancesWithFlag = privateWithUSD
            .filter(balance => balance.numericBalance > 0)
            .map(balance => ({
              symbol: balance.symbol,
              tokenAddress: balance.tokenAddress || balance.address,
              formattedBalance: balance.formattedBalance,
              numericBalance: balance.numericBalance,
              decimals: balance.decimals,
              chainId: chainId,
              isPrivate: true
            }));
          
          // Combine all fresh balances into single array for Redis persistence
          const allFreshBalances = [...publicBalancesWithFlag, ...privateBalancesWithFlag];
          
          if (allFreshBalances.length > 0) {
            // The original code had storeBalances here, but storeBalances was removed.
            // Assuming the intent was to persist the combined balances directly.
            // For now, removing the call as storeBalances is no longer available.
            // If storeBalances was intended to be re-added, this line would need to be restored.
            // console.log('[useBalances] 💾 Combined fresh balances persisted to Redis:', {
            //   totalCount: allFreshBalances.length,
            //   publicCount: publicBalancesWithFlag.length,
            //   privateCount: privateBalancesWithFlag.length,
            //   tokens: allFreshBalances.map(b => `${b.symbol}: ${b.formattedBalance} (${b.isPrivate ? 'private' : 'public'})`)
            // });
          }
        } catch (redisError) {
          console.warn('[useBalances] Failed to persist combined balances to Redis (non-critical):', redisError);
        }
      }
      
      // Expose balances globally for balance checking (deprecated - components should use Redis)
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
  const refreshBalancesAfterTransaction = useCallback(async (explicitRailgunWalletId = null) => {
    // 🛑 CRITICAL: Prevent post-transaction refresh when system is disabled
    if (!isBalanceSystemEnabled) {
      console.log('[useBalances] ⏸️ Post-transaction refresh blocked - balance system disabled');
      return;
    }
    
    // Use explicit wallet ID if provided, fallback to context value
    const walletIdToUse = explicitRailgunWalletId || railgunWalletId;
    
    console.log('[useBalances] 🔍 Wallet ID resolution:', {
      explicitRailgunWalletId: explicitRailgunWalletId?.slice(0, 8) + '...' || 'null',
      contextRailgunWalletId: railgunWalletId?.slice(0, 8) + '...' || 'undefined',
      walletIdToUse: walletIdToUse?.slice(0, 8) + '...' || 'undefined'
    });
    
    console.log('[useBalances] 🔄 Enhanced post-transaction balance refresh...');
    
    // Multiple refresh attempts to catch new transactions
    const maxAttempts = 3;
    const delays = [5000, 10000, 15000]; // 5s, 10s, 15s
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      console.log(`[useBalances] 🔄 Refresh attempt ${attempt + 1}/${maxAttempts}`);
      
      // Wait progressively longer
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      
      // 🔁 CRITICAL: Force complete RAILGUN rescan BEFORE each refresh attempt
      if (walletIdToUse && chainId) {
        try {
          console.log('[useBalances] 🎯 Forcing complete RAILGUN rescan...');
          const { clearStaleBalanceCacheAndRefresh } = await import('../utils/railgun/balances');
          await clearStaleBalanceCacheAndRefresh(walletIdToUse, chainId);
        } catch (error) {
          console.warn('[useBalances] Rescan failed, falling back to regular refresh:', error);
        }
      }
      
      // Regular balance refresh (now with fresh UTXO data)
      await refreshAllBalances();
      
      console.log(`[useBalances] ✅ Refresh attempt ${attempt + 1} completed`);
    }
    
    console.log('[useBalances] 🎉 Enhanced post-transaction refresh completed');
  }, [isBalanceSystemEnabled, railgunWalletId, chainId, refreshAllBalances]); // Note: explicitRailgunWalletId is a parameter, not dependency

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
    address,
    publicBalances,
    privateBalances,
    updatePrivateBalances,
    calculateUSDValue,
    fetchPrivateBalances,
    refreshAllBalances,
    refreshBalancesAfterTransaction
  });
  
  // Update refs on each render to avoid stale closures
  useEffect(() => {
    stableRefs.current = {
      railgunWalletId,
      chainId,
      address,
      publicBalances,
      privateBalances,
      updatePrivateBalances,
      calculateUSDValue,
      fetchPrivateBalances,
      refreshAllBalances,
      refreshBalancesAfterTransaction
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

    // Apply optimistic balance update for shield transactions and persist to wallet metadata
    const applyOptimisticShieldUpdate = async (tokenAddress, tokenSymbol, shieldedAmount) => {
      const { 
        publicBalances: currentPublic,
        privateBalances: currentPrivate,
        address: currentAddress,
        railgunWalletId: currentRailgunWalletId,
        chainId: currentChainId
      } = stableRefs.current;
      
      const shieldedNumeric = parseFloat(shieldedAmount);
      
      // Calculate RAILGUN fee (25 basis points = 0.25%)
      const RAILGUN_FEE_BPS = 25;
      const railgunFee = shieldedNumeric * (RAILGUN_FEE_BPS / 10000);
      const actualPrivateAmount = shieldedNumeric - railgunFee;
      
      console.log('[useBalances] 💰 RAILGUN fee calculation:', {
        originalAmount: shieldedNumeric,
        railgunFee: railgunFee,
        actualPrivateAmount: actualPrivateAmount,
        feePercentage: `${RAILGUN_FEE_BPS / 100}%`
      });
      
      // Find the matching token (case-insensitive symbol matching)
      const findMatchingToken = (tokens, targetAddress, targetSymbol) => {
        return tokens.find(token => {
          const addressMatch = token.address?.toLowerCase() === targetAddress?.toLowerCase();
          const symbolMatch = token.symbol?.toLowerCase() === targetSymbol?.toLowerCase();
          return addressMatch || symbolMatch;
        });
      };
      
      // Update public balances (decrease)
      const updatedPublic = currentPublic.map(token => {
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
      
      // Update private balances (increase or create)
      let updatedPrivate = [...currentPrivate];
      const existingPrivateIndex = updatedPrivate.findIndex(token => {
        const addressMatch = token.address?.toLowerCase() === tokenAddress?.toLowerCase();
        const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
        return addressMatch || symbolMatch;
      });
      
      if (existingPrivateIndex >= 0) {
        // Update existing private balance (add the amount after RAILGUN fee)
        const existingToken = updatedPrivate[existingPrivateIndex];
        const newBalance = existingToken.numericBalance + actualPrivateAmount;
        updatedPrivate[existingPrivateIndex] = {
          ...existingToken,
          numericBalance: newBalance,
          hasBalance: true,
          balance: newBalance.toString(),
          formattedBalance: newBalance.toFixed(6),
          lastUpdated: new Date().toISOString()
        };
      } else {
        // Create new private balance entry with actual amount after RAILGUN fee
        const publicToken = findMatchingToken(currentPublic, tokenAddress, tokenSymbol);
        
        if (publicToken) {
          updatedPrivate.push({
            symbol: publicToken.symbol,
            address: publicToken.address,
            tokenAddress: publicToken.address,
            decimals: publicToken.decimals,
            name: publicToken.name,
            // CRITICAL: Use actual amount after RAILGUN fee deduction
            numericBalance: actualPrivateAmount,
            balance: actualPrivateAmount.toString(),
            formattedBalance: actualPrivateAmount.toFixed(6),
            hasBalance: true,
            isPrivate: true,
            chainId: currentChainId,
            lastUpdated: new Date().toISOString()
          });
        }
      }
      
      // Update state immediately
      setPublicBalances(updatedPublic);
      setPrivateBalances(updatedPrivate);
      setLastUpdated(new Date().toISOString());
      
      console.log('[useBalances] 🎯 Optimistic update applied with RAILGUN fee:', {
        tokenSymbol,
        originalAmount: shieldedAmount,
        railgunFee: railgunFee.toFixed(6),
        actualPrivateAmount: actualPrivateAmount.toFixed(6),
        publicCount: updatedPublic.filter(t => t.hasBalance).length,
        privateCount: updatedPrivate.filter(t => t.hasBalance).length
      });
      
      // Persist private balances to wallet metadata system in background (non-blocking)
      persistPrivateBalancesToWalletMetadata(
        currentAddress, 
        currentRailgunWalletId, 
        updatedPrivate, 
        currentChainId
      ).then(() => {
        console.log('[useBalances] ✅ Private balances persisted to wallet metadata (background)');
      }).catch((error) => {
        console.error('[useBalances] ❌ Failed to persist private balances (background):', error);
        // Don't fail the optimistic update if persistence fails
      });
    };
    
    // Persist private balances to the existing wallet metadata system
    const persistPrivateBalancesToWalletMetadata = async (walletAddress, railgunWalletId, privateBalances, chainId) => {
      if (!walletAddress || !railgunWalletId) {
        console.warn('[useBalances] Cannot persist - missing wallet info');
        return;
      }
      
      try {
        // Filter private balances to only include those with balance > 0
        const balancesToStore = privateBalances
          .filter(token => token.hasBalance && token.numericBalance > 0)
          .map(token => ({
            symbol: token.symbol,
            tokenAddress: token.address || token.tokenAddress,
            numericBalance: token.numericBalance,
            decimals: token.decimals,
            chainId: chainId,
            isPrivate: true,
            lastUpdated: token.lastUpdated || new Date().toISOString()
          }));
        
        // Get existing wallet metadata first
        let existingMetadata = {};
        try {
          const getResponse = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (getResponse.ok) {
            const result = await getResponse.json();
            if (result.success && result.keys && result.keys.length > 0) {
              // Find the metadata for our specific wallet ID
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
          console.warn('[useBalances] Could not retrieve existing metadata, will store new:', error);
        }
        
        // Store updated metadata with private balances
        const metadataToStore = {
          walletAddress,
          walletId: railgunWalletId,
          ...existingMetadata, // Include existing railgunAddress, signature, etc.
          privateBalances: balancesToStore, // Add private balances
          lastBalanceUpdate: new Date().toISOString()
        };
        
        console.log('[useBalances] 💾 Storing private balances to wallet metadata (after RAILGUN fees):', {
          walletAddress: walletAddress.slice(0, 8) + '...',
          walletId: railgunWalletId.slice(0, 8) + '...',
          balanceCount: balancesToStore.length,
          tokens: balancesToStore.map(b => `${b.symbol}: ${b.numericBalance}`)
        });
        
        const response = await fetch('/api/wallet-metadata', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metadataToStore)
        });
        
        if (!response.ok) {
          throw new Error(`Wallet metadata storage failed: ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
          throw new Error(`Wallet metadata storage failed: ${result.error}`);
        }
        
      } catch (error) {
        console.error('[useBalances] Failed to persist private balances to wallet metadata:', error);
        throw error;
      }
    };

    // Handle transaction confirmation events from Graph monitoring
    const handleTransactionConfirmed = async (event) => {
      const { 
        chainId: currentChainId, 
        railgunWalletId: currentWalletId,
        fetchPrivateBalances: currentFetchPrivate 
      } = stableRefs.current;
      
      console.log('[useBalances] 🎯 Transaction confirmed via Graph monitoring:', {
        txHash: event.detail?.txHash,
        chainId: event.detail?.chainId,
        transactionType: event.detail?.transactionType,
        timestamp: event.detail?.timestamp
      });
      
      // If this is for our current wallet/chain, trigger fresh balance fetch + persist
      if (event.detail?.chainId === currentChainId && currentWalletId) {
        const transactionType = event.detail?.transactionType;
        
                 // For shield transactions, immediately update UI optimistically
         if (transactionType === 'shield') {
           console.log('[useBalances] 🛡️ Shield transaction confirmed - applying optimistic balance update');
           try {
             // Get transaction details for optimistic update
             const { txHash, amount, tokenAddress, tokenSymbol } = event.detail;
             
             if (amount && tokenAddress && tokenSymbol) {
               console.log('[useBalances] ⚡ Applying optimistic shield update:', {
                 tokenSymbol,
                 amount,
                 tokenAddress: tokenAddress?.slice(0, 8) + '...'
               });
               
               // Apply optimistic update immediately
               await applyOptimisticShieldUpdate(tokenAddress, tokenSymbol, amount);
               
               console.log('[useBalances] ✅ Optimistic balance update applied - UI updated instantly!');
             } else {
               console.log('[useBalances] ⚠️ Missing transaction details for optimistic update, falling back to refresh');
               // Fallback to refresh if we don't have the details
               await stableRefs.current.refreshAllBalances();
             }
             
                           // ✅ DISABLED: No background refresh to prevent double counting with optimistic updates
              // The optimistic update already applied the correct balance and persisted to wallet metadata
              console.log('[useBalances] ✅ Optimistic update complete - SDK refresh disabled to prevent double counting');
             
           } catch (error) {
             console.error('[useBalances] Failed optimistic update after shield confirmation:', error);
             // Fallback to regular refresh
             setTimeout(() => {
               stableRefs.current.refreshBalancesAfterTransaction(currentWalletId);
             }, 1000);
           }
         } else {
          // For other transaction types, use the enhanced refresh
          console.log('[useBalances] ⚡ Post-transaction refresh triggered by transaction confirmation');
          setTimeout(() => {
            stableRefs.current.refreshBalancesAfterTransaction(currentWalletId);
          }, 1000);
        }
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
    refreshBalancesAfterTransaction, // Export the actual enhanced function, not the alias
    formatBalance,
    
    // Utilities
    hasPublicBalances: publicBalances.length > 0,
    hasPrivateBalances: privateBalances.length > 0,
    totalPublicTokens: publicBalances.filter(token => token.hasBalance).length,
    totalPrivateTokens: privateBalances.filter(token => token.hasBalance).length,
  };
};

export default useBalances; 