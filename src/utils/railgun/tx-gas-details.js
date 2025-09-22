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
import {
  gasEstimateForUnprovenCrossContractCalls,
  gasEstimateForUnprovenUnshield,
  gasEstimateForUnprovenTransfer,
} from '@railgun-community/wallet';
import { getRelayerAddress } from './relayer-client';
import {
  calculateGasPrice,
  TXIDVersion,
} from '@railgun-community/shared-models';
import { calculateUSDValue } from '../pricing/coinGecko.js';

/**
 * Default gas values for different networks and transaction types
 */
const DEFAULT_GAS_ESTIMATES = {
  [NetworkName.Ethereum]: {
    gasPrice: BigInt(10000000000), // 10 gwei
    maxFeePerGas: BigInt(15000000000), // 15 gwei
    maxPriorityFeePerGas: BigInt(1000000000), // 1 gwei
  },
  [NetworkName.Arbitrum]: {
    gasPrice: BigInt(100000000), // 0.1 gwei
    maxFeePerGas: BigInt(100000000), // 0.1 gwei
    maxPriorityFeePerGas: BigInt(10000000), // 0.01 gwei
  },
  [NetworkName.Polygon]: {
    gasPrice: BigInt(100000000), // 0.1 gwei
    maxFeePerGas: BigInt(100000000), // 0.1 gwei
    maxPriorityFeePerGas: BigInt(10000000), // 0.01 gwei
  },
  [NetworkName.BNBChain]: {
    gasPrice: BigInt(100000000), // 0.1 gwei
    maxFeePerGas: BigInt(100000000), // 0.1 gwei
    maxPriorityFeePerGas: BigInt(10000000), // 0.01 gwei
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

/**
 * Get live fee data or sensible per-network fallback
 * @param {Object} provider - Ethers provider
 * @param {EVMGasType} evmGasType - EVM gas type
 * @param {number} chainId - Chain ID
 * @returns {Object} Fee parameters
 */
export const getTxFeeParams = async (provider, evmGasType, chainId) => {
  let feeData = null;
  try {
    feeData = await provider.getFeeData(); // { gasPrice, maxFeePerGas, maxPriorityFeePerGas }
    console.log('[GasDetails] Provider fee data:', {
      chainId,
      gasPrice: feeData?.gasPrice?.toString(),
      maxFeePerGas: feeData?.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: feeData?.maxPriorityFeePerGas?.toString(),
    });
  } catch (error) {
    console.warn('[GasDetails] Failed to get fee data from provider:', error.message);
  }

  // Helper for BigInt conversion
  const F = (wei) => BigInt(wei);

  // Network-specific fallbacks (last resort)
  const isArb = chainId === 42161;
  const isPolygon = chainId === 137;
  const isBnb = chainId === 56;

  // Keep tiny floors for L2s, higher for L1 — only if feeData is missing
  const fallbacks = {
    gasPrice: isArb || isPolygon || isBnb ? F('100000000') : F('3000000000'), // 0.1 gwei (L2) / 3 gwei (L1)
    maxFeePerGas: isArb || isPolygon || isBnb ? F('1000000000') : F('4000000000'),
    maxPriorityFeePerGas: isArb || isPolygon || isBnb ? F('10000000') : F('3000000000'),
  };

  // Cap provider fee data to reasonable maximums for L2 networks
  const maxReasonableGasPrice = isArb || isPolygon || isBnb ? F('500000000') : F('100000000000'); // 0.5 gwei (L2) / 100 gwei (L1)
  const maxReasonableMaxFeePerGas = isArb || isPolygon || isBnb ? F('1000000000') : F('200000000000'); // 1 gwei (L2) / 200 gwei (L1)

  // Create a copy of feeData since FeeData objects are read-only
  let validatedFeeData = feeData ? { ...feeData } : null;

  if (validatedFeeData) {
    if (validatedFeeData.gasPrice && validatedFeeData.gasPrice > maxReasonableGasPrice) {
      console.warn(`[GasDetails] Provider gas price too high (${validatedFeeData.gasPrice.toString()} wei > ${maxReasonableGasPrice.toString()}), using fallback`);
      validatedFeeData.gasPrice = null;
    }
    if (validatedFeeData.maxFeePerGas && validatedFeeData.maxFeePerGas > maxReasonableMaxFeePerGas) {
      console.warn(`[GasDetails] Provider maxFeePerGas too high (${validatedFeeData.maxFeePerGas.toString()} wei > ${maxReasonableMaxFeePerGas.toString()}), using fallback`);
      validatedFeeData.maxFeePerGas = null;
      validatedFeeData.maxPriorityFeePerGas = null;
    }
  }

  if (evmGasType === EVMGasType.Type2) {
    const maxFeePerGas = validatedFeeData?.maxFeePerGas ?? fallbacks.maxFeePerGas;
    let maxPriorityFeePerGas = validatedFeeData?.maxPriorityFeePerGas ?? fallbacks.maxPriorityFeePerGas;
    if (maxPriorityFeePerGas > maxFeePerGas) {
      maxPriorityFeePerGas = maxFeePerGas / 2n;
    }
    console.log(`[GasDetails] Final fee params for ${chainId}: maxFeePerGas=${maxFeePerGas.toString()}, maxPriorityFeePerGas=${maxPriorityFeePerGas.toString()}`);
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  // Legacy Type0/1
  const gasPrice = validatedFeeData?.gasPrice ?? fallbacks.gasPrice;
  console.log(`[GasDetails] Final fee params for ${chainId}: gasPrice=${gasPrice.toString()}`);
  return { gasPrice };
};

/**
 * Build gas details using SDK estimation + live fee data
 * One true source of gas: estimate → pad → reuse for populate + submit + reclamation
 * @param {Object} params - Parameters
 * @returns {Object} Gas details and estimates
 */
export const buildGasAndEstimate = async ({
  mode, // 'relayadapt' | 'self'
  chainId,
  networkName,
  railgunWalletID,
  encryptionKey,
  relayAdaptUnshieldERC20Amounts,
  crossContractCalls,
  erc20AmountRecipients,
  feeTokenDetails,
  sendWithPublicWallet,
  walletProvider,
}) => {
  try {
    const signer = await walletProvider();
    const provider = signer.provider;

    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    const originalFeeParams = await getTxFeeParams(provider, evmGasType, chainId);

    // Create originalGasDetails for SDK estimate
    const originalGasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            originalGasEstimate: 0n,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas
          }
        : {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice: originalFeeParams.gasPrice
          };

    // SDK dummy estimate (the "dry run")
    let gasEstimate;
    if (mode === 'relayadapt') {
      const res = await gasEstimateForUnprovenCrossContractCalls(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        relayAdaptUnshieldERC20Amounts,
        [], [], [], // empty arrays for nftAmounts, shieldERC20Recipients, shieldNFTRecipients
        crossContractCalls,
        originalGasDetails,
        feeTokenDetails,
        sendWithPublicWallet,
        1600000n, // min gas floor
      );
      gasEstimate = res.gasEstimate;
    } else {
      const res = await gasEstimateForUnprovenUnshield(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        [], // nftAmountRecipients
        originalGasDetails,
        null, // feeTokenDetails not needed for self-signing
        sendWithPublicWallet,
      );
      gasEstimate = res.gasEstimate;
    }

    // Pad estimate for headroom (same padding reused for populate + submit)
    const paddedGasEstimate = (gasEstimate * 120n) / 100n;

    // Compute batch min gas price (SDK helper)
    const overallBatchMinGasPrice = await calculateGasPrice({
      evmGasType,
      gasEstimate,
      gasPrice: originalFeeParams.gasPrice,
      maxFeePerGas: originalFeeParams.maxFeePerGas,
      maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
    });

    // Final gasDetails to pass into populate()
    const gasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
          }
        : {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            gasPrice: originalFeeParams.gasPrice,
          };

    console.log('[GasDetails] Using SDK estimate + live fee data', {
      chainId,
      mode,
      evmGasType,
      gasEstimate: gasEstimate.toString(),
      paddedGasEstimate: paddedGasEstimate.toString(),
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      ...gasDetails,
    });

    return { gasDetails, paddedGasEstimate, overallBatchMinGasPrice, accurateGasEstimate: gasEstimate };

  } catch (error) {
    console.error('[GasDetails] Failed to build gas and estimate:', error);
    throw new Error(`Failed to build gas and estimate: ${error.message}`);
  }
};

/**
 * Compute gas reclamation in wei using the exact same gas details used for the transaction
 * @param {TransactionGasDetails} gasDetails - Gas details used in populate/submit
 * @returns {BigInt} Gas cost in wei
 */
export const computeGasReclamationWei = (gasDetails) => {
  try {
    const gasLimit = gasDetails.gasEstimate;
    const price =
      'gasPrice' in gasDetails
        ? gasDetails.gasPrice  // Legacy Type0/1
        : gasDetails.maxFeePerGas; // Conservative: use maxFeePerGas on EIP-1559

    return gasLimit * price; // Wei
  } catch (error) {
    console.error('[GasDetails] Failed to compute gas reclamation:', error);
    return 0n;
  }
};

/**
 * Get the gas token symbol for a given chain
 * @param {number} chainId - Chain ID
 * @returns {string} Gas token symbol
 */
const getGasTokenSymbol = (chainId) => {
  switch (chainId) {
    case 1: // Ethereum
      return 'ETH';
    case 137: // Polygon
      return 'MATIC';
    case 56: // BNB Chain
      return 'BNB';
    case 42161: // Arbitrum
    case 10: // Optimism
    case 42170: // Arbitrum Nova
      return 'ETH'; // L2s use ETH for gas
    default:
      console.warn(`[GasEstimation] Unknown chain ID ${chainId}, defaulting to ETH`);
      return 'ETH';
  }
};

/**
 * Estimate gas costs for unshield/transfer operations using dummy transactions
 * This can be called from UI components before proof generation to show estimated fees
 * @param {Object} params - Estimation parameters
 * @returns {Object} Gas cost estimates in USD and native token
 */
export const estimateGasForTransaction = async ({
  transactionType, // 'unshield' | 'transfer'
  chainId,
  networkName,
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount, // BigInt amount in token units
  recipientAddress, // For transfer operations
  walletProvider,
}) => {
  try {
    console.log(`[GasEstimation] Estimating gas for ${transactionType} transaction:`, {
      chainId,
      networkName,
      tokenAddress,
      amount: amount.toString(),
      recipientAddress: recipientAddress?.substring(0, 20) + '...'
    });

    const signer = await walletProvider();
    const provider = signer.provider;

    // For gas estimation, we need sendWithPublicWallet = true for self-signing
    // This is required by RAILGUN SDK for gas estimation
    const sendWithPublicWallet = true;

    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);

    // Use current provider gas prices, but cap them to reasonable maximums
    // This gives more accurate estimates than hardcoded defaults
    const originalFeeParams = await getTxFeeParams(provider, evmGasType, chainId);

    // Create originalGasDetails for SDK estimate
    const originalGasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            originalGasEstimate: 0n,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas
          }
        : {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice: originalFeeParams.gasPrice
          };

    let gasEstimate;

    if (transactionType === 'unshield') {
      // Use unshield gas estimation - use minimal amount to avoid balance checks
      const estimationAmount = 1n; // Use 1 unit for gas estimation (minimal amount)
      const res = await gasEstimateForUnprovenUnshield(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        [{
          tokenAddress,
          amount: estimationAmount, // Use minimal amount for estimation
          recipientAddress: (await walletProvider()).address, // User's EOA address
        }],
        [], // nftAmountRecipients
        originalGasDetails,
        null, // feeTokenDetails not needed for self-signing
        sendWithPublicWallet,
      );
      gasEstimate = res.gasEstimate;

    } else if (transactionType === 'transfer') {
      // Use transfer gas estimation - use relayer RAILGUN address for estimation
      // (since we're just estimating gas, the actual recipient validation happens later)
      const relayerAddress = await getRelayerAddress();
      const estimationAmount = 1n; // Use 1 unit for gas estimation (minimal amount)

      const res = await gasEstimateForUnprovenTransfer(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        '', // memoText
        [{
          tokenAddress,
          amount: estimationAmount, // Use smaller amount for estimation
          recipientAddress: relayerAddress, // Use relayer address for gas estimation
        }],
        [], // nftAmountRecipients
        originalGasDetails,
        null, // feeTokenDetails not needed for gas estimation
        sendWithPublicWallet,
      );
      gasEstimate = res.gasEstimate;
    } else {
      throw new Error(`Unsupported transaction type: ${transactionType}`);
    }

    // Pad estimate for headroom (same as buildGasAndEstimate)
    const paddedGasEstimate = (gasEstimate * 120n) / 100n;

    // Create final gas details
    const gasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
          }
        : {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            gasPrice: originalFeeParams.gasPrice,
          };

    // Calculate gas cost in wei
    const gasCostWei = calculateTransactionCost(gasDetails);

    // Get the correct gas token symbol for this chain
    const gasTokenSymbol = getGasTokenSymbol(chainId);
    const gasDecimals = gasTokenSymbol === 'ETH' || gasTokenSymbol === 'BNB' ? 18 : 18; // Most tokens are 18 decimals

    // Convert to native gas token amount and USD using dynamic CoinGecko pricing
    const gasCostNative = Number(gasCostWei) / Math.pow(10, gasDecimals);
    const gasTokenPriceUSD = await calculateUSDValue(gasTokenSymbol, 1);
    const gasCostUSD = gasCostNative * parseFloat(gasTokenPriceUSD.replace(/[$,]/g, ''));

    // Add 10% buffer to displayed gas fees for safety (reduced since we now use current prices)
    const bufferedGasCostUSD = gasCostUSD * 1.1;
    const bufferedGasCostNative = gasCostNative * 1.1;

    console.log(`[GasEstimation] Gas estimation complete for ${transactionType}:`, {
      chainId,
      gasToken: gasTokenSymbol,
      gasEstimate: gasEstimate.toString(),
      paddedGasEstimate: paddedGasEstimate.toString(),
      gasCostWei: gasCostWei.toString(),
      gasCostNative: gasCostNative.toFixed(6),
      gasCostUSD: gasCostUSD.toFixed(2),
      bufferedGasCostUSD: bufferedGasCostUSD.toFixed(2),
      bufferedGasCostNative: bufferedGasCostNative.toFixed(6),
      bufferPercentage: '10%'
    });

    return {
      gasCostUSD: bufferedGasCostUSD.toFixed(2),
      gasCostNative: bufferedGasCostNative.toFixed(6),
      gasToken: gasTokenSymbol,
      gasEstimate: paddedGasEstimate.toString(),
      evmGasType,
    };

  } catch (error) {
    console.error(`[GasEstimation] Failed to estimate gas for ${transactionType}:`, error);
    // Return fallback estimates with 20% buffer
    const gasTokenSymbol = getGasTokenSymbol(chainId);
    return {
      gasCostUSD: '6.00', // Conservative fallback with 20% buffer
      gasCostNative: '0.002000', // Conservative fallback with 20% buffer
      gasToken: gasTokenSymbol,
      gasEstimate: '2000000',
      evmGasType: EVMGasType.Type2,
      error: error.message
    };
  }
};

export { DEFAULT_GAS_ESTIMATES };

export default {
  validateGasDetails,
  createGasDetails,
  createShieldGasDetails,
  createUnshieldGasDetails,
  createCrossContractGasDetails,
  getRecommendedGasPrice,
  shouldIncludeOverallBatchMinGasPrice,
  calculateTransactionCost,
  getTxFeeParams,
  buildGasAndEstimate,
  computeGasReclamationWei,
  estimateGasForTransaction,
  DEFAULT_GAS_ESTIMATES,
}; 