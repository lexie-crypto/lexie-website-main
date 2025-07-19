/**
 * RAILGUN Unified Transaction Actions - Clean API
 * Leverages the comprehensive gas utilities and transaction generators
 * 
 * This file provides a unified interface for all RAILGUN operations:
 * - Shield (Public → Private)
 * - Unshield (Private → Public) 
 * - Transfer (Private → Private)
 * - Cross-Contract Calls (DeFi Integration)
 */

import { NetworkName, TXIDVersion } from '@railgun-community/shared-models';
import {
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
} from '@railgun-community/wallet';

// Import our new modular utilities
import { shieldTokens } from './shieldTransactions.js';
import { 
  generateTransferTransaction,
  generateCrossContractTransaction,
  TransactionType,
  createERC20AmountRecipients,
  calculateTransactionTotals,
} from './tx-generator.js';
import { 
  createUnshieldGasDetails,
  createGasDetails,
  validateGasDetails,
  calculateTransactionCost,
} from './tx-gas-details.js';
import {
  estimateGasWithBroadcasterFee,
  calculateBroadcasterFee,
} from './tx-gas-broadcaster-fee-estimator.js';
import { waitForRailgunReady } from './engine.js';
import { parseTokenAmount } from './balances.js';

/**
 * Network mapping to Railgun NetworkName enum values
 */
const RAILGUN_NETWORK_NAMES = {
  1: NetworkName.Ethereum,
  42161: NetworkName.Arbitrum,
  137: NetworkName.Polygon,
  56: NetworkName.BNBChain,
};

/**
 * Get Railgun network name for a chain ID
 */
const getRailgunNetworkName = (chainId) => {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Validate Railgun address format
 */
const validateRailgunAddress = (address) => {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return address.startsWith('0zk') && address.length >= 100;
};

/**
 * Create ERC20AmountRecipient object for transactions
 */
const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  // Process token address (null/zero address becomes undefined for native tokens)
  let processedTokenAddress;
  if (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') {
    processedTokenAddress = undefined; // Native token
  } else if (tokenAddress) {
    processedTokenAddress = tokenAddress; // ERC20 token
  } else {
    processedTokenAddress = undefined;
  }

  return {
    tokenAddress: processedTokenAddress,
    amount: BigInt(amount),
    recipientAddress: recipientAddress,
  };
};

// Re-export functions as named exports
export { shieldTokens };
export { parseTokenAmount };

/**
 * UNSHIELD: Move tokens from private Railgun wallet to public wallet
 * Enhanced with comprehensive gas estimation
 */
export const unshieldTokens = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  toAddress,
  selectedBroadcaster = null,
}) => {
  try {
    console.log('[RailgunActions] Starting unshield operation:', {
      tokenAddress,
      amount,
      chainId: chain.id,
      toAddress: toAddress?.slice(0, 8) + '...',
      hasBroadcaster: !!selectedBroadcaster,
    });

    // Validate inputs
    if (!railgunWalletID || typeof railgunWalletID !== 'string') {
      throw new Error('Railgun wallet ID must be a non-empty string');
    }
    if (!encryptionKey || typeof encryptionKey !== 'string') {
      throw new Error('Encryption key must be a non-empty string');
    }
    if (!amount || typeof amount !== 'string') {
      throw new Error('Amount must be a non-empty string');
    }
    if (!chain?.id) {
      throw new Error('Chain must have an id property');
    }

    // Wait for Railgun readiness
    await waitForRailgunReady();

    // Get network configuration
    const networkName = getRailgunNetworkName(chain.id);
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    // Create recipient
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for unshield

    // Create initial gas details for estimation
    const originalGasDetails = createUnshieldGasDetails(networkName, BigInt(100000)); // Initial estimate
    
    // Enhanced gas estimation with broadcaster fee support
    const gasEstimateFunction = async (...params) => {
      return await gasEstimateForUnprovenUnshield(...params);
    };

    const gasEstimateParams = [
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      originalGasDetails,       // Missing parameter 1
      undefined,                // feeTokenDetails - optional, can be undefined
      false,                    // sendWithPublicWallet - false for private unshield
    ];

    console.log('[RailgunActions] Estimating gas for unshield...');
    const gasEstimationResult = await estimateGasWithBroadcasterFee(
      networkName,
      gasEstimateFunction,
      gasEstimateParams,
      selectedBroadcaster,
      TransactionType.UNSHIELD
    );

    const { gasDetails, broadcasterFeeInfo, iterations } = gasEstimationResult;

    console.log('[RailgunActions] Gas estimation completed:', {
      gasEstimate: gasDetails.gasEstimate.toString(),
      evmGasType: gasDetails.evmGasType,
      iterations,
      hasBroadcasterFee: !!broadcasterFeeInfo,
    });

    // Generate unshield proof
    console.log('[RailgunActions] Generating unshield proof...');
    const proofResult = await generateUnshieldProof(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    // Populate proved unshield transaction
    console.log('[RailgunActions] Populating unshield transaction...');
    const populatedTransaction = await populateProvedUnshield(
      txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    console.log('[RailgunActions] Unshield operation completed successfully');
    return {
      transaction: populatedTransaction.transaction,
      gasDetails,
      gasEstimate: gasDetails.gasEstimate,
      proofResult,
      broadcasterFeeInfo,
      gasEstimationIterations: iterations,
      transactionType: TransactionType.UNSHIELD,
      networkName,
      estimatedCost: calculateTransactionCost(gasDetails),
      metadata: {
        railgunWalletID,
        erc20Recipients: erc20AmountRecipients.length,
        nftRecipients: nftAmountRecipients.length,
      },
    };

  } catch (error) {
    console.error('[RailgunActions] Unshield operation failed:', error);
    throw new Error(`Unshield operation failed: ${error.message}`);
  }
};

/**
 * TRANSFER: Send tokens privately between Railgun wallets
 * Uses tx-generator.js for comprehensive transaction generation
 */
export const transferTokens = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  recipients, // Array of {tokenAddress, amount, recipientAddress}
  selectedBroadcaster = null,
  txConfig = {},
}) => {
  try {
    console.log('[RailgunActions] Starting private transfer:', {
      networkName,
      recipientCount: recipients?.length,
      hasBroadcaster: !!selectedBroadcaster,
    });

    // Create ERC20 amount recipients
    const erc20AmountRecipients = createERC20AmountRecipients(recipients);

    // Calculate totals for logging
    const totals = calculateTransactionTotals(erc20AmountRecipients);
    console.log('[RailgunActions] Transfer totals:', totals);

    // Use the comprehensive transaction generator
    const result = await generateTransferTransaction({
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients: [],
      selectedBroadcaster,
      gasDetails: null,
      txConfig: {
        txidVersion: TXIDVersion.V2_PoseidonMerkle,
        generateProof: true,
        validateInputs: true,
        useAdvancedGasEstimation: true,
        ...txConfig,
      },
    });

    console.log('[RailgunActions] Private transfer completed successfully');
    return {
      ...result,
      networkName,
      estimatedCost: calculateTransactionCost(result.gasDetails),
      totals,
    };

  } catch (error) {
    console.error('[RailgunActions] Private transfer failed:', error);
    throw new Error(`Private transfer failed: ${error.message}`);
  }
};

/**
 * CROSS-CONTRACT: Execute DeFi operations privately through Railgun
 * Uses tx-generator.js for comprehensive transaction generation with DeFi integration
 */
export const executeCrossContractCall = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  crossContractCalls, // Array of contract calls
  erc20AmountRecipients = [],
  selectedBroadcaster = null,
  txConfig = {},
}) => {
  try {
    console.log('[RailgunActions] Starting cross-contract call:', {
      networkName,
      contractCalls: crossContractCalls?.length,
      erc20Recipients: erc20AmountRecipients?.length,
      hasBroadcaster: !!selectedBroadcaster,
    });

    // Use the comprehensive transaction generator
    const result = await generateCrossContractTransaction({
      networkName,
      railgunWalletID,
      encryptionKey,
      crossContractCalls,
      erc20AmountRecipients,
      nftAmountRecipients: [],
      selectedBroadcaster,
      gasDetails: null,
      txConfig: {
        txidVersion: TXIDVersion.V2_PoseidonMerkle,
        generateProof: true,
        validateInputs: true,
        useAdvancedGasEstimation: true,
        ...txConfig,
      },
    });

    console.log('[RailgunActions] Cross-contract call completed successfully');
    return {
      ...result,
      networkName,
      estimatedCost: calculateTransactionCost(result.gasDetails),
    };

  } catch (error) {
    console.error('[RailgunActions] Cross-contract call failed:', error);
    throw new Error(`Cross-contract call failed: ${error.message}`);
  }
};

/**
 * UTILITY: Estimate gas for any transaction type
 */
export const estimateTransactionGas = async ({
  transactionType,
  networkName,
  parameters,
  selectedBroadcaster = null,
}) => {
  try {
    console.log('[RailgunActions] Estimating gas for transaction:', {
      transactionType,
      networkName,
      hasBroadcaster: !!selectedBroadcaster,
    });

    let gasEstimateFunction;
    let gasEstimateParams;

    // Configure based on transaction type
    switch (transactionType) {
      case TransactionType.TRANSFER:
        gasEstimateFunction = async (...params) => {
          return await import('@railgun-community/wallet').then(wallet =>
            wallet.gasEstimateForUnprovenTransfer(...params)
          );
        };
        gasEstimateParams = [
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          parameters.railgunWalletID,
          parameters.encryptionKey,
          parameters.erc20AmountRecipients,
          parameters.nftAmountRecipients || [],
        ];
        break;

      case TransactionType.CROSS_CONTRACT:
        gasEstimateFunction = async (...params) => {
          return await import('@railgun-community/wallet').then(wallet =>
            wallet.gasEstimateForUnprovenCrossContractCalls(...params)
          );
        };
        gasEstimateParams = [
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          parameters.railgunWalletID,
          parameters.encryptionKey,
          parameters.erc20AmountRecipients || [],
          parameters.nftAmountRecipients || [],
          parameters.crossContractCalls,
        ];
        break;

      default:
        throw new Error(`Unsupported transaction type: ${transactionType}`);
    }

    // Use comprehensive gas estimation
    const gasEstimationResult = await estimateGasWithBroadcasterFee(
      networkName,
      gasEstimateFunction,
      gasEstimateParams,
      selectedBroadcaster,
      transactionType
    );

    console.log('[RailgunActions] Gas estimation completed');
    return {
      ...gasEstimationResult,
      transactionType,
      networkName,
      estimatedCost: calculateTransactionCost(gasEstimationResult.gasDetails),
    };

  } catch (error) {
    console.error('[RailgunActions] Gas estimation failed:', error);
    throw new Error(`Gas estimation failed: ${error.message}`);
  }
};

/**
 * UTILITY: Check if a token is supported by Railgun
 */
export const isTokenSupportedByRailgun = (tokenAddress, chainId) => {
  try {
    // Check if network is supported
    const supportedChains = Object.keys(RAILGUN_NETWORK_NAMES).map(Number);
    if (!supportedChains.includes(chainId)) {
      return false;
    }

    // Native tokens are always supported on supported networks
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      return true;
    }

    // ERC20 tokens need valid address format (basic check)
    return typeof tokenAddress === 'string' && tokenAddress.length === 42 && tokenAddress.startsWith('0x');
  } catch (error) {
    console.error('[RailgunActions] Error checking token support:', error);
    return false;
  }
};

/**
 * UTILITY: Validate Railgun address
 */
export const isValidRailgunAddress = validateRailgunAddress;

/**
 * UTILITY: Get supported network IDs
 */
export const getSupportedChainIds = () => {
  return Object.keys(RAILGUN_NETWORK_NAMES).map(Number);
};

/**
 * UTILITY: Get network display name
 */
export const getNetworkDisplayName = (chainId) => {
  const networkNames = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNB Smart Chain',
  };
  
  return networkNames[chainId] || `Chain ${chainId}`;
};

/**
 * UTILITY: Calculate broadcaster fee for a transaction
 */
export const calculateTransactionBroadcasterFee = (networkName, gasDetails, feeBasisPoints = null) => {
  return calculateBroadcasterFee(networkName, gasDetails, feeBasisPoints);
};

// Export all transaction functions and utilities
export default {
  // Transaction operations
  shieldTokens,
  unshieldTokens,
  transferTokens,
  executeCrossContractCall,
  
  // Gas estimation
  estimateTransactionGas,
  calculateTransactionBroadcasterFee,
  
  // Validation utilities
  isValidRailgunAddress,
  isTokenSupportedByRailgun,
  getSupportedChainIds,
  getNetworkDisplayName,
  
  // Transaction types
  TransactionType,
}; 

