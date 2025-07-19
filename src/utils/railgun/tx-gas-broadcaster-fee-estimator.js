/**
 * RAILGUN Transaction Gas and Broadcaster Fee Estimator - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-gas-broadcaster-fee-estimator.ts
 * Converted to JavaScript with iterative gas estimation for broadcaster transactions
 */

import {
  NetworkName,
  TransactionGasDetails,
  BroadcasterFeeInfo,
  SelectedBroadcaster,
  RailgunERC20AmountRecipient,
  isDefined,
} from '@railgun-community/shared-models';
import { createGasDetails, validateGasDetails, calculateTransactionCost } from './tx-gas-details.js';
import { shouldSetOverallBatchMinGasPriceForNetwork } from './gasUtils.js';

/**
 * Maximum iterations for gas estimation convergence
 */
const MAX_GAS_ESTIMATION_ITERATIONS = 5;

/**
 * Gas estimation tolerance (1% change)
 */
const GAS_ESTIMATION_TOLERANCE = 0.01;

/**
 * Default broadcaster fee percentages by network
 */
const DEFAULT_BROADCASTER_FEE_BASIS_POINTS = {
  [NetworkName.Ethereum]: 25, // 0.25%
  [NetworkName.Arbitrum]: 50, // 0.5%
  [NetworkName.Polygon]: 50, // 0.5%
  [NetworkName.BNBChain]: 50, // 0.5%
};

/**
 * Minimum broadcaster fees in wei by network
 */
const MINIMUM_BROADCASTER_FEES = {
  [NetworkName.Ethereum]: BigInt(5000000000000000), // 0.005 ETH
  [NetworkName.Arbitrum]: BigInt(1000000000000000), // 0.001 ETH
  [NetworkName.Polygon]: BigInt(10000000000000000000), // 10 MATIC
  [NetworkName.BNBChain]: BigInt(1000000000000000000), // 1 BNB
};

/**
 * Calculate broadcaster fee for transaction
 * @param {NetworkName} networkName - Network name
 * @param {TransactionGasDetails} gasDetails - Gas details
 * @param {number} feeBasisPoints - Fee in basis points (100 = 1%)
 * @returns {BroadcasterFeeInfo} Broadcaster fee information
 */
export const calculateBroadcasterFee = (networkName, gasDetails, feeBasisPoints = null) => {
  try {
    const basisPoints = feeBasisPoints || DEFAULT_BROADCASTER_FEE_BASIS_POINTS[networkName] || 25;
    const transactionCost = calculateTransactionCost(gasDetails);
    
    // Calculate fee as percentage of transaction cost
    const calculatedFee = (transactionCost * BigInt(basisPoints)) / BigInt(10000);
    
    // Apply minimum fee
    const minimumFee = MINIMUM_BROADCASTER_FEES[networkName] || BigInt(0);
    const broadcasterFee = calculatedFee > minimumFee ? calculatedFee : minimumFee;

    console.log(`[BroadcasterFee] Calculated broadcaster fee for ${networkName}:`, {
      transactionCost: transactionCost.toString(),
      basisPoints,
      calculatedFee: calculatedFee.toString(),
      minimumFee: minimumFee.toString(),
      finalFee: broadcasterFee.toString(),
    });

    return {
      feePerUnitGas: broadcasterFee / gasDetails.gasEstimate,
      feeAmount: broadcasterFee,
      tokenAddress: undefined, // Native token for fees
    };

  } catch (error) {
    console.error('[BroadcasterFee] Failed to calculate broadcaster fee:', error);
    throw new Error(`Broadcaster fee calculation failed: ${error.message}`);
  }
};

/**
 * Estimate gas with broadcaster fee consideration - Iterative approach
 * @param {NetworkName} networkName - Network name
 * @param {Function} gasEstimateFunction - Function to get gas estimate
 * @param {Object} gasEstimateParams - Parameters for gas estimation
 * @param {SelectedBroadcaster} selectedBroadcaster - Selected broadcaster (optional)
 * @param {string} transactionType - Transaction type for gas multiplier
 * @returns {Object} Gas estimate with broadcaster fee details
 */
export const estimateGasWithBroadcasterFee = async (
  networkName,
  gasEstimateFunction,
  gasEstimateParams,
  selectedBroadcaster = null,
  transactionType = 'shield'
) => {
  try {
    const sendWithPublicWallet = !selectedBroadcaster;
    
    console.log(`[BroadcasterFeeEstimator] Starting iterative gas estimation for ${transactionType} on ${networkName}:`, {
      sendWithPublicWallet,
      hasBroadcaster: !!selectedBroadcaster,
      maxIterations: MAX_GAS_ESTIMATION_ITERATIONS,
    });

    let currentGasEstimate = BigInt(0);
    let currentGasDetails = null;
    let currentBroadcasterFee = null;
    let iteration = 0;

    // Initial gas estimation without broadcaster fee
    console.log(`[BroadcasterFeeEstimator] Iteration ${iteration}: Initial estimation`);
    const initialEstimate = await gasEstimateFunction(...gasEstimateParams);
    currentGasEstimate = BigInt(initialEstimate.gasEstimate || initialEstimate);

    // Create initial gas details
    currentGasDetails = createGasDetails(
      networkName,
      sendWithPublicWallet,
      currentGasEstimate,
      transactionType
    );

    console.log(`[BroadcasterFeeEstimator] Initial gas estimate: ${currentGasEstimate.toString()}`);

    // If no broadcaster, return initial estimate
    if (sendWithPublicWallet) {
      console.log('[BroadcasterFeeEstimator] Public wallet transaction, no broadcaster fee needed');
      return {
        gasDetails: currentGasDetails,
        broadcasterFeeInfo: null,
        iterations: iteration,
      };
    }

    // Iterative estimation with broadcaster fee
    for (iteration = 1; iteration <= MAX_GAS_ESTIMATION_ITERATIONS; iteration++) {
      console.log(`[BroadcasterFeeEstimator] Iteration ${iteration}: Refining with broadcaster fee`);
      
      // Calculate broadcaster fee based on current gas details
      currentBroadcasterFee = calculateBroadcasterFee(
        networkName,
        currentGasDetails,
        selectedBroadcaster?.feePerUnitGas ? null : undefined
      );

      // Update gas estimation parameters to include broadcaster fee
      const updatedParams = updateGasEstimateParamsWithBroadcasterFee(
        gasEstimateParams,
        currentBroadcasterFee
      );

      // Get new gas estimate with broadcaster fee included
      const refinedEstimate = await gasEstimateFunction(...updatedParams);
      const newGasEstimate = BigInt(refinedEstimate.gasEstimate || refinedEstimate);

      console.log(`[BroadcasterFeeEstimator] Iteration ${iteration} results:`, {
        previousGasEstimate: currentGasEstimate.toString(),
        newGasEstimate: newGasEstimate.toString(),
        broadcasterFee: currentBroadcasterFee.feeAmount.toString(),
      });

      // Check for convergence
      const gasChange = Number(newGasEstimate - currentGasEstimate) / Number(currentGasEstimate);
      const hasConverged = Math.abs(gasChange) < GAS_ESTIMATION_TOLERANCE;

      if (hasConverged) {
        console.log(`[BroadcasterFeeEstimator] Converged after ${iteration} iterations (change: ${(gasChange * 100).toFixed(2)}%)`);
        break;
      }

      // Update for next iteration
      currentGasEstimate = newGasEstimate;
      currentGasDetails = createGasDetails(
        networkName,
        sendWithPublicWallet,
        currentGasEstimate,
        transactionType
      );

      if (iteration === MAX_GAS_ESTIMATION_ITERATIONS) {
        console.warn(`[BroadcasterFeeEstimator] Max iterations reached without convergence`);
      }
    }

    // Final validation
    const finalGasDetails = validateGasDetails(currentGasDetails, networkName, transactionType);

    console.log(`[BroadcasterFeeEstimator] Final estimation complete:`, {
      finalGasEstimate: finalGasDetails.gasEstimate.toString(),
      finalBroadcasterFee: currentBroadcasterFee?.feeAmount.toString(),
      totalIterations: iteration,
    });

    return {
      gasDetails: finalGasDetails,
      broadcasterFeeInfo: currentBroadcasterFee,
      iterations: iteration,
    };

  } catch (error) {
    console.error('[BroadcasterFeeEstimator] Gas estimation with broadcaster fee failed:', error);
    throw new Error(`Gas estimation with broadcaster fee failed: ${error.message}`);
  }
};

/**
 * Update gas estimate parameters to include broadcaster fee
 * @param {Array} originalParams - Original gas estimation parameters
 * @param {BroadcasterFeeInfo} broadcasterFee - Broadcaster fee information
 * @returns {Array} Updated parameters with broadcaster fee
 */
const updateGasEstimateParamsWithBroadcasterFee = (originalParams, broadcasterFee) => {
  // This is a simplified approach - in practice, you'd need to modify
  // the transaction parameters to include the broadcaster fee
  // The exact implementation depends on the specific gas estimation function
  
  console.log('[BroadcasterFeeEstimator] Updating gas estimation parameters with broadcaster fee:', {
    feeAmount: broadcasterFee.feeAmount.toString(),
    feePerUnitGas: broadcasterFee.feePerUnitGas.toString(),
  });

  // For now, return original params - this would need to be customized
  // based on how your specific gas estimation functions handle broadcaster fees
  return originalParams;
};

/**
 * Calculate overall batch minimum gas price for network
 * @param {NetworkName} networkName - Network name
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {TransactionGasDetails} gasDetails - Gas details
 * @returns {BigInt|undefined} Overall batch minimum gas price or undefined
 */
export const calculateOverallBatchMinGasPrice = (networkName, sendWithPublicWallet, gasDetails) => {
  try {
    if (!shouldSetOverallBatchMinGasPriceForNetwork(sendWithPublicWallet, networkName)) {
      return undefined;
    }

    // For broadcaster transactions, calculate minimum gas price
    const { evmGasType } = gasDetails;
    
    switch (evmGasType) {
      case 'Type0':
      case 'Type1':
        return gasDetails.gasPrice;
      case 'Type2':
        return gasDetails.maxFeePerGas;
      default:
        return undefined;
    }

  } catch (error) {
    console.error('[BroadcasterFeeEstimator] Failed to calculate overall batch min gas price:', error);
    return undefined;
  }
};

/**
 * Estimate broadcaster fee for ERC20 amounts
 * @param {NetworkName} networkName - Network name
 * @param {RailgunERC20AmountRecipient[]} erc20AmountRecipients - ERC20 amounts
 * @param {TransactionGasDetails} gasDetails - Gas details
 * @returns {RailgunERC20AmountRecipient[]} Broadcaster fee as ERC20 amounts
 */
export const estimateBroadcasterFeeERC20Amounts = (networkName, erc20AmountRecipients, gasDetails) => {
  try {
    const broadcasterFee = calculateBroadcasterFee(networkName, gasDetails);
    
    // Return broadcaster fee as native token amount
    return [{
      tokenAddress: undefined, // Native token
      amount: broadcasterFee.feeAmount,
      recipientAddress: '0x0000000000000000000000000000000000000000', // Placeholder
    }];

  } catch (error) {
    console.error('[BroadcasterFeeEstimator] Failed to estimate broadcaster fee as ERC20 amounts:', error);
    return [];
  }
};

/**
 * Validate broadcaster selection and fee structure
 * @param {SelectedBroadcaster} selectedBroadcaster - Selected broadcaster
 * @param {NetworkName} networkName - Network name
 * @returns {boolean} Whether broadcaster is valid
 */
export const validateBroadcasterSelection = (selectedBroadcaster, networkName) => {
  try {
    if (!selectedBroadcaster) {
      return false;
    }

    // Validate broadcaster has required fields
    if (!isDefined(selectedBroadcaster.railgunAddress)) {
      throw new Error('Broadcaster must have a railgun address');
    }

    if (!isDefined(selectedBroadcaster.tokenFee)) {
      throw new Error('Broadcaster must specify token fee structure');
    }

    // Validate fee structure is reasonable
    const maxReasonableFee = 1000; // 10% max
    if (selectedBroadcaster.feePerUnitGas && selectedBroadcaster.feePerUnitGas > maxReasonableFee) {
      throw new Error('Broadcaster fee appears unreasonably high');
    }

    console.log(`[BroadcasterFeeEstimator] Validated broadcaster for ${networkName}:`, {
      railgunAddress: selectedBroadcaster.railgunAddress.slice(0, 10) + '...',
      hasTokenFee: !!selectedBroadcaster.tokenFee,
      feePerUnitGas: selectedBroadcaster.feePerUnitGas,
    });

    return true;

  } catch (error) {
    console.error('[BroadcasterFeeEstimator] Broadcaster validation failed:', error);
    return false;
  }
};

export default {
  calculateBroadcasterFee,
  estimateGasWithBroadcasterFee,
  calculateOverallBatchMinGasPrice,
  estimateBroadcasterFeeERC20Amounts,
  validateBroadcasterSelection,
}; 