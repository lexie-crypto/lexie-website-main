/**
 * Web3 Balance Fetching
 * Fetches real public token balances from connected EOA wallet
 */

import { ethers, formatUnits, Contract } from 'ethers';
import { getAccount, getPublicClient } from '@wagmi/core';
import { createPublicClient, http } from 'viem';

import { getTokensForChain } from '../../constants/tokens.js';
import { RPC_URLS } from '../../config/environment.js';
import { fetchTokenPrices, calculateUSDValue } from '../pricing/coinGecko.js';

// Standard ERC20 ABI for balance checking
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

/**
 * Fetch public token balances for an address
 * @param {string} address - EOA address to check balances for
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of token balance objects
 */
export const fetchPublicBalances = async (address, chainId) => {
  try {
    console.log('[Web3Balances] Fetching public balances for:', { address, chainId });

    if (!address || !chainId) {
      throw new Error('Address and chain ID are required');
    }

    // Get supported tokens for this chain
    const supportedTokens = getTokensForChain(chainId);
    const tokenArray = Object.values(supportedTokens);

    // Create provider for this chain
    const provider = createProvider(chainId);
    if (!provider) {
      throw new Error(`No provider available for chain ${chainId}`);
    }

    const balances = [];
    const tokenSymbols = tokenArray.map(token => token.symbol);

    // Fetch prices for all tokens at once (more efficient)
    console.log('[Web3Balances] Fetching token prices...');
    const tokenPrices = await fetchTokenPrices(tokenSymbols);
    console.log('[Web3Balances] Token prices fetched:', tokenPrices);

    // Fetch balances for each token
    for (const token of tokenArray) {
      try {
        let balance = '0';
        let actualDecimals = token.decimals;
        let actualSymbol = token.symbol;
        let actualName = token.name;

        if (token.isNative) {
          // Fetch native token balance (ETH, MATIC, BNB, etc.)
          balance = await provider.getBalance(address);
        } else {
          // Fetch ERC20 token balance
          const tokenContract = new Contract(token.address, ERC20_ABI, provider);
          
          // Get balance and verify token details
          const [tokenBalance, decimals, symbol, name] = await Promise.allSettled([
            tokenContract.balanceOf(address),
            tokenContract.decimals(),
            tokenContract.symbol(),
            tokenContract.name(),
          ]);

          balance = tokenBalance.status === 'fulfilled' ? tokenBalance.value : '0';
          actualDecimals = decimals.status === 'fulfilled' ? decimals.value : token.decimals;
          actualSymbol = symbol.status === 'fulfilled' ? symbol.value : token.symbol;
          actualName = name.status === 'fulfilled' ? name.value : token.name;
        }

        // Format balance for display
        const formattedBalance = formatUnits(balance, actualDecimals);
        const numericBalance = parseFloat(formattedBalance);

        // Calculate USD value using the token price
        const tokenPrice = tokenPrices[actualSymbol] || 0;
        const usdValue = numericBalance * tokenPrice;
        const formattedUsdValue = usdValue < 0.01 && usdValue > 0 
          ? '< 0.01' 
          : usdValue.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

        // Only include tokens with non-zero balances (or include all for UI completeness)
        balances.push({
          ...token,
          symbol: actualSymbol,
          name: actualName,
          decimals: actualDecimals,
          balance: balance.toString(),
          formattedBalance: numericBalance.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          }),
          numericBalance,
          hasBalance: numericBalance > 0,
          balanceUSD: formattedUsdValue,
          priceUSD: tokenPrice,
        });

        console.log(`[Web3Balances] ${actualSymbol}: ${formattedBalance} (${formattedUsdValue})`);
      } catch (error) {
        console.error(`[Web3Balances] Error fetching balance for ${token.symbol}:`, error);
        
        // Add token with zero balance if fetch fails
        balances.push({
          ...token,
          balance: '0',
          formattedBalance: '0.00',
          numericBalance: 0,
          hasBalance: false,
          balanceUSD: '0.00',
          priceUSD: 0,
          error: error.message,
        });
      }
    }

    // Sort by USD value (highest first) and then by symbol
    balances.sort((a, b) => {
      const aUsdValue = parseFloat(a.balanceUSD.replace(/[<,]/g, '')) || 0;
      const bUsdValue = parseFloat(b.balanceUSD.replace(/[<,]/g, '')) || 0;
      
      if (aUsdValue !== bUsdValue) {
        return bUsdValue - aUsdValue;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    const totalTokens = balances.length;
    const tokensWithBalance = balances.filter(b => b.hasBalance).length;
    const totalUsdValue = balances
      .filter(b => b.hasBalance)
      .reduce((sum, token) => {
        const usdValue = parseFloat(token.balanceUSD.replace(/[<,]/g, '')) || 0;
        return sum + usdValue;
      }, 0);

    console.log('[Web3Balances] Public balances fetched:', {
      totalTokens,
      tokensWithBalance,
      totalUsdValue: totalUsdValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
      chain: chainId,
    });

    return balances;
  } catch (error) {
    console.error('[Web3Balances] Failed to fetch public balances:', error);
    throw error;
  }
};

/**
 * Fetch balance for a specific token
 * @param {string} address - EOA address
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {number} chainId - Chain ID
 * @returns {Object} Token balance object
 */
export const fetchTokenBalance = async (address, tokenAddress, chainId) => {
  try {
    console.log('[Web3Balances] Fetching specific token balance:', {
      address,
      tokenAddress,
      chainId,
    });

    const provider = createProvider(chainId);
    if (!provider) {
      throw new Error(`No provider available for chain ${chainId}`);
    }

    let balance = '0';
    let decimals = 18;
    let symbol = 'UNKNOWN';
    let name = 'Unknown Token';

    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Native token
      balance = await provider.getBalance(address);
      
      // Get native token info from supported tokens
      const supportedTokens = getTokensForChain(chainId);
      const nativeToken = Object.values(supportedTokens).find(t => t.isNative);
      if (nativeToken) {
        decimals = nativeToken.decimals;
        symbol = nativeToken.symbol;
        name = nativeToken.name;
      }
    } else {
      // ERC20 token
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
      
      const [tokenBalance, tokenDecimals, tokenSymbol, tokenName] = await Promise.allSettled([
        tokenContract.balanceOf(address),
        tokenContract.decimals(),
        tokenContract.symbol(),
        tokenContract.name(),
      ]);

      balance = tokenBalance.status === 'fulfilled' ? tokenBalance.value : '0';
      decimals = tokenDecimals.status === 'fulfilled' ? tokenDecimals.value : 18;
      symbol = tokenSymbol.status === 'fulfilled' ? tokenSymbol.value : 'UNKNOWN';
      name = tokenName.status === 'fulfilled' ? tokenName.value : 'Unknown Token';
    }

    const formattedBalance = formatUnits(balance, decimals);
    const numericBalance = parseFloat(formattedBalance);

    const tokenBalance = {
      address: tokenAddress,
      symbol,
      name,
      decimals,
      balance: balance.toString(),
      formattedBalance: numericBalance.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }),
      numericBalance,
      hasBalance: numericBalance > 0,
      isNative: !tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000',
    };

    console.log('[Web3Balances] Token balance fetched:', tokenBalance);
    return tokenBalance;
  } catch (error) {
    console.error('[Web3Balances] Failed to fetch token balance:', error);
    throw error;
  }
};

/**
 * Create ethers provider for a specific chain
 * @param {number} chainId - Chain ID
 * @returns {ethers.Provider} Ethers provider instance
 */
const createProvider = (chainId) => {
  try {
    // Map chain IDs to RPC URLs
    const rpcUrlMap = {
      1: RPC_URLS.ethereum,
      137: RPC_URLS.polygon,
      42161: RPC_URLS.arbitrum,
      56: RPC_URLS.bsc,
    };

    const rpcUrl = rpcUrlMap[chainId];
    if (!rpcUrl) {
      console.warn(`[Web3Balances] No RPC URL configured for chain ${chainId}`);
      return null;
    }

    // Create ethers provider
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return provider;
  } catch (error) {
    console.error('[Web3Balances] Failed to create provider:', error);
    return null;
  }
};

/**
 * Get tokens with non-zero balances (for Shield All functionality)
 * @param {string} address - EOA address
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of tokens with balances > 0
 */
export const getShieldableTokens = async (address, chainId) => {
  try {
    const allBalances = await fetchPublicBalances(address, chainId);
    const shieldableTokens = allBalances.filter(token => token.hasBalance && token.numericBalance > 0);

    console.log('[Web3Balances] Shieldable tokens found:', {
      total: shieldableTokens.length,
      tokens: shieldableTokens.map(t => `${t.symbol}: ${t.formattedBalance}`),
    });

    return shieldableTokens;
  } catch (error) {
    console.error('[Web3Balances] Failed to get shieldable tokens:', error);
    return [];
  }
};

/**
 * Refresh a specific token balance
 * @param {string} address - EOA address
 * @param {string} tokenAddress - Token contract address
 * @param {number} chainId - Chain ID
 * @returns {Object} Updated token balance
 */
export const refreshTokenBalance = async (address, tokenAddress, chainId) => {
  try {
    console.log('[Web3Balances] Refreshing token balance...');
    const balance = await fetchTokenBalance(address, tokenAddress, chainId);
    console.log('[Web3Balances] Token balance refreshed');
    return balance;
  } catch (error) {
    console.error('[Web3Balances] Failed to refresh token balance:', error);
    throw error;
  }
};

/**
 * Check if user has sufficient balance for an operation
 * @param {string} address - EOA address
 * @param {string} tokenAddress - Token contract address
 * @param {string} amount - Amount to check (in token units)
 * @param {number} chainId - Chain ID
 * @returns {Object} Balance check result
 */
export const checkSufficientBalance = async (address, tokenAddress, amount, chainId) => {
  try {
    const tokenBalance = await fetchTokenBalance(address, tokenAddress, chainId);
    const requiredAmount = parseFloat(amount);
    const available = tokenBalance.numericBalance;
    
    const hasSufficient = available >= requiredAmount;
    
    console.log('[Web3Balances] Balance check:', {
      token: tokenBalance.symbol,
      required: requiredAmount,
      available,
      sufficient: hasSufficient,
    });

    return {
      hasSufficient,
      available,
      required: requiredAmount,
      token: tokenBalance,
      shortfall: hasSufficient ? 0 : requiredAmount - available,
    };
  } catch (error) {
    console.error('[Web3Balances] Balance check failed:', error);
    return {
      hasSufficient: false,
      available: 0,
      required: parseFloat(amount) || 0,
      error: error.message,
    };
  }
};

export default {
  fetchPublicBalances,
  fetchTokenBalance,
  getShieldableTokens,
  refreshTokenBalance,
  checkSufficientBalance,
}; 