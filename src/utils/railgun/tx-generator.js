/**
 * RAILGUN Transaction Generator - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-generator.ts
 * Provides core transaction utilities, transfers, cross-contract calls, and proof orchestration
 */

import {
  NetworkName,
  TXIDVersion,
  RailgunERC20AmountRecipient,
  RailgunNFTAmountRecipient,
  TransactionGasDetails,
  ContractTransaction,
  CrossContractCalls,
  isDefined,
} from '@railgun-community/shared-models';
import {
  generateTransferProof,
  populateProvedTransfer,
  gasEstimateForUnprovenTransfer,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
  gasEstimateForUnprovenCrossContractCalls,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';
import { createGasDetails, validateGasDetails } from './tx-gas-details.js';
import { estimateGasWithBroadcasterFee } from './tx-gas-broadcaster-fee-estimator.js';
// Remove incorrect import and use the proper approach
// import { getRailgunTxidVersionForNetwork } from '@railgun-community/engine';

/**
 * Get the appropriate TXID version for a network
 * @param {NetworkName} networkName - The network name
 * @returns {TXIDVersion} The TXID version to use
 */
const getTxidVersionForNetwork = (networkName) => {
  // For now, use V2 for all networks - this can be updated based on network requirements
  // In the future, this could check network configuration to determine if V3 is supported
  return TXIDVersion.V2_PoseidonMerkle;
};

/**
 * Transaction types for different operations
 */
export const TransactionType = {
  SHIELD: 'shield',
  UNSHIELD: 'unshield', 
  TRANSFER: 'transfer',
  CROSS_CONTRACT: 'crossContract',
};

/**
 * Default transaction configuration
 */
const DEFAULT_TX_CONFIG = {
  txidVersion: TXIDVersion.V2_PoseidonMerkle,
  generateProof: true,
  validateInputs: true,
  useAdvancedGasEstimation: true,
};

/**
 * Base transaction result interface
 */
const createTransactionResult = (transaction, gasDetails, proofResult = null, metadata = {}) => ({
  transaction,
  gasDetails,
  proofResult,
  metadata: {
    transactionType: metadata.transactionType || 'unknown',
    timestamp: Date.now(),
    txidVersion: metadata.txidVersion || TXIDVersion.V2_PoseidonMerkle,
    ...metadata,
  },
});

/**
 * Validate transaction inputs common to all transaction types
 */
const validateCommonTransactionInputs = (networkName, erc20AmountRecipients, nftAmountRecipients) => {
  if (!Object.values(NetworkName).includes(networkName)) {
    throw new Error(`Invalid network name: ${networkName}`);
  }

  if (!Array.isArray(erc20AmountRecipients)) {
    throw new Error('ERC20 amount recipients must be an array');
  }

  if (!Array.isArray(nftAmountRecipients)) {
    throw new Error('NFT amount recipients must be an array');
  }

  if (erc20AmountRecipients.length === 0 && nftAmountRecipients.length === 0) {
    throw new Error('At least one recipient must be provided');
  }

  // Validate ERC20 recipients
  erc20AmountRecipients.forEach((recipient, index) => {
    if (!isDefined(recipient.amount) || recipient.amount <= 0n) {
      throw new Error(`ERC20 recipient ${index}: amount must be a positive BigInt`);
    }
    if (!recipient.recipientAddress || typeof recipient.recipientAddress !== 'string') {
      throw new Error(`ERC20 recipient ${index}: recipient address must be a non-empty string`);
    }
  });

  console.log('[TxGenerator] Transaction inputs validated:', {
    networkName,
    erc20Recipients: erc20AmountRecipients.length,
    nftRecipients: nftAmountRecipients.length,
  });
};

/**
 * Enhanced gas estimation with broadcaster fee support for any transaction type
 */
const estimateTransactionGas = async (
  transactionType,
  gasEstimateFunction,
  gasEstimateParams,
  networkName,
  selectedBroadcaster = null
) => {
  try {
    console.log(`[TxGenerator] Estimating gas for ${transactionType} transaction...`);

    const gasEstimationResult = await estimateGasWithBroadcasterFee(
      networkName,
      gasEstimateFunction,
      gasEstimateParams,
      selectedBroadcaster,
      transactionType
    );

    console.log(`[TxGenerator] Gas estimation completed for ${transactionType}:`, {
      gasEstimate: gasEstimationResult.gasDetails.gasEstimate.toString(),
      iterations: gasEstimationResult.iterations,
      hasBroadcasterFee: !!gasEstimationResult.broadcasterFeeInfo,
    });

    return gasEstimationResult;

  } catch (error) {
    console.error(`[TxGenerator] Gas estimation failed for ${transactionType}:`, error);
    throw new Error(`Gas estimation failed for ${transactionType}: ${error.message}`);
  }
};

/**
 * Generate proof for transaction
 */
const generateTransactionProof = async (
  transactionType,
  proofFunction,
  proofParams
) => {
  try {
    console.log(`[TxGenerator] Generating proof for ${transactionType} transaction...`);
    
    const startTime = Date.now();
    const proofResult = await proofFunction(...proofParams);
    const proofTime = Date.now() - startTime;

    console.log(`[TxGenerator] Proof generated for ${transactionType} in ${proofTime}ms`);
    
    return {
      ...proofResult,
      metadata: {
        proofGenerationTime: proofTime,
        transactionType,
      },
    };

  } catch (error) {
    console.error(`[TxGenerator] Proof generation failed for ${transactionType}:`, error);
    throw new Error(`Proof generation failed for ${transactionType}: ${error.message}`);
  }
};

/**
 * Private-to-private transfer transaction
 */
export const generateTransferTransaction = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients = [],
  selectedBroadcaster = null,
  gasDetails = null,
  txConfig = DEFAULT_TX_CONFIG,
}) => {
  try {
    console.log('[TxGenerator] Starting transfer transaction generation...');

    // Wait for Railgun readiness
    await waitForRailgunReady();

    // Validate inputs
    if (txConfig.validateInputs) {
      validateCommonTransactionInputs(networkName, erc20AmountRecipients, nftAmountRecipients);
      
      if (!railgunWalletID || typeof railgunWalletID !== 'string') {
        throw new Error('Railgun wallet ID must be a non-empty string');
      }
      if (!encryptionKey || typeof encryptionKey !== 'string') {
        throw new Error('Encryption key must be a non-empty string');
      }
    }

    // Dynamically retrieve txidVersion for the connected chain
    const txidVersion = getTxidVersionForNetwork(networkName);

    // Update transaction config with the correct txidVersion
    txConfig = {
      ...txConfig,
      txidVersion,
    };

    // Gas estimation if not provided
    let finalGasDetails = gasDetails;
    let gasEstimationResult = null;

    if (!finalGasDetails && txConfig.useAdvancedGasEstimation) {
      const gasEstimateFunction = async (...params) => {
        return await gasEstimateForUnprovenTransfer(...params);
      };

      const gasEstimateParams = [
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
      ];

      gasEstimationResult = await estimateTransactionGas(
        TransactionType.TRANSFER,
        gasEstimateFunction,
        gasEstimateParams,
        networkName,
        selectedBroadcaster
      );

      finalGasDetails = gasEstimationResult.gasDetails;
    } else if (!finalGasDetails) {
      // Fallback gas estimation
      const gasEstimate = await gasEstimateForUnprovenTransfer(
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients
      );
      
      finalGasDetails = createGasDetails(
        networkName,
        !selectedBroadcaster,
        BigInt(gasEstimate.gasEstimate || gasEstimate),
        TransactionType.TRANSFER
      );
    }

    // Generate proof
    let proofResult = null;
    if (txConfig.generateProof) {
      const proofFunction = async (...params) => {
        return await generateTransferProof(...params);
      };

      const proofParams = [
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
      ];

      proofResult = await generateTransactionProof(
        TransactionType.TRANSFER,
        proofFunction,
        proofParams
      );
    }

    // Populate transaction
    console.log('[TxGenerator] Populating transfer transaction...');
    const populatedTransaction = await populateProvedTransfer(
      txConfig.txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    const result = createTransactionResult(
      populatedTransaction.transaction,
      finalGasDetails,
      proofResult,
      {
        transactionType: TransactionType.TRANSFER,
        txidVersion: txConfig.txidVersion,
        railgunWalletID,
        erc20Recipients: erc20AmountRecipients.length,
        nftRecipients: nftAmountRecipients.length,
        broadcasterFeeInfo: gasEstimationResult?.broadcasterFeeInfo,
        gasEstimationIterations: gasEstimationResult?.iterations,
      }
    );

    console.log('[TxGenerator] Transfer transaction generated successfully');
    return result;

  } catch (error) {
    console.error('[TxGenerator] Transfer transaction generation failed:', error);
    throw new Error(`Transfer transaction generation failed: ${error.message}`);
  }
};

/**
 * Cross-contract call transaction (DeFi integration)
 */
export const generateCrossContractTransaction = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  crossContractCalls,
  erc20AmountRecipients = [],
  nftAmountRecipients = [],
  selectedBroadcaster = null,
  gasDetails = null,
  txConfig = DEFAULT_TX_CONFIG,
}) => {
  try {
    console.log('[TxGenerator] Starting cross-contract call transaction generation...');

    // Wait for Railgun readiness
    await waitForRailgunReady();

    // Validate inputs
    if (txConfig.validateInputs) {
      validateCommonTransactionInputs(networkName, erc20AmountRecipients, nftAmountRecipients);
      
      if (!railgunWalletID || typeof railgunWalletID !== 'string') {
        throw new Error('Railgun wallet ID must be a non-empty string');
      }
      if (!encryptionKey || typeof encryptionKey !== 'string') {
        throw new Error('Encryption key must be a non-empty string');
      }
      if (!Array.isArray(crossContractCalls) || crossContractCalls.length === 0) {
        throw new Error('Cross-contract calls must be a non-empty array');
      }
    }

    // Dynamically retrieve txidVersion for the connected chain
    const txidVersion = getTxidVersionForNetwork(networkName);

    // Update transaction config with the correct txidVersion
    txConfig = {
      ...txConfig,
      txidVersion,
    };

    // Gas estimation if not provided
    let finalGasDetails = gasDetails;
    let gasEstimationResult = null;

    if (!finalGasDetails && txConfig.useAdvancedGasEstimation) {
      const gasEstimateFunction = async (...params) => {
        return await gasEstimateForUnprovenCrossContractCalls(...params);
      };

      const gasEstimateParams = [
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        crossContractCalls,
      ];

      gasEstimationResult = await estimateTransactionGas(
        TransactionType.CROSS_CONTRACT,
        gasEstimateFunction,
        gasEstimateParams,
        networkName,
        selectedBroadcaster
      );

      finalGasDetails = gasEstimationResult.gasDetails;
    } else if (!finalGasDetails) {
      // Fallback gas estimation
      const gasEstimate = await gasEstimateForUnprovenCrossContractCalls(
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        crossContractCalls
      );
      
      finalGasDetails = createGasDetails(
        networkName,
        !selectedBroadcaster,
        BigInt(gasEstimate.gasEstimate || gasEstimate),
        TransactionType.CROSS_CONTRACT
      );
    }

    // Generate proof
    let proofResult = null;
    if (txConfig.generateProof) {
      const proofFunction = async (...params) => {
        return await generateCrossContractCallsProof(...params);
      };

      const proofParams = [
        txConfig.txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        crossContractCalls,
      ];

      proofResult = await generateTransactionProof(
        TransactionType.CROSS_CONTRACT,
        proofFunction,
        proofParams
      );
    }

    // Populate transaction
    console.log('[TxGenerator] Populating cross-contract transaction...');
    const populatedTransaction = await populateProvedCrossContractCalls(
      txConfig.txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients,
      crossContractCalls
    );

    const result = createTransactionResult(
      populatedTransaction.transaction,
      finalGasDetails,
      proofResult,
      {
        transactionType: TransactionType.CROSS_CONTRACT,
        txidVersion: txConfig.txidVersion,
        railgunWalletID,
        erc20Recipients: erc20AmountRecipients.length,
        nftRecipients: nftAmountRecipients.length,
        crossContractCalls: crossContractCalls.length,
        broadcasterFeeInfo: gasEstimationResult?.broadcasterFeeInfo,
        gasEstimationIterations: gasEstimationResult?.iterations,
      }
    );

    console.log('[TxGenerator] Cross-contract transaction generated successfully');
    return result;

  } catch (error) {
    console.error('[TxGenerator] Cross-contract transaction generation failed:', error);
    throw new Error(`Cross-contract transaction generation failed: ${error.message}`);
  }
};

/**
 * Generic transaction validator
 */
export const validateTransaction = (transaction, transactionType) => {
  try {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error('Transaction must be a valid object');
    }

    // Basic transaction validation
    if (!isDefined(transaction.to)) {
      throw new Error('Transaction must have a "to" address');
    }

    if (!isDefined(transaction.data)) {
      throw new Error('Transaction must have data');
    }

    if (!isDefined(transaction.gasLimit) && !isDefined(transaction.gas)) {
      throw new Error('Transaction must have gas limit');
    }

    console.log(`[TxGenerator] Transaction validated for ${transactionType}:`, {
      to: transaction.to,
      hasData: !!transaction.data,
      gasLimit: (transaction.gasLimit || transaction.gas)?.toString(),
    });

    return true;

  } catch (error) {
    console.error(`[TxGenerator] Transaction validation failed for ${transactionType}:`, error);
    throw new Error(`Transaction validation failed: ${error.message}`);
  }
};

/**
 * Create transaction metadata
 */
export const createTransactionMetadata = (transactionType, additionalData = {}) => {
  return {
    transactionType,
    timestamp: Date.now(),
    txidVersion: TXIDVersion.V2_PoseidonMerkle,
    ...additionalData,
  };
};

/**
 * Utility to create ERC20 amount recipients
 */
export const createERC20AmountRecipients = (recipients) => {
  return recipients.map((recipient, index) => {
    if (!recipient.tokenAddress && recipient.tokenAddress !== undefined) {
      throw new Error(`Recipient ${index}: tokenAddress must be defined or undefined for native token`);
    }
    if (!isDefined(recipient.amount) || recipient.amount <= 0n) {
      throw new Error(`Recipient ${index}: amount must be a positive BigInt`);
    }
    if (!recipient.recipientAddress || typeof recipient.recipientAddress !== 'string') {
      throw new Error(`Recipient ${index}: recipientAddress must be a non-empty string`);
    }

    return {
      tokenAddress: recipient.tokenAddress,
      amount: BigInt(recipient.amount),
      recipientAddress: recipient.recipientAddress,
    };
  });
};

/**
 * Calculate total transaction amounts by token
 */
export const calculateTransactionTotals = (erc20AmountRecipients) => {
  const totals = new Map();

  erc20AmountRecipients.forEach(recipient => {
    const tokenKey = recipient.tokenAddress || 'NATIVE';
    const currentTotal = totals.get(tokenKey) || 0n;
    totals.set(tokenKey, currentTotal + recipient.amount);
  });

  const result = Array.from(totals.entries()).map(([tokenAddress, amount]) => ({
    tokenAddress: tokenAddress === 'NATIVE' ? undefined : tokenAddress,
    amount,
  }));

  console.log('[TxGenerator] Transaction totals calculated:', result);
  return result;
};

export default {
  TransactionType,
  generateTransferTransaction,
  generateCrossContractTransaction,
  validateTransaction,
  createTransactionMetadata,
  createERC20AmountRecipients,
  calculateTransactionTotals,
}; 