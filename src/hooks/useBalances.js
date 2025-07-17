/**
 * useBalances Hook
 * Manages both public and private balances with real-time updates
 */

import { useState, useEffect, useCallback } from 'react';
import { formatUnits, getAddress } from 'ethers';
import { refreshBalances } from '@railgun-community/wallet';
import { NetworkName } from '@railgun-community/shared-models';

import { useWallet } from '../contexts/WalletContext';
import { getTokensForChain } from '../constants/tokens';
import { setBalanceUpdateCallback, waitForRailgunReady } from '../utils/railgun/engine';
import { fetchTokenPrices } from '../utils/pricing/coinGecko';

const useBalances = () => {
  const {
    isConnected,
    address,
    chainId,
    isRailgunInitialized,
    railgunWalletId,
    canUseRailgun,
  } = useWallet();

  // Balance states
  const [publicBalances, setPublicBalances] = useState({});
  const [privateBalances, setPrivateBalances] = useState({});
  const [isLoadingPublic, setIsLoadingPublic] = useState(false);
  const [isLoadingPrivate, setIsLoadingPrivate] = useState(false);
  const [balanceErrors, setBalanceErrors] = useState({});
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [retryAttempts, setRetryAttempts] = useState(0);

  // Format balance for display
  const formatBalance = useCallback((amount, decimals = 18) => {
    if (!amount || amount === '0') return '0.00';
    
    try {
      const formatted = formatUnits(amount, decimals);
      const num = parseFloat(formatted);
      
      if (num < 0.01 && num > 0) {
        return '< 0.01';
      }
      
      return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });
    } catch (error) {
      console.error('Error formatting balance:', error);
      return '0.00';
    }
  }, []);

  // Fetch public balances using standard Web3 calls
  const fetchPublicBalances = useCallback(async () => {
    if (!isConnected || !address || !chainId) {
      console.log('[useBalances] Early return: Wallet not connected or missing params');
      return;
    }

    setIsLoadingPublic(true);
    setBalanceErrors(prev => ({ ...prev, public: null }));

    try {
      console.log('[useBalances] Fetching public balances for:', { address: address.slice(0, 6) + '...', chainId });
      
      // Use Web3 balance fetching helper to get real balances
      const { fetchPublicBalances: fetchWeb3Balances } = await import('../utils/web3/balances.js');
      const balances = await fetchWeb3Balances(address, chainId);
      
      // Convert to the format expected by the UI
      const newBalances = {};
      balances.forEach(token => {
        newBalances[token.symbol] = {
          ...token,
          // Ensure all required fields are present
          balance: token.balance || '0',
          formattedBalance: token.formattedBalance || '0.00',
          balanceUSD: token.balanceUSD || '0.00',
        };
      });

      setPublicBalances(newBalances);
      setLastUpdateTime(Date.now());
      
      const tokensWithBalance = Object.values(newBalances).filter(t => t.hasBalance).length;
      console.log('[useBalances] Public balances loaded successfully:', {
        total: Object.keys(newBalances).length,
        withBalance: tokensWithBalance,
        address: address.slice(0, 6) + '...',
        chainId,
      });
      
    } catch (error) {
      console.error('[useBalances] Error fetching public balances:', error);
      setBalanceErrors(prev => ({ ...prev, public: error.message }));
      
      // Show toast notification for user feedback
      const { toast } = await import('react-hot-toast');
      toast.error(`Failed to load public balances: ${error.message}`);
      
      // Fallback to empty balances on error to prevent infinite loops
      setPublicBalances({});
      
    } finally {
      setIsLoadingPublic(false);
      console.log('[useBalances] Public balance fetch completed');
    }
  }, [isConnected, address, chainId]);

  // Handle Railgun balance updates
  const handleRailgunBalanceUpdate = useCallback(async (balanceEvent) => {
    console.log('[RAILGUN] Private balance callback triggered:', balanceEvent);
    
    if (!railgunWalletId || balanceEvent.railgunWalletID !== railgunWalletId) {
      console.log('[RAILGUN] Balance update for different wallet, ignoring:', {
        expectedWalletId: railgunWalletId,
        receivedWalletId: balanceEvent.railgunWalletID,
      });
      return;
    }

    console.log('[useBalances] Railgun balance update:', balanceEvent);

    try {
      const { balanceBucket, erc20Amounts, chain } = balanceEvent;
      
      // Only process spendable balances for now
      if (balanceBucket !== 'Spendable') {
        console.log(`[useBalances] Ignoring non-spendable balance bucket: ${balanceBucket}`);
        return;
      }

      const tokens = getTokensForChain(chain.id);
      const newPrivateBalances = {};
      const missingTokens = [];
      const tokensToProcess = [];

      // First pass: collect token information
      erc20Amounts.forEach(({ tokenAddress, amount }) => {
        try {
          // Normalize token address to proper checksum format
          const checksummedAddress = tokenAddress ? getAddress(tokenAddress) : null;
          
          // Find token info by address (comparing checksummed addresses)
          const tokenInfo = Object.values(tokens).find(token => {
            if (token.isNative && !checksummedAddress) {
              return true; // Native token (ETH, MATIC, etc.)
            }
            if (token.address && checksummedAddress) {
              return getAddress(token.address) === checksummedAddress;
            }
            return false;
          });

          if (tokenInfo) {
            // Guard for missing token metadata with safe fallbacks
            const symbol = tokenInfo.symbol || 'UNKNOWN';
            const decimals = tokenInfo.decimals || 18;
            const name = tokenInfo.name || 'Unknown Token';
            
            // Warn if metadata is incomplete
            if (!tokenInfo.symbol || tokenInfo.decimals === undefined) {
              console.warn(`[useBalances] Incomplete token metadata for ${checksummedAddress}:`, {
                hasSymbol: !!tokenInfo.symbol,
                hasDecimals: tokenInfo.decimals !== undefined,
                hasName: !!tokenInfo.name,
                tokenInfo,
              });
            }
            
            tokensToProcess.push({
              tokenInfo,
              symbol,
              decimals,
              name,
              address: checksummedAddress || tokenInfo.address,
              amount,
            });
          } else {
            const tokenIdentifier = checksummedAddress || 'native';
            missingTokens.push(tokenIdentifier);
            console.warn(`[useBalances] Unknown token address: ${tokenIdentifier} on chain ${chain.id}`);
          }
        } catch (error) {
          console.error(`[useBalances] Error processing token ${tokenAddress}:`, error);
        }
      });

      // Fetch prices for all tokens at once
      const tokenSymbols = tokensToProcess.map(token => token.symbol);
      let tokenPrices = {};
      
      try {
        if (tokenSymbols.length > 0) {
          console.log('[useBalances] Fetching prices for private balances:', tokenSymbols);
          tokenPrices = await fetchTokenPrices(tokenSymbols);
        }
      } catch (priceError) {
        console.error('[useBalances] Error fetching prices for private balances:', priceError);
        // Continue without prices - balanceUSD will be '0.00'
      }

      // Second pass: process balances with USD calculations
      tokensToProcess.forEach(({ tokenInfo, symbol, decimals, name, address, amount }) => {
        try {
          const formattedBalance = formatBalance(amount.toString(), decimals);
          const numericBalance = parseFloat(formatUnits(amount.toString(), decimals));
          
          // Calculate USD value
          const tokenPrice = tokenPrices[symbol] || 0;
          const usdValue = numericBalance * tokenPrice;
          const formattedUsdValue = usdValue < 0.01 && usdValue > 0 
            ? '< 0.01' 
            : usdValue.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
          
          newPrivateBalances[symbol] = {
            ...tokenInfo,
            symbol,
            decimals,
            name,
            address,
            balance: amount.toString(),
            formattedBalance,
            balanceUSD: formattedUsdValue,
            priceUSD: tokenPrice,
          };
        } catch (error) {
          console.error(`[useBalances] Error calculating USD value for ${symbol}:`, error);
          // Fallback without USD value
          newPrivateBalances[symbol] = {
            ...tokenInfo,
            symbol,
            decimals,
            name,
            address,
            balance: amount.toString(),
            formattedBalance: formatBalance(amount.toString(), decimals),
            balanceUSD: '0.00',
            priceUSD: 0,
          };
        }
      });

      // Log any missing or unmatched token addresses to help expand token registry
      if (missingTokens.length > 0) {
        console.warn(`[useBalances] Missing tokens for chain ${chain.id}:`, missingTokens);
        console.log(`[useBalances] Consider adding these tokens to SUPPORTED_TOKENS[${chain.id}]:`, 
          missingTokens.map(addr => `"${addr}": { symbol: "???", name: "???", decimals: ??, address: "${addr}", isNative: false }`));
      }

      setPrivateBalances(newPrivateBalances);
      setLastUpdateTime(Date.now());
      setRetryAttempts(0); // Reset retry attempts on successful update
      console.log('[useBalances] Private balances updated:', newPrivateBalances);
    } catch (error) {
      console.error('[useBalances] Error processing Railgun balance update:', error);
      setBalanceErrors(prev => ({ ...prev, private: error.message }));
    }
  }, [railgunWalletId, formatBalance]);

  // Get network configuration from chain ID
  const getNetworkFromChainId = useCallback((chainId) => {
    switch (chainId) {
      case 1: return { type: NetworkName.Ethereum, id: 1 };
      case 137: return { type: NetworkName.Polygon, id: 137 };
      case 42161: return { type: NetworkName.Arbitrum, id: 42161 };
      // Note: Optimism temporarily disabled until Railgun SDK adds full support
      // case 10: return { type: NetworkName.Optimism, id: 10 };
      case 56: return { type: NetworkName.BNBChain, id: 56 };
      default: return null;
    }
  }, []);

  // Refresh private balances manually with retry logic
  const refreshPrivateBalances = useCallback(async () => {
    // Enhanced early return checks
    if (!canUseRailgun || !railgunWalletId || !chainId) {
      console.log('[useBalances] Early return: Railgun not ready or missing required params');
      setIsLoadingPrivate(false);
      return;
    }

    // Prevent excessive retries - bail out if we've tried too many times
    if (retryAttempts >= 3) {
      console.log('[useBalances] Max retry attempts reached, stopping private balance refresh');
      setIsLoadingPrivate(false);
      setRetryAttempts(0);
      return;
    }

    setIsLoadingPrivate(true);
    setBalanceErrors(prev => ({ ...prev, private: null }));

    try {
      // Wait for Railgun engine to be ready
      await waitForRailgunReady();
      
      // Get the chain config for Railgun
      const chainConfig = getNetworkFromChainId(chainId);

      if (!chainConfig) {
        throw new Error(`Unsupported chain ID: ${chainId}`);
      }

      console.log('[useBalances] Refreshing private balances for chain:', chainConfig.type);
      
      await refreshBalances(chainConfig, [railgunWalletId]);
      console.log('[useBalances] Private balance refresh initiated');
      
      // Only set up retry timer if this is the initial attempt (not a retry)
      if (retryAttempts === 0) {
        // Check for balance update after 10 seconds
        const timeoutId = setTimeout(() => {
          // Only retry if we still have no private balances and haven't exceeded max attempts
          const hasNoBalances = Object.keys(privateBalances).length === 0;
          const canRetry = retryAttempts < 3;
          const isStillConnected = canUseRailgun && railgunWalletId;
          
          if (hasNoBalances && canRetry && isStillConnected) {
            console.log(`[useBalances] No balance data received, retrying... (attempt ${retryAttempts + 1}/3)`);
            setRetryAttempts(prev => prev + 1);
            refreshPrivateBalances();
          } else if (!hasNoBalances) {
            console.log('[useBalances] Private balances found, stopping retry attempts');
            setRetryAttempts(0);
            setIsLoadingPrivate(false);
          } else if (!isStillConnected) {
            console.log('[useBalances] Railgun disconnected, stopping retry attempts');
            setRetryAttempts(0);
            setIsLoadingPrivate(false);
          } else {
            console.log('[useBalances] Max retry attempts reached or conditions changed, stopping');
            setIsLoadingPrivate(false);
            setRetryAttempts(0);
          }
        }, 10000);
        
        // Store timeout ID to clear it if component unmounts or conditions change
        return () => clearTimeout(timeoutId);
      } else {
        // For retries, don't setup another timer, just complete
        setIsLoadingPrivate(false);
      }
      
    } catch (error) {
      console.error('[useBalances] Error refreshing private balances:', error);
      setBalanceErrors(prev => ({ ...prev, private: error.message }));
      setIsLoadingPrivate(false);
      
      // Only retry on error if we haven't exceeded max attempts and are still connected
      if (retryAttempts < 3 && canUseRailgun && railgunWalletId) {
        console.log(`[useBalances] Retrying balance refresh after error (attempt ${retryAttempts + 1}/3)`);
        const timeoutId = setTimeout(() => {
          setRetryAttempts(prev => prev + 1);
          refreshPrivateBalances();
        }, 5000);
        
        return () => clearTimeout(timeoutId);
      } else {
        console.log('[useBalances] Max retry attempts reached after error or disconnected, stopping');
        setRetryAttempts(0);
      }
    }
  }, [canUseRailgun, railgunWalletId, chainId, getNetworkFromChainId, retryAttempts, privateBalances]);

  // Set up Railgun balance callback
  useEffect(() => {
    if (canUseRailgun) {
      console.log('[useBalances] Setting up Railgun balance callback');
      setBalanceUpdateCallback(handleRailgunBalanceUpdate);
      
      // Refresh balances on setup
      if (railgunWalletId) {
        refreshPrivateBalances();
      }
    }
  }, [canUseRailgun, railgunWalletId, handleRailgunBalanceUpdate, refreshPrivateBalances]);

  // Fetch public balances when wallet connects or chain changes
  useEffect(() => {
    if (isConnected && address && chainId) {
      fetchPublicBalances();
    }
  }, [isConnected, address, chainId, fetchPublicBalances]);

  // Clear balances when disconnected and reset retry state
  useEffect(() => {
    if (!isConnected) {
      console.log('[useBalances] Wallet disconnected, clearing all balance state');
      setPublicBalances({});
      setPrivateBalances({});
      setBalanceErrors({});
      setLastUpdateTime(null);
      setRetryAttempts(0);
      setIsLoadingPrivate(false);
      setIsLoadingPublic(false);
    }
  }, [isConnected]);

  // Reset retry attempts when Railgun connection state changes
  useEffect(() => {
    if (!canUseRailgun || !railgunWalletId) {
      console.log('[useBalances] Railgun unavailable, resetting private balance state');
      setRetryAttempts(0);
      setIsLoadingPrivate(false);
      setBalanceErrors(prev => ({ ...prev, private: null }));
    }
  }, [canUseRailgun, railgunWalletId]);

  // Get total balance for a token (public + private)
  const getTotalBalance = useCallback((tokenSymbol) => {
    const publicBalance = publicBalances[tokenSymbol]?.balance || '0';
    const privateBalance = privateBalances[tokenSymbol]?.balance || '0';
    
    try {
      const pubBigInt = BigInt(publicBalance);
      const privBigInt = BigInt(privateBalance);
      const total = pubBigInt + privBigInt;
      
      const tokenInfo = publicBalances[tokenSymbol] || privateBalances[tokenSymbol];
      if (tokenInfo) {
        return {
          balance: total.toString(),
          formattedBalance: formatBalance(total.toString(), tokenInfo.decimals),
        };
      }
    } catch (error) {
      console.error('Error calculating total balance:', error);
    }
    
    return { balance: '0', formattedBalance: '0.00' };
  }, [publicBalances, privateBalances, formatBalance]);

  // Get all unique tokens (from both public and private)
  const getAllTokens = useCallback(() => {
    const allTokenSymbols = new Set([
      ...Object.keys(publicBalances),
      ...Object.keys(privateBalances),
    ]);

    return Array.from(allTokenSymbols).map(symbol => {
      const publicToken = publicBalances[symbol];
      const privateToken = privateBalances[symbol];
      const tokenInfo = publicToken || privateToken;
      const total = getTotalBalance(symbol);

      return {
        ...tokenInfo,
        publicBalance: publicToken?.formattedBalance || '0.00',
        privateBalance: privateToken?.formattedBalance || '0.00',
        totalBalance: total.formattedBalance,
      };
    });
  }, [publicBalances, privateBalances, getTotalBalance]);

  // Manual refresh functions
  const refreshAllBalances = useCallback(async () => {
    const promises = [];
    
    if (isConnected) {
      promises.push(fetchPublicBalances());
    }
    
    if (canUseRailgun && railgunWalletId) {
      promises.push(refreshPrivateBalances());
    }
    
    await Promise.allSettled(promises);
  }, [isConnected, canUseRailgun, railgunWalletId, fetchPublicBalances, refreshPrivateBalances]);

  return {
    // Balance data
    publicBalances,
    privateBalances,
    
    // Loading states
    isLoadingPublic,
    isLoadingPrivate,
    isLoading: isLoadingPublic || isLoadingPrivate,
    
    // Error states
    balanceErrors,
    
    // Utility functions
    formatBalance,
    getTotalBalance,
    getAllTokens,
    
    // Manual refresh
    refreshAllBalances,
    refreshPrivateBalances,
    refreshPublicBalances: fetchPublicBalances,
    
    // Metadata
    lastUpdateTime,
    retryAttempts,
  };
};

export default useBalances; 