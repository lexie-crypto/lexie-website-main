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

/**
 * Default gas values for different networks and transaction types
 */
const DEFAULT_GAS_ESTIMATES = {
  [NetworkName.Ethereum]: {
    gasPrice: BigInt(20000000000), // 20 gwei
    maxFeePerGas: BigInt(25000000000), // 25 gwei  
    maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
  },
  [NetworkName.Arbitrum]: {
    gasPrice: BigInt(100000000), // 0.1 gwei
    maxFeePerGas: BigInt(150000000), // 0.15 gwei
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

    // Apply gas limit multiplier for safety only when gas prices are present
    // When no gas prices are set (letting MetaMask handle pricing), use accurate estimate
    const hasGasPrices = 'gasPrice' in gasDetails || 'maxFeePerGas' in gasDetails;
    const multiplier = hasGasPrices ? (GAS_LIMIT_MULTIPLIERS[transactionType] || 1.2) : 1.0;
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
  } catch (error) {
    console.warn('[GasDetails] Failed to get fee data from provider, using hardcoded fallbacks:', error.message);
    // Note: RPC fallback removed as it was returning inflated gas prices compared to market rates
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
    maxFeePerGas: isArb ? F('150000000') : isPolygon || isBnb ? F('500000000') : F('4000000000'), // 0.15 gwei (Arb) / 0.5 gwei (L2) / 4 gwei (L1)
    maxPriorityFeePerGas: isArb ? F('10000000') : isPolygon || isBnb ? F('30000000') : F('3000000000'), // 0.01 gwei (Arb) / 0.03 gwei (L2) / 3 gwei (L1)
  };

  if (evmGasType === EVMGasType.Type2) {
    const maxFeePerGas = feeData?.maxFeePerGas ?? fallbacks.maxFeePerGas;
    let maxPriorityFeePerGas = feeData?.maxPriorityFeePerGas ?? fallbacks.maxPriorityFeePerGas;
    if (maxPriorityFeePerGas > maxFeePerGas) {
      maxPriorityFeePerGas = maxFeePerGas / 2n;
    }
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  // Legacy Type0/1
  const gasPrice = feeData?.gasPrice ?? fallbacks.gasPrice;
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

    // Compute gasCostWei once using padded estimate and guarded gas price (single source of truth)
    const gasCostWei = paddedGasEstimate * (evmGasType === EVMGasType.Type2 ?
      (originalFeeParams.maxFeePerGas > originalFeeParams.maxPriorityFeePerGas ?
        originalFeeParams.maxFeePerGas : originalFeeParams.maxPriorityFeePerGas) :
      originalFeeParams.gasPrice);

    console.log('[GasDetails] Single gas cost source computed:', {
      paddedGasEstimate: paddedGasEstimate.toString(),
      gasPrice: evmGasType === EVMGasType.Type2 ?
        `maxFee:${originalFeeParams.maxFeePerGas?.toString()} pri:${originalFeeParams.maxPriorityFeePerGas?.toString()}` :
        originalFeeParams.gasPrice?.toString(),
      gasCostWei: gasCostWei.toString(),
      note: 'This gasCostWei is used for both preview fees and proof baking'
    });

    return {
      gasDetails,
      paddedGasEstimate,
      overallBatchMinGasPrice,
      accurateGasEstimate: gasEstimate,
      gasCostWei // Single source for gas reclamation calculations
    };

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

    const baseCost = gasLimit * price; // Base wei cost
    const reclamationCost = (baseCost * 120n) / 100n; // Add 20% multiplier for fee reclamation

    console.log('[GasDetails] Computed gas reclamation with 20% multiplier:', {
      gasLimit: gasLimit.toString(),
      price: price.toString(),
      baseCost: baseCost.toString(),
      reclamationCost: reclamationCost.toString(),
      multiplier: '1.2x'
    });

    return reclamationCost;
  } catch (error) {
    console.error('[GasDetails] Failed to compute gas reclamation:', error);
    return 0n;
  }
};

/**
 * Estimate gas costs for unshield/transfer operations using dummy transactions
 * This can be called from UI components before proof generation to show estimated fees
 * @param {Object} params - Estimation parameters
 * @returns {Object} Gas cost estimates in USD and ETH
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

    // Use hardcoded gas limit instead of SDK dummy transactions
    const gasLimit = 1200000n; // 1.2M gas limit

    // Get current gas prices from RPC provider
    const gasPrices = await fetchGasPricesFromRPC(chainId);

    // Calculate gas cost based on gas type
    const evmGasType = getEVMGasTypeForTransaction(networkName, true); // Assume self-signing for estimation

    let gasCostWei;
    if (evmGasType === EVMGasType.Type2) {
      // EIP-1559: use maxFeePerGas
      gasCostWei = gasLimit * gasPrices.maxFeePerGas;
    } else {
      // Legacy: use gasPrice
      gasCostWei = gasLimit * gasPrices.gasPrice;
    }

    // Determine native gas token symbol for this chain
    const NATIVE_GAS_TOKENS = {
      1: 'ETH',      // Ethereum
      137: 'MATIC',  // Polygon
      56: 'BNB',     // BSC
      42161: 'ETH',  // Arbitrum (uses ETH)
    };
    const nativeGasToken = NATIVE_GAS_TOKENS[chainId] || 'ETH';

    // Convert to native gas token amount and get real USD cost from CoinGecko
    const gasCostNative = Number(gasCostWei) / 1e18; // All chains use 18 decimals for gas
    const { fetchTokenPrices } = await import('../pricing/coinGecko.js');
    const prices = await fetchTokenPrices([nativeGasToken]);
    const tokenPrice = prices[nativeGasToken] || (nativeGasToken === 'ETH' ? 3000 : 1); // Fallback prices
    const gasCostUSD = gasCostNative * tokenPrice;

    console.log(`[GasEstimation] Simple gas estimation result:`, {
      chainId,
      nativeGasToken,
      gasLimit: gasLimit.toString(),
      gasCostWei: gasCostWei.toString(),
      gasCostNative: gasCostNative.toFixed(8),
      tokenPrice: tokenPrice.toFixed(4),
      gasCostUSD: gasCostUSD.toFixed(4),
      evmGasType,
      method: 'hardcoded-limit-rpc-prices-coingecko'
    });

    return {
      gasCostUSD: gasCostUSD.toFixed(2),
      gasCostNative: gasCostNative.toFixed(6),
      nativeGasToken,
      gasEstimate: gasLimit.toString(),
      evmGasType,
    };

  } catch (error) {
    console.error(`[GasEstimation] Failed to estimate gas for ${transactionType}:`, error);
    // Return fallback estimates
    const fallbackToken = { 1: 'ETH', 137: 'MATIC', 56: 'BNB', 42161: 'ETH' }[chainId] || 'ETH';
    return {
      gasCostUSD: '0.12',
      gasCostNative: '0.00004167',
      nativeGasToken: fallbackToken,
      gasEstimate: '1200000',
      evmGasType: EVMGasType.Type2,
      error: error.message
    };
  }
};

/**
 * Fetch current gas prices from RPC provider
 */
export const fetchGasPricesFromRPC = async (chainId) => {
  try {
    const rpcUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/rpc?chainId=${chainId}&provider=auto`;

    // Try eth_gasPrice first (works on most networks)
    try {
      const gasPriceResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_gasPrice',
          params: [],
          id: 1
        })
      });

      if (gasPriceResponse.ok) {
        const gasPriceData = await gasPriceResponse.json();
        const gasPrice = BigInt(gasPriceData.result);

        return {
          gasPrice,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice / 10n // Conservative priority fee
        };
      }
    } catch (gasPriceError) {
      console.warn('[GasEstimation] eth_gasPrice failed:', gasPriceError.message);
    }

    // Fallback to eth_feeHistory for EIP-1559 networks
    try {
      const feeHistoryResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_feeHistory',
          params: [1, 'latest', [10, 50, 90]], // 1 block, latest, priority fee percentiles
          id: 2
        })
      });

      if (feeHistoryResponse.ok) {
        const feeHistoryData = await feeHistoryResponse.json();
        const baseFee = BigInt(feeHistoryData.result.baseFeePerGas[0]);
        const priorityFee = BigInt(feeHistoryData.result.reward[0][1]); // 50th percentile

        return {
          gasPrice: baseFee + priorityFee,
          maxFeePerGas: baseFee + priorityFee,
          maxPriorityFeePerGas: priorityFee
        };
      }
    } catch (feeHistoryError) {
      console.warn('[GasEstimation] eth_feeHistory failed:', feeHistoryError.message);
    }

    // Final fallback to hardcoded values
    console.warn('[GasEstimation] All RPC gas price methods failed, using hardcoded fallbacks');
    return {
      gasPrice: 20000000000n, // 20 gwei
      maxFeePerGas: 25000000000n, // 25 gwei
      maxPriorityFeePerGas: 2000000000n // 2 gwei
    };

  } catch (error) {
    console.error('[GasEstimation] Failed to fetch gas prices from RPC:', error);
    // Return safe fallback values
    return {
      gasPrice: 20000000000n,
      maxFeePerGas: 25000000000n,
      maxPriorityFeePerGas: 2000000000n
    };
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
  getTxFeeParams,
  buildGasAndEstimate,
  computeGasReclamationWei,
  estimateGasForTransaction,
}; 