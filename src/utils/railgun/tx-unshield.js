/**
 * RAILGUN Unshield Transactions - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-unshield.ts
 * Converted to JavaScript with custom enhancements for Lexie Wallet
 */

import {
  populateProvedUnshield,
  gasEstimateForUnprovenUnshield,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { createUnshieldGasDetails } from './tx-gas-details.js';
import { estimateGasWithBroadcasterFee } from './tx-gas-broadcaster-fee-estimator.js';
import { generateUnshieldProof } from './tx-proof-unshield.js';

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
 * Create ERC20AmountRecipient object for unshield
 */
const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  return {
    tokenAddress: tokenAddress || undefined, // undefined for native tokens
    amount: BigInt(amount),
    recipientAddress: recipientAddress,
  };
};

/**
 * Complete unshield operation - Clean, focused API
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address (or null for native)
 * @param {string} amount - Amount to unshield (in token units)
 * @param {Object} chain - Chain configuration with id
 * @param {string} toAddress - Recipient address
 * @param {Function} walletProvider - Function that returns wallet signer
 * @param {Object} selectedBroadcaster - Broadcaster info (optional)
 */
export const unshieldTokens = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  toAddress,
  walletProvider,
  selectedBroadcaster = null,
}) => {
  try {
    console.log('[UnshieldTransactions] Starting unshield operation:', {
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
    if (!walletProvider || typeof walletProvider !== 'function') {
      throw new Error('walletProvider must be a function that returns a signer');
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

    // Step 1: Gas estimation
    console.log('[UnshieldTransactions] Estimating gas...');
    const originalGasDetails = createUnshieldGasDetails(networkName, true, BigInt(100000));
    
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
      originalGasDetails,
      undefined, // feeTokenDetails
      true, // sendWithPublicWallet
    ];

    const gasEstimationResult = await estimateGasWithBroadcasterFee(
      networkName,
      gasEstimateFunction,
      gasEstimateParams,
      selectedBroadcaster,
      'unshield'
    );

    const { gasDetails, broadcasterFeeInfo, iterations } = gasEstimationResult;

    console.log('[UnshieldTransactions] Gas estimation completed:', {
      gasEstimate: gasDetails.gasEstimate.toString(),
      evmGasType: gasDetails.evmGasType,
      iterations,
      hasBroadcasterFee: !!broadcasterFeeInfo,
    });

    // Step 2: Generate proof
    console.log('[UnshieldTransactions] Generating unshield proof...');
    await generateUnshieldProof(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeInfo?.broadcasterFeeERC20AmountRecipient,
      true, // sendWithPublicWallet
      undefined, // overallBatchMinGasPrice
      (progress) => {
        console.log(`[UnshieldTransactions] Proof generation progress: ${Math.round(progress * 100)}%`);
      }
    );

    // Step 3: Populate transaction
    console.log('[UnshieldTransactions] Populating transaction...');
    const populatedTransaction = await populateProvedUnshield(
      txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeInfo?.broadcasterFeeERC20AmountRecipient,
      true, // sendWithPublicWallet
      undefined, // overallBatchMinGasPrice
      gasDetails
    );

    // Step 4: Send transaction on-chain
    console.log('[UnshieldTransactions] Sending transaction on-chain...');
    
    // Get wallet signer
    const walletSigner = await walletProvider();
    
    // Format transaction for sending (convert BigInt to hex strings)
    const txForSending = {
      ...populatedTransaction.transaction,
      gasLimit: populatedTransaction.transaction.gasLimit ? '0x' + populatedTransaction.transaction.gasLimit.toString(16) : undefined,
      gasPrice: populatedTransaction.transaction.gasPrice ? '0x' + populatedTransaction.transaction.gasPrice.toString(16) : undefined,
      maxFeePerGas: populatedTransaction.transaction.maxFeePerGas ? '0x' + populatedTransaction.transaction.maxFeePerGas.toString(16) : undefined,
      maxPriorityFeePerGas: populatedTransaction.transaction.maxPriorityFeePerGas ? '0x' + populatedTransaction.transaction.maxPriorityFeePerGas.toString(16) : undefined,
      value: populatedTransaction.transaction.value ? '0x' + populatedTransaction.transaction.value.toString(16) : '0x0',
    };
    
    console.log('[UnshieldTransactions] Formatted transaction for sending:', {
      to: txForSending.to,
      value: txForSending.value,
      gasLimit: txForSending.gasLimit,
      gasPrice: txForSending.gasPrice,
      maxFeePerGas: txForSending.maxFeePerGas,
      maxPriorityFeePerGas: txForSending.maxPriorityFeePerGas,
    });
    
    // Send transaction and get receipt
    const txResponse = await walletSigner.sendTransaction(txForSending);
    const transactionHash = txResponse.hash || txResponse;
    
    console.log('[UnshieldTransactions] ✅ Unshield operation completed successfully!');
    
    return {
      // Transaction details
      transaction: populatedTransaction.transaction,
      transactionHash, // ✅ CRITICAL: Transaction hash for Graph monitoring
      txResponse, // Full response from wallet
      
      // Gas information
      gasDetails,
      gasEstimate: gasDetails.gasEstimate,
      
      // Railgun-specific data
      nullifiers: populatedTransaction.nullifiers,
      preTransactionPOIsPerTxidLeafPerList: populatedTransaction.preTransactionPOIsPerTxidLeafPerList,
      
      // Fee information
      broadcasterFeeInfo,
      gasEstimationIterations: iterations,
      
      // Metadata
      transactionType: 'unshield',
      networkName,
      metadata: {
        railgunWalletID,
        erc20Recipients: erc20AmountRecipients.length,
        nftRecipients: nftAmountRecipients.length,
        sentOnChain: true, // ✅ Indicates transaction was actually sent
      },
    };

  } catch (error) {
    console.error('[UnshieldTransactions] Unshield operation failed:', error);
    throw new Error(`Unshield operation failed: ${error.message}`);
  }
};

export default {
  unshieldTokens,
}; 