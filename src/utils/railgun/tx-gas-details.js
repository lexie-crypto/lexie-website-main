/**
 * RAILGUN Transaction Gas Details - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-gas-details.ts
 * Converted to JavaScript with enhanced gas estimation and validation
 */

import {
  NetworkName,
  EVMGasType,
  TransactionGasDetails,
  getEVMGasTypeForTransaction,
  isDefined,
} from '@railgun-community/shared-models';
import { shouldSetOverallBatchMinGasPriceForNetwork } from './gasUtils.js';

/**
 * Default gas values for different networks and transaction types
 */
const DEFAULT_GAS_ESTIMATES = {
  [NetworkName.Ethereum]: {
    gasPrice: BigInt(15000000000), // 15 gwei (reduced from 20)
    maxFeePerGas: BigInt(30000000000), // 30 gwei (increased from 25 for better headroom)
    maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei (unchanged)
  },
  [NetworkName.Arbitrum]: {
    gasPrice: BigInt(100000000), // 0.1 gwei
    maxFeePerGas: BigInt(1000000000), // 1 gwei
    maxPriorityFeePerGas: BigInt(10000000), // 0.01 gwei
  },
  [NetworkName.Polygon]: {
    gasPrice: BigInt(30000000000), // 30 gwei
    maxFeePerGas: BigInt(40000000000), // 40 gwei
    maxPriorityFeePerGas: BigInt(30000000000), // 30 gwei
  },
  [NetworkName.BNBChain]: {
    gasPrice: BigInt(5000000000), // 5 gwei
    maxFeePerGas: BigInt(6000000000), // 6 gwei
    maxPriorityFeePerGas: BigInt(1000000000), // 1 gwei
  },
};

/**
 * Gas limit multipliers for different transaction types
 */
const GAS_LIMIT_MULTIPLIERS = {
  shield: 1.2,
  unshield: 1.3,
  transfer: 1.5,
  crossContract: 1.8,
};

/**
 * Validate gas details for transaction type and network
 * @param {TransactionGasDetails} gasDetails - Gas details to validate
 * @param {NetworkName} networkName - Network name
 * @param {string} transactionType - Transaction type (shield, unshield, etc.)
 * @returns {TransactionGasDetails} Validated gas details
 */
export const validateGasDetails = (gasDetails, networkName, transactionType = 'shield') => {
  try {
    const evmGasType = gasDetails.evmGasType;
    
    // Validate EVM gas type
    if (!Object.values(EVMGasType).includes(evmGasType)) {
      throw new Error(`Invalid EVM gas type: ${evmGasType}`);
    }

    // Validate gas estimate
    if (!isDefined(gasDetails.gasEstimate) || gasDetails.gasEstimate <= 0n) {
      throw new Error('Gas estimate must be a positive BigInt');
    }

    // Apply gas limit multiplier for safety
    const multiplier = GAS_LIMIT_MULTIPLIERS[transactionType] || 1.2;
    const adjustedGasEstimate = BigInt(Math.ceil(Number(gasDetails.gasEstimate) * multiplier));

    // Validate gas fields based on EVM gas type
    const validatedGasDetails = {
      evmGasType,
      gasEstimate: adjustedGasEstimate,
    };

    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        if (!isDefined(gasDetails.gasPrice) || gasDetails.gasPrice <= 0n) {
          throw new Error('Gas price must be a positive BigInt for Type0/Type1 transactions');
        }
        validatedGasDetails.gasPrice = gasDetails.gasPrice;
        break;

      case EVMGasType.Type2:
        if (!isDefined(gasDetails.maxFeePerGas) || gasDetails.maxFeePerGas <= 0n) {
          throw new Error('Max fee per gas must be a positive BigInt for Type2 transactions');
        }
        if (!isDefined(gasDetails.maxPriorityFeePerGas) || gasDetails.maxPriorityFeePerGas <= 0n) {
          throw new Error('Max priority fee per gas must be a positive BigInt for Type2 transactions');
        }
        if (gasDetails.maxPriorityFeePerGas > gasDetails.maxFeePerGas) {
          throw new Error('Max priority fee per gas cannot exceed max fee per gas');
        }
        validatedGasDetails.maxFeePerGas = gasDetails.maxFeePerGas;
        validatedGasDetails.maxPriorityFeePerGas = gasDetails.maxPriorityFeePerGas;
        break;

      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }

    console.log(`[GasDetails] Validated gas details for ${transactionType} on ${networkName}:`, {
      evmGasType,
      gasEstimate: adjustedGasEstimate.toString(),
      multiplier,
      originalEstimate: gasDetails.gasEstimate.toString(),
    });

    return validatedGasDetails;

  } catch (error) {
    console.error('[GasDetails] Gas validation failed:', error);
    throw new Error(`Gas validation failed: ${error.message}`);
  }
};

/**
 * Create gas details with network-appropriate defaults
 * @param {NetworkName} networkName - Network name
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {BigInt} gasEstimate - Gas estimate
 * @param {string} transactionType - Transaction type for multiplier
 * @param {Object} customGasValues - Custom gas values to override defaults
 * @returns {TransactionGasDetails} Gas details
 */
export const createGasDetails = (
  networkName, 
  sendWithPublicWallet, 
  gasEstimate, 
  transactionType = 'shield',
  customGasValues = {}
) => {
  try {
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    const defaults = DEFAULT_GAS_ESTIMATES[networkName];
    
    if (!defaults) {
      throw new Error(`No default gas values configured for network: ${networkName}`);
    }

    // Apply gas limit multiplier
    const multiplier = GAS_LIMIT_MULTIPLIERS[transactionType] || 1.2;
    const adjustedGasEstimate = BigInt(Math.ceil(Number(gasEstimate) * multiplier));

    console.log(`[GasDetails] Creating gas details for ${networkName} (${transactionType}):`, {
      evmGasType,
      gasEstimate: gasEstimate.toString(),
      adjustedGasEstimate: adjustedGasEstimate.toString(),
      multiplier,
      sendWithPublicWallet,
    });

    let gasDetails;

    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        gasDetails = {
          evmGasType,
          gasEstimate: adjustedGasEstimate,
          gasPrice: customGasValues.gasPrice || defaults.gasPrice,
        };
        break;

      case EVMGasType.Type2:
        gasDetails = {
          evmGasType,
          gasEstimate: adjustedGasEstimate,
          maxFeePerGas: customGasValues.maxFeePerGas || defaults.maxFeePerGas,
          maxPriorityFeePerGas: customGasValues.maxPriorityFeePerGas || defaults.maxPriorityFeePerGas,
        };
        break;

      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }

    // Validate the created gas details
    return validateGasDetails(gasDetails, networkName, transactionType);

  } catch (error) {
    console.error('[GasDetails] Failed to create gas details:', error);
    throw new Error(`Failed to create gas details: ${error.message}`);
  }
};

/**
 * Create gas details for shield transactions
 * @param {NetworkName} networkName - Network name
 * @param {BigInt} gasEstimate - Gas estimate
 * @param {Object} customGasValues - Custom gas values
 * @returns {TransactionGasDetails} Gas details for shield
 */
export const createShieldGasDetails = (networkName, gasEstimate, customGasValues = {}) => {
  return createGasDetails(networkName, true, gasEstimate, 'shield', customGasValues);
};

/**
 * Create gas details for unshield transactions
 * @param {NetworkName} networkName - Network name
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {BigInt} gasEstimate - Gas estimate
 * @param {Object} customGasValues - Custom gas values
 * @returns {TransactionGasDetails} Gas details for unshield
 */
export const createUnshieldGasDetails = (networkName, sendWithPublicWallet, gasEstimate, customGasValues = {}) => {
  return createGasDetails(networkName, sendWithPublicWallet, gasEstimate, 'unshield', customGasValues);
};

/**
 * Create gas details for cross-contract calls
 * @param {NetworkName} networkName - Network name
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {BigInt} gasEstimate - Gas estimate
 * @param {Object} customGasValues - Custom gas values
 * @returns {TransactionGasDetails} Gas details for cross-contract calls
 */
export const createCrossContractGasDetails = (networkName, sendWithPublicWallet, gasEstimate, customGasValues = {}) => {
  return createGasDetails(networkName, sendWithPublicWallet, gasEstimate, 'crossContract', customGasValues);
};

/**
 * Get recommended gas price for network
 * @param {NetworkName} networkName - Network name
 * @param {EVMGasType} evmGasType - EVM gas type
 * @returns {Object} Recommended gas prices
 */
export const getRecommendedGasPrice = (networkName, evmGasType) => {
  const defaults = DEFAULT_GAS_ESTIMATES[networkName];
  
  if (!defaults) {
    throw new Error(`No gas recommendations for network: ${networkName}`);
  }

  switch (evmGasType) {
    case EVMGasType.Type0:
    case EVMGasType.Type1:
      return {
        gasPrice: defaults.gasPrice,
      };
    case EVMGasType.Type2:
      return {
        maxFeePerGas: defaults.maxFeePerGas,
        maxPriorityFeePerGas: defaults.maxPriorityFeePerGas,
      };
    default:
      throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
  }
};

/**
 * Check if gas details include overall batch min gas price
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {NetworkName} networkName - Network name
 * @returns {boolean} Whether to set overall batch min gas price
 */
export const shouldIncludeOverallBatchMinGasPrice = (sendWithPublicWallet, networkName) => {
  return shouldSetOverallBatchMinGasPriceForNetwork(sendWithPublicWallet, networkName);
};

/**
 * Calculate total transaction cost estimate
 * @param {TransactionGasDetails} gasDetails - Gas details
 * @returns {BigInt} Estimated total cost in wei
 */
export const calculateTransactionCost = (gasDetails) => {
  try {
    const { evmGasType, gasEstimate } = gasDetails;

    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        return gasEstimate * gasDetails.gasPrice;
      case EVMGasType.Type2:
        return gasEstimate * gasDetails.maxFeePerGas;
      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }
  } catch (error) {
    console.error('[GasDetails] Failed to calculate transaction cost:', error);
    return 0n;
  }
};

export default {
  validateGasDetails,
  createGasDetails,
  createShieldGasDetails,
  createUnshieldGasDetails,
  createCrossContractGasDetails,
  getRecommendedGasPrice,
  shouldIncludeOverallBatchMinGasPrice,
  calculateTransactionCost,
}; 