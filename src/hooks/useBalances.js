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

  // Stable refs for event listeners
  const stableRefs = useRef({});
  const hasAutoRefreshed = useRef(false);
  
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
      const uniqueSymbols = [...new Set(symbols)];
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
    const price = prices[symbol];
    if (price && typeof price === 'number' && numericBalance > 0) {
      return (numericBalance * price).toFixed(2);
    }
    return '0.00';
  }, []); // No dependencies - access prices via stableRefs

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
      
      // Find metadata for specific wallet ID
      const metadata = result.keys.find(k => k.walletId === railgunWalletId);
      if (!metadata || !metadata.privateBalances || metadata.privateBalances.length === 0) {
        console.log('[useBalances] No private balances found in Redis');
        return false;
      }
      
      // Convert stored balances to UI format
      const privateBalancesFromRedis = metadata.privateBalances.map(balance => ({
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
      
      console.log('[useBalances] ✅ Loaded private balances from Redis:', {
        count: privateBalancesFromRedis.length,
        tokens: privateBalancesFromRedis.map(b => `${b.symbol}: ${b.numericBalance}`)
      });
      
      setPrivateBalances(privateBalancesFromRedis);
      return true;
      
    } catch (error) {
      console.error('[useBalances] Failed to load private balances from Redis:', error);
      return false;
    }
  }, []);

  // Refresh all balances
  const refreshAllBalances = useCallback(async () => {
    if (!address) {
      console.log('[useBalances] ⏸️ Balance refresh blocked - no wallet connected');
      return;
    }

    setLoading(true);
    try {
      console.log('[useBalances] 🔄 Refreshing balances...');

      // Fetch prices
      const allSymbols = [
        ...new Set([
          ...(TOKEN_LISTS[chainId] || []).map(t => t.symbol),
          'ETH', 'MATIC', 'BNB', // Native tokens
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

      // Add USD values to existing private balances (no new data)
      setPublicBalances(publicWithUSD);
      setLastUpdated(Date.now());
      
      // Update private balances with USD values only if we have balances
      // Use functional update to access current state without adding to deps
      setPrivateBalances(currentPrivateBalances => {
        if (currentPrivateBalances.length === 0) {
          return currentPrivateBalances;
        }
        
        const updated = currentPrivateBalances.map(token => ({
          ...token,
          balanceUSD: calculateUSDValue(token.numericBalance, token.symbol, freshPrices)
        }));

        // Prevent unnecessary update with deep equality check
        if (JSON.stringify(updated) !== JSON.stringify(currentPrivateBalances)) {
          return updated;
        }

        return currentPrivateBalances;
      });

      console.log('[useBalances] ✅ Balances refreshed:', {
        public: publicBals.length,
        publicWithBalance: publicBals.filter(b => b.hasBalance).length
      });

    } catch (error) {
      console.error('[useBalances] Failed to refresh balances:', error);
      setError(error.message);
    } finally {
      setLoading(false);
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
      
      // Prepare balances for storage
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
  const applyOptimisticShieldUpdate = async (tokenAddress, tokenSymbol, shieldedAmount) => {
    const { address: currentAddress, railgunWalletId: currentRailgunWalletId, chainId: currentChainId } = stableRefs.current;
    
    const shieldedNumeric = parseFloat(shieldedAmount);
    
    // Calculate RAILGUN fee (25 basis points = 0.25%)
    const RAILGUN_FEE_BPS = 25;
    const railgunFee = shieldedNumeric * (RAILGUN_FEE_BPS / 10000);
    const actualPrivateAmount = shieldedNumeric - railgunFee;
    
    console.log('[useBalances] 🛡️ Applying optimistic shield update:', {
      tokenSymbol,
      originalAmount: shieldedNumeric,
      railgunFee: railgunFee.toFixed(6),
      actualPrivateAmount: actualPrivateAmount.toFixed(6)
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
    
    // Update UI - public balances (decrease)
    const updatedPublic = publicBalances.map(token => {
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
    
    // Update UI - private balances (accumulated total)
    let updatedPrivate = [...privateBalances];
    const currentUIIndex = updatedPrivate.findIndex(token => {
      const addressMatch = token.address?.toLowerCase() === tokenAddress?.toLowerCase();
      const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
      return addressMatch || symbolMatch;
    });
    
    if (currentUIIndex >= 0) {
      // Update existing token
      updatedPrivate[currentUIIndex] = {
        ...updatedPrivate[currentUIIndex],
        numericBalance: accumulatedBalance,
        hasBalance: true,
        balance: accumulatedBalance.toString(),
        formattedBalance: accumulatedBalance.toFixed(6),
        lastUpdated: new Date().toISOString()
      };
    } else {
      // Create new token entry
      const publicToken = publicBalances.find(token => {
        const addressMatch = token.address?.toLowerCase() === tokenAddress?.toLowerCase();
        const symbolMatch = token.symbol?.toLowerCase() === tokenSymbol?.toLowerCase();
        return addressMatch || symbolMatch;
      });
      
      if (publicToken) {
        updatedPrivate.push({
          symbol: publicToken.symbol,
          address: publicToken.address,
          tokenAddress: publicToken.address,
          decimals: publicToken.decimals,
          name: publicToken.name,
          numericBalance: accumulatedBalance,
          balance: accumulatedBalance.toString(),
          formattedBalance: accumulatedBalance.toFixed(6),
          hasBalance: true,
          isPrivate: true,
          chainId: currentChainId,
          lastUpdated: new Date().toISOString()
        });
      }
    }
    
    // Update UI immediately
    setPublicBalances(updatedPublic);
    setPrivateBalances(updatedPrivate);
    setLastUpdated(new Date().toISOString());
    
    console.log('[useBalances] ⚡ Optimistic update applied to UI');
    
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

  // Load private balances from Redis when Railgun wallet is ready
  useEffect(() => {
    if (railgunWalletId && address && isRailgunInitialized) {
      console.log('[useBalances] 🛡️ Railgun wallet ready - loading private balances from Redis...');
      loadPrivateBalancesFromMetadata(address, railgunWalletId).then((loaded) => {
        if (loaded) {
          console.log('[useBalances] ✅ Private balances loaded from Redis');
        } else {
          console.log('[useBalances] ℹ️ No private balances found in Redis');
        }
      });
    }
  }, [railgunWalletId, address, isRailgunInitialized, loadPrivateBalancesFromMetadata]);

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
        const { transactionType, amount, tokenAddress, tokenSymbol } = event.detail;
        
        if (transactionType === 'shield' && amount && tokenAddress && tokenSymbol) {
          console.log('[useBalances] 🛡️ Applying optimistic shield update...');
          try {
            await applyOptimisticShieldUpdate(tokenAddress, tokenSymbol, amount);
            console.log('[useBalances] ✅ UI updated after shield confirmation');
          } catch (error) {
            console.error('[useBalances] Failed optimistic update after shield:', error);
          }
        }
        // Future: Handle unshield/private transfer confirmations here
      }
    };

    window.addEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    return () => {
      window.removeEventListener('railgun-transaction-confirmed', handleTransactionConfirmed);
    };
  }, []);

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
    totalPrivateTokens: privateBalances.filter(token => token.hasBalance).length,
  };
}

export default useBalances; 