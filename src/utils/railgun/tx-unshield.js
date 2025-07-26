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

    // Debug: Log detailed inputs for troubleshooting
    console.log('[UnshieldTransactions] 🔍 Detailed operation parameters:', {
      railgunWalletID: railgunWalletID?.slice(0, 8) + '...',
      tokenAddress: tokenAddress || 'NATIVE_TOKEN',
      amountString: amount,
      amountBigInt: BigInt(amount).toString(),
      chainName: chain.name,
      chainId: chain.id,
      toAddress: toAddress,
      hasWalletProvider: typeof walletProvider === 'function',
      selectedBroadcaster: selectedBroadcaster?.railgunAddress || 'none',
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

    // Step 1: Gas estimation - EXACT same as working shield (no gas details to estimation!)
    console.log('[UnshieldTransactions] Estimating gas for unshield operation...');
    const gasEstimateResponse = await gasEstimateForUnprovenUnshield(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      // Note: Shield doesn't pass ANY gas details to estimation function!
    );

    // Extract the gas estimate value from the response (EXACT same as shield)
    const gasEstimate = gasEstimateResponse.gasEstimate || gasEstimateResponse;
    console.log('[UnshieldTransactions] Gas estimate response:', {
      gasEstimate: gasEstimate.toString(),
      type: typeof gasEstimate
    });

    // Create real gas details for unshield operation (EXACT same pattern as shield)
    const gasDetails = createUnshieldGasDetails(networkName, gasEstimate);
    
    const broadcasterFeeInfo = null; // No broadcaster for unshield (same as shield)
    const iterations = 1; // Direct estimation (same as shield)

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

    // Debug: Log the raw transaction from Railgun SDK
    console.log('[UnshieldTransactions] 🔍 Raw transaction from Railgun SDK:', {
      transaction: populatedTransaction.transaction,
      to: populatedTransaction.transaction.to,
      data: populatedTransaction.transaction.data,
      value: populatedTransaction.transaction.value?.toString(),
      gasLimit: populatedTransaction.transaction.gasLimit?.toString(),
      type: populatedTransaction.transaction.type,
    });

    // Step 4: Send transaction on-chain
    console.log('[UnshieldTransactions] Sending transaction on-chain...');
    
    // Get wallet signer
    const walletSigner = await walletProvider();
    
    // Format transaction for sending (convert BigInt to hex strings)
    // ⚠️ CRITICAL FIX: Let wallet estimate gas instead of forcing our gas limit
    const txForSending = {
      ...populatedTransaction.transaction,
      // Remove gasLimit - let wallet estimate gas naturally
      // Note: We keep our estimated gas as fallback in gasDetails for reference
      gasLimit: undefined,
      gasPrice: populatedTransaction.transaction.gasPrice ? '0x' + populatedTransaction.transaction.gasPrice.toString(16) : undefined,
      maxFeePerGas: populatedTransaction.transaction.maxFeePerGas ? '0x' + populatedTransaction.transaction.maxFeePerGas.toString(16) : undefined,
      maxPriorityFeePerGas: populatedTransaction.transaction.maxPriorityFeePerGas ? '0x' + populatedTransaction.transaction.maxPriorityFeePerGas.toString(16) : undefined,
      value: populatedTransaction.transaction.value ? '0x' + populatedTransaction.transaction.value.toString(16) : '0x0',
    };
    
    console.log('[UnshieldTransactions] 💡 Gas estimation info:', {
      ourEstimate: gasDetails.gasEstimate?.toString(),
      evmGasType: gasDetails.evmGasType,
      sendWithPublicWallet: true,
      note: 'Letting wallet estimate gas to avoid estimation conflicts',
    });
    
    // Clean up transaction object - remove undefined values that might confuse wallet
    Object.keys(txForSending).forEach(key => {
      if (txForSending[key] === undefined) {
        delete txForSending[key];
      }
    });
    
    console.log('[UnshieldTransactions] Formatted transaction for sending:', {
      to: txForSending.to,
      data: txForSending.data ? txForSending.data.slice(0, 10) + '...' : 'undefined',
      dataLength: txForSending.data ? txForSending.data.length : 0,
      value: txForSending.value,
      gasLimit: txForSending.gasLimit || 'wallet-estimated',
      gasPrice: txForSending.gasPrice,
      maxFeePerGas: txForSending.maxFeePerGas,
      maxPriorityFeePerGas: txForSending.maxPriorityFeePerGas,
      type: txForSending.type,
      isValidAddress: txForSending.to && txForSending.to.startsWith('0x') && txForSending.to.length === 42,
      hasCallData: !!txForSending.data && txForSending.data !== '0x',
    });

    // Additional validation
    if (!txForSending.to || !txForSending.to.startsWith('0x') || txForSending.to.length !== 42) {
      console.error('[UnshieldTransactions] ❌ Invalid contract address:', txForSending.to);
      throw new Error(`Invalid contract address: ${txForSending.to}`);
    }

    if (!txForSending.data || txForSending.data === '0x') {
      console.error('[UnshieldTransactions] ❌ Missing or empty call data');
      throw new Error('Transaction missing call data');
    }
    
    console.log('[UnshieldTransactions] 🔄 Sending transaction to wallet for signing...');
    
    let txResponse, transactionHash;
    try {
      // Send transaction and get receipt
      txResponse = await walletSigner.sendTransaction(txForSending);
      transactionHash = txResponse.hash || txResponse;
      
      console.log('[UnshieldTransactions] ✅ Transaction sent successfully:', transactionHash);
    } catch (walletError) {
      console.error('[UnshieldTransactions] ❌ Wallet transaction failed:', {
        error: walletError.message,
        code: walletError.code,
        data: walletError.data,
        transaction: txForSending,
      });
      throw new Error(`Wallet transaction failed: ${walletError.message}`);
    }
    
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
    // Ensure networkName is available in error scope
    const errorNetworkName = chain?.id ? getRailgunNetworkName(chain.id) : 'unknown';
    
    console.error('[UnshieldTransactions] ❌ Unshield operation failed:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      data: error.data,
      networkName: errorNetworkName,
      railgunWalletID,
      step: 'Unknown - check logs above for specific step',
    });
    
    // Enhanced error messages for common issues
    if (error.message?.includes('gas estimation failed') || error.message?.includes('execution reverted')) {
      throw new Error(`Gas estimation failed. This could be due to insufficient balance, wrong network, or contract issues. Original error: ${error.message}`);
    }
    
    if (error.message?.includes('user rejected') || error.message?.includes('user denied')) {
      throw new Error(`Transaction cancelled by user: ${error.message}`);
    }
    
    if (error.message?.includes('Invalid contract address')) {
      throw new Error(`Invalid Railgun contract address for network ${errorNetworkName}. Check if Railgun is supported on this network.`);
    }
    
    throw new Error(`Unshield operation failed: ${error.message}`);
  }
};

export default {
  unshieldTokens,
}; 