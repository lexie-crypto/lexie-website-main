/**
 * Fee Reclamation System - Official RAILGUN Approach
 * Recovers gas costs and profit from user transactions
 */

import { NetworkName } from '@railgun-community/shared-models';
import { calculateTransactionCost, calculateTokenFeeAmount, getFeeConfig } from './tx-gas-details.js';

/**
 * Fee Reclamation Manager
 * Handles calculating and deducting fees from transactions
 */
export class FeeReclamationManager {
  constructor() {
    this.priceCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Calculate fee amount to deduct from user's transaction
   * @param {Object} params - Fee calculation parameters
   * @returns {Object} Fee calculation result
   */
  async calculateTransactionFee({
    gasDetails,
    networkName,
    tokenAddress,
    tokenPrice,
    ethPrice,
    tokenDecimals = 6,
    transactionType = 'shield'
  }) {
    try {
      console.log('[FeeReclamation] Calculating transaction fee:', {
        networkName,
        tokenAddress,
        tokenPrice,
        ethPrice,
        tokenDecimals,
        transactionType
      });

      // Get fee configuration for network
      const feeConfig = getFeeConfig(networkName);

      // Calculate gas cost using official RAILGUN approach
      const gasCostWei = calculateTransactionCost(gasDetails, {
        gasEstimateLimitToActualRatio: feeConfig.gasEstimateLimitToActualRatio,
        profitMargin: feeConfig.profitMargin
      });

      if (gasCostWei === 0n) {
        console.warn('[FeeReclamation] Gas cost calculation failed');
        return { feeAmount: 0n, feeBreakdown: null };
      }

      // Convert gas cost to token amount
      const feeAmount = calculateTokenFeeAmount(
        gasCostWei,
        tokenPrice,
        ethPrice,
        tokenDecimals
      );

      // Apply minimum and maximum fee limits
      const gasCostEth = Number(gasCostWei) / 1e18;
      const gasCostUsd = gasCostEth * ethPrice;
      const minFeeAmount = BigInt(Math.ceil(feeConfig.minimumFeeUsd / tokenPrice * Math.pow(10, tokenDecimals)));
      const maxFeeAmount = BigInt(Math.ceil(feeConfig.maximumFeeUsd / tokenPrice * Math.pow(10, tokenDecimals)));

      let finalFeeAmount = feeAmount;
      if (finalFeeAmount < minFeeAmount) {
        finalFeeAmount = minFeeAmount;
        console.log('[FeeReclamation] Applied minimum fee:', {
          calculated: feeAmount.toString(),
          minimum: minFeeAmount.toString()
        });
      } else if (finalFeeAmount > maxFeeAmount) {
        finalFeeAmount = maxFeeAmount;
        console.log('[FeeReclamation] Applied maximum fee cap:', {
          calculated: feeAmount.toString(),
          maximum: maxFeeAmount.toString()
        });
      }

      const feeBreakdown = {
        gasCostWei: gasCostWei.toString(),
        gasCostEth,
        gasCostUsd,
        tokenPrice,
        ethPrice,
        profitMargin: feeConfig.profitMargin,
        gasEstimateLimitToActualRatio: feeConfig.gasEstimateLimitToActualRatio,
        calculatedFeeAmount: feeAmount.toString(),
        finalFeeAmount: finalFeeAmount.toString(),
        networkName,
        tokenAddress,
        tokenDecimals
      };

      console.log('[FeeReclamation] Fee calculation completed:', feeBreakdown);

      return {
        feeAmount: finalFeeAmount,
        feeBreakdown
      };

    } catch (error) {
      console.error('[FeeReclamation] Fee calculation failed:', error);
      return { feeAmount: 0n, feeBreakdown: null };
    }
  }

  /**
   * Get current token prices (with caching)
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} Price data
   */
  async getTokenPrices(tokenAddress) {
    try {
      const cacheKey = tokenAddress.toLowerCase();
      const cached = this.priceCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        return cached.prices;
      }

      // For now, return hardcoded prices (replace with real API calls)
      const prices = await this.getHardcodedPrices(tokenAddress);

      this.priceCache.set(cacheKey, {
        prices,
        timestamp: Date.now()
      });

      return prices;
    } catch (error) {
      console.error('[FeeReclamation] Failed to get token prices:', error);
      return { tokenPrice: 1.00, ethPrice: 3000.00 }; // Safe defaults
    }
  }

  /**
   * Get hardcoded prices for common tokens (temporary solution)
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<Object>} Price data
   */
  async getHardcodedPrices(tokenAddress) {
    const address = tokenAddress.toLowerCase();

    // Common token prices (update these regularly)
    const tokenPrices = {
      // USDC (Ethereum)
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // USDT (Ethereum)
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // DAI (Ethereum)
      '0x6b175474e89094c44da98b954eedeac495271d0f': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // USDC (Polygon)
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // USDT (Polygon)
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // USDC (Arbitrum)
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // USDT (Arbitrum)
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { tokenPrice: 1.00, ethPrice: 3000.00 },
      // Default for unknown tokens
      'default': { tokenPrice: 1.00, ethPrice: 3000.00 }
    };

    return tokenPrices[address] || tokenPrices.default;
  }

  /**
   * Clear price cache
   */
  clearCache() {
    this.priceCache.clear();
    console.log('[FeeReclamation] Price cache cleared');
  }
}

// Singleton instance
export const feeReclamationManager = new FeeReclamationManager();

/**
 * Convenience function for calculating transaction fees
 * @param {Object} params - Fee calculation parameters
 * @returns {Promise<Object>} Fee calculation result
 */
export const calculateFeeForTransaction = async (params) => {
  return await feeReclamationManager.calculateTransactionFee(params);
};

/**
 * Get fee configuration for a network
 * @param {NetworkName} networkName - Network name
 * @returns {Object} Fee configuration
 */
export const getNetworkFeeConfig = (networkName) => {
  return getFeeConfig(networkName);
};

export default {
  FeeReclamationManager,
  feeReclamationManager,
  calculateFeeForTransaction,
  getNetworkFeeConfig
};
