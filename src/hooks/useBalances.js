/**
 * useBalances Hook - PRODUCTION READY
 * Manages public and private token balances with real blockchain data
 */

import { useState, useEffect, useCallback } from 'react';
import { ethers, formatUnits, Contract } from 'ethers';
import { useWallet } from '../contexts/WalletContext';
import { getPrivateBalances, refreshPrivateBalances } from '../utils/railgun/balances';
import { RPC_URLS } from '../config/environment';

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
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ],
  42161: [ // Arbitrum
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
  ],
  137: [ // Polygon
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', name: 'USD Coin (PoS)', decimals: 6 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin (PoS)', decimals: 18 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD (PoS)', decimals: 6 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', name: 'Wrapped BTC (PoS)', decimals: 8 },
  ],
  56: [ // BSC
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
    { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Token', decimals: 18 },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
    { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', name: 'BTCB Token', decimals: 18 },
  ],
};

// Chain ID to RPC URL mapping using environment configuration
const CHAIN_RPC_MAPPING = {
  1: RPC_URLS.ethereum,
  42161: RPC_URLS.arbitrum,
  137: RPC_URLS.polygon,
  56: RPC_URLS.bsc,
};

const useBalances = () => {
  const { 
    isConnected, 
    address, 
    chainId, 
    railgunWalletId,
    canUseRailgun 
  } = useWallet();

  // State
  const [publicBalances, setPublicBalances] = useState([]);
  const [privateBalances, setPrivateBalances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [balanceErrors, setBalanceErrors] = useState({ public: null, private: null });

  // Get provider for current chain
  const getProvider = useCallback((targetChainId = chainId) => {
    const rpcUrl = CHAIN_RPC_MAPPING[targetChainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${targetChainId}`);
    }
    return new ethers.JsonRpcProvider(rpcUrl);
  }, [chainId]);

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
        contract.symbol().catch(() => tokenInfo.symbol),
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

  // Fetch all public balances
  const fetchPublicBalances = useCallback(async () => {
    if (!isConnected || !address || !chainId) {
      return [];
    }

    try {
      console.log('[useBalances] Fetching public balances for chain:', chainId);
      
      // Clear previous error
      setBalanceErrors(prev => ({ ...prev, public: null }));

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
      setBalanceErrors(prev => ({ ...prev, public: error.message }));
      return [];
    }
  }, [isConnected, address, chainId, fetchNativeBalance, fetchTokenBalance]);

  // Fetch private balances using Railgun
  const fetchPrivateBalances = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !chainId) {
      return [];
    }

    try {
      console.log('[useBalances] Fetching private balances...');
      // Clear previous error
      setBalanceErrors(prev => ({ ...prev, private: null }));
      
      const balances = await getPrivateBalances(railgunWalletId, chainId);
      return balances;
    } catch (error) {
      console.error('[useBalances] Failed to fetch private balances:', error);
      setBalanceErrors(prev => ({ ...prev, private: error.message }));
      return [];
    }
  }, [canUseRailgun, railgunWalletId, chainId]);

  // Refresh all balances
  const refreshAllBalances = useCallback(async () => {
    if (!isConnected) {
      return;
    }

    setIsLoading(true);
    try {
      console.log('[useBalances] Refreshing all balances...');

      // Fetch public and private balances in parallel
      const [publicBals, privateBals] = await Promise.all([
        fetchPublicBalances(),
        fetchPrivateBalances(),
      ]);

      setPublicBalances(publicBals);
      setPrivateBalances(privateBals);
      setLastUpdate(Date.now());

      console.log('[useBalances] Balances refreshed:', {
        public: publicBals.length,
        publicWithBalance: publicBals.filter(b => b.hasBalance).length,
        private: privateBals.length,
        privateWithBalance: privateBals.filter(b => b.hasBalance).length,
      });

    } catch (error) {
      console.error('[useBalances] Failed to refresh balances:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, fetchPublicBalances, fetchPrivateBalances]);

  // Refresh balances after transactions
  const refreshBalancesAfterTransaction = useCallback(async () => {
    console.log('[useBalances] Refreshing balances after transaction...');
    
    // Add delay to allow blockchain to process
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await refreshAllBalances();
  }, [refreshAllBalances]);

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

  // Initial load when wallet connects
  useEffect(() => {
    if (isConnected && address && chainId) {
      refreshAllBalances();
    } else {
      // Clear balances when disconnected
      setPublicBalances([]);
      setPrivateBalances([]);
      setLastUpdate(null);
    }
  }, [isConnected, address, chainId, refreshAllBalances]);

  // Refresh private balances when Railgun wallet changes
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      fetchPrivateBalances().then(balances => {
        setPrivateBalances(balances);
      });
    } else {
      setPrivateBalances([]);
    }
  }, [canUseRailgun, railgunWalletId, fetchPrivateBalances]);

  // Listen for Railgun balance updates
  useEffect(() => {
    const handleBalanceUpdate = (event) => {
      console.log('[useBalances] Received Railgun balance update');
      if (canUseRailgun && railgunWalletId) {
        // Refresh private balances when Railgun notifies of updates
        fetchPrivateBalances().then(balances => {
          setPrivateBalances(balances);
        });
      }
    };

    window.addEventListener('railgun-balance-update', handleBalanceUpdate);
    return () => {
      window.removeEventListener('railgun-balance-update', handleBalanceUpdate);
    };
  }, [canUseRailgun, railgunWalletId, fetchPrivateBalances]);

  return {
    // Balance data
    publicBalances,
    privateBalances,
    
    // State
    isLoading,
    lastUpdate,
    lastUpdateTime: lastUpdate, // Add alias for backward compatibility
    balanceErrors,
    
    // Functions
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    formatBalance,
    
    // Utilities
    hasPublicBalances: publicBalances.length > 0,
    hasPrivateBalances: privateBalances.length > 0,
    totalPublicTokens: publicBalances.filter(token => token.hasBalance).length,
    totalPrivateTokens: privateBalances.filter(token => token.hasBalance).length,
  };
};

export default useBalances; 