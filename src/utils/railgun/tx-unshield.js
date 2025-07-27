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
// Official Relayer SDK imports
import {
  WakuRelayerClient,
  RelayerTransaction,
} from '@railgun-community/waku-relayer-client-web';
import {
  calculateMaximumGas,
  ChainType,
} from '@railgun-community/shared-models';

// Relayer debugging setup
const relayerDebugger = {
  log: (msg) => {
    console.log('[Relayer Debug]', msg);
  },
  error: (err) => {
    console.error('[Relayer Error]', err.message);
  },
};

// Initialize relayer debugging (if method exists)
try {
  if (WakuRelayerClient.setDebugger) {
    WakuRelayerClient.setDebugger(relayerDebugger);
    console.log('[UnshieldTransactions] ✅ Relayer debugging enabled');
  } else {
    console.log('[UnshieldTransactions] ⚠️ Relayer debugging not available in this version');
  }
} catch (error) {
  console.warn('[UnshieldTransactions] ⚠️ Could not set relayer debugger:', error.message);
}  

/**
 * Find best relayer for unshield transaction using official SDK
 * @param {Object} chain - Chain configuration
 * @param {string} tokenAddress - Token address for fee payment (null for native token)
 * @returns {Object|null} Selected relayer or null if none available
 */
const findBestRelayerForUnshield = async (chain, tokenAddress) => {
  try {
    console.log('[UnshieldTransactions] 🔍 Searching for available relayers...', {
      chainId: chain.id,
      chainName: chain.name,
      feeToken: tokenAddress ? tokenAddress.slice(0, 10) + '...' : 'native',
      fullTokenAddress: tokenAddress,
    });
    
    // Create chain object for relayer client
    const chainConfig = {
      type: ChainType.EVM,
      id: chain.id,
    };
    
    console.log('[UnshieldTransactions] 🔧 Chain configuration:', chainConfig);
    
    // Use the fee token address for relayer selection
    // For native tokens (ETH), use undefined or the wrapped token address
    const feeTokenAddress = tokenAddress || undefined;
    
    // Only set to true if making a cross-contract call (false for standard unshield)
    const useRelayAdapt = false;
    
    console.log('[UnshieldTransactions] 🎯 Relayer search parameters:', {
      feeTokenAddress,
      useRelayAdapt,
      hasWakuRelayerClient: !!WakuRelayerClient,
      relayerClientStarted: WakuRelayerClient.isStarted ? WakuRelayerClient.isStarted() : 'unknown',
    });
    
    // Check if WakuRelayerClient is started
    if (WakuRelayerClient.isStarted && !WakuRelayerClient.isStarted()) {
      console.error('[UnshieldTransactions] ❌ WakuRelayerClient is not started - cannot find relayers');
      return null;
    }
    
    // Check if there are any relayers for this chain first
    if (WakuRelayerClient.findAllRelayersForChain) {
      const allRelayers = WakuRelayerClient.findAllRelayersForChain(chainConfig, useRelayAdapt);
      console.log('[UnshieldTransactions] 📊 All available relayers for chain:', {
        chainId: chain.id,
        relayerCount: allRelayers?.length || 0,
        relayers: allRelayers?.map(r => ({
          address: r.railgunAddress?.slice(0, 10) + '...',
          feeToken: r.tokenFee?.tokenAddress?.slice(0, 10) + '...' || 'native',
          feePerUnitGas: r.tokenFee?.feePerUnitGas?.toString(),
        })) || [],
      });
    }
    
    // Check if the specific token is supported
    if (WakuRelayerClient.supportsToken) {
      const tokenSupported = WakuRelayerClient.supportsToken(chainConfig, feeTokenAddress, useRelayAdapt);
      console.log('[UnshieldTransactions] 🎫 Token support check:', {
        tokenAddress: feeTokenAddress,
        isSupported: tokenSupported,
      });
    }
    
    // Find best relayer using official SDK
    const selectedRelayer = WakuRelayerClient.findBestRelayer(
      chainConfig,
      feeTokenAddress,
      useRelayAdapt
    );
    
    if (selectedRelayer) {
      console.log('[UnshieldTransactions] ✅ Found available relayer:', {
        relayerAddress: selectedRelayer.railgunAddress?.slice(0, 10) + '...',
        feeToken: selectedRelayer.tokenFee?.tokenAddress?.slice(0, 10) + '...' || 'native',
        feePerUnitGas: selectedRelayer.tokenFee?.feePerUnitGas?.toString(),
        feesID: selectedRelayer.tokenFee?.feesID,
        tokenFeeDetails: selectedRelayer.tokenFee,
      });
    } else {
      console.warn('[UnshieldTransactions] ⚠️ No relayer available for specified token - will use self-signing');
      console.warn('[UnshieldTransactions] 🔍 Debug info:', {
        searchedToken: feeTokenAddress,
        chainId: chain.id,
        useRelayAdapt,
        wakuClientStarted: WakuRelayerClient.isStarted ? WakuRelayerClient.isStarted() : 'unknown',
      });
    }
    
    return selectedRelayer;
    
  } catch (error) {
    console.error('[UnshieldTransactions] ❌ Relayer discovery failed:', error.message);
    console.error('[UnshieldTransactions] 🔍 Error details:', {
      name: error.name,
      stack: error.stack,
      chainId: chain?.id,
      tokenAddress,
    });
    console.warn('[UnshieldTransactions] 🔄 Falling back to self-signing due to relayer error');
    return null;
  }
};

/**
 * Create relayer transaction using official SDK
 * @param {string} to - Contract address  
 * @param {string} data - Transaction data
 * @param {string} relayerAddress - Relayer's RAILGUN address
 * @param {string} feesID - Relayer's fee ID
 * @param {Object} chain - Chain configuration
 * @param {Array} nullifiers - Transaction nullifiers
 * @param {bigint} overallBatchMinGasPrice - Minimum gas price
 * @param {boolean} useRelayAdapt - Whether to use relay adapt
 * @returns {Object} Relayer transaction object
 */
const createRelayerTransaction = async (to, data, relayerAddress, feesID, chain, nullifiers, overallBatchMinGasPrice, useRelayAdapt) => {
  try {
    console.log('[UnshieldTransactions] 🔧 Creating relayer transaction...', {
      to: to?.slice(0, 10) + '...',
      dataLength: data?.length || 0,
      relayerAddress: relayerAddress?.slice(0, 10) + '...',
      feesID,
      chainId: chain.id,
      nullifiersCount: nullifiers?.length || 0,
      overallBatchMinGasPrice: overallBatchMinGasPrice?.toString(),
      useRelayAdapt,
    });
    
    // Create chain object for relayer transaction
    const chainConfig = {
      type: ChainType.EVM,
      id: chain.id,
    };
    
    // Create relayer transaction using official SDK
    const relayerTransaction = await RelayerTransaction.create(
      to,
      data,
      relayerAddress,
      feesID,
      chainConfig,
      nullifiers,
      overallBatchMinGasPrice,
      useRelayAdapt
    );
    
    console.log('[UnshieldTransactions] ✅ Relayer transaction created successfully');
    
    return relayerTransaction;
    
  } catch (error) {
    console.error('[UnshieldTransactions] ❌ Relayer transaction creation failed:', error.message);
    throw new Error(`Failed to create relayer transaction: ${error.message}`);
  }
};

/**
 * Submit transaction via relayer using official SDK
 * @param {Object} relayerTransaction - Relayer transaction object
 * @returns {string} Transaction hash
 */
const submitRelayerTransaction = async (relayerTransaction) => {
  try {
    console.log('[UnshieldTransactions] 📡 Submitting transaction via relayer...');
    
    // Submit transaction through relayer using official SDK
    const transactionHash = await relayerTransaction.send();
    
    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new Error('Invalid transaction hash received from relayer');
    }
    
    console.log('[UnshieldTransactions] ✅ Transaction submitted successfully via relayer:', {
      transactionHash,
      anonymousSubmission: true,
    });
    
    return transactionHash;
    
  } catch (error) {
    console.error('[UnshieldTransactions] ❌ Relayer submission failed:', error.message);
    throw new Error(`Relayer submission failed: ${error.message}`);
  }
};

/**
 * Submit transaction via self-signing (Fallback)
 * @param {Object} populatedTransaction - Transaction from populateProvedUnshield
 * @param {Function} walletProvider - Wallet provider function
 * @returns {Object} Transaction response
 */
const submitTransactionSelfSigned = async (populatedTransaction, walletProvider) => {
  try {
    // Get wallet signer
    const walletSigner = await walletProvider();
    
    // Format transaction for self-signing (convert BigInt to hex strings)
    const txForSending = {
      ...populatedTransaction.transaction,
      gasLimit: undefined, // Let wallet estimate gas
      gasPrice: populatedTransaction.transaction.gasPrice ? '0x' + populatedTransaction.transaction.gasPrice.toString(16) : undefined,
      maxFeePerGas: populatedTransaction.transaction.maxFeePerGas ? '0x' + populatedTransaction.transaction.maxFeePerGas.toString(16) : undefined,
      maxPriorityFeePerGas: populatedTransaction.transaction.maxPriorityFeePerGas ? '0x' + populatedTransaction.transaction.maxPriorityFeePerGas.toString(16) : undefined,
      value: populatedTransaction.transaction.value ? '0x' + populatedTransaction.transaction.value.toString(16) : '0x0',
    };
    
    // Clean up undefined values
    Object.keys(txForSending).forEach(key => {
      if (txForSending[key] === undefined) {
        delete txForSending[key];
      }
    });
    
    console.log('[UnshieldTransactions] 🔄 Self-signing transaction...', {
      to: txForSending.to,
      dataLength: txForSending.data?.length || 0,
      value: txForSending.value,
    });
    
    // Send transaction via wallet
    const txResponse = await walletSigner.sendTransaction(txForSending);
    
    console.log('[UnshieldTransactions] ✅ Self-signed transaction sent');
    
    return txResponse;
    
  } catch (error) {
    console.error('[UnshieldTransactions] ❌ Self-signing failed:', error.message);
    throw new Error(`Self-signing failed: ${error.message}`);
  }
};

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
  // Step 1: Cast to string first
  const amountString = String(amount);
  
  // Step 2: Throw if falsy or empty string
  if (!amount || amountString === '' || amountString === 'undefined' || amountString === 'null' || amountString === 'NaN') {
    throw new Error(`Invalid amount for ERC20AmountRecipient: "${amount}" - must be a valid number`);
  }
  
  // Step 3: Only then call BigInt()
  let amountBigInt;
  try {
    amountBigInt = BigInt(amountString);
  } catch (error) {
    throw new Error(`Cannot convert amount "${amountString}" to BigInt: ${error.message}`);
  }
  
  return {
    tokenAddress: tokenAddress || undefined, // undefined for native tokens
    amount: amountBigInt,
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

    // Get network configuration with validation
    if (!chain?.id) {
      throw new Error(`Chain ID is required but got: ${JSON.stringify(chain)}`);
    }
    
    const networkName = getRailgunNetworkName(chain.id);
    if (!networkName) {
      throw new Error(`Could not determine network name for chain ID: ${chain.id}`);
    }
    
    console.log('[UnshieldTransactions] Network configuration:', {
      chainId: chain.id,
      chainName: chain.name,
      networkName,
      isValidNetworkName: !!networkName,
    });
    
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    // Create recipient
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for unshield

    // Step 1: Find and select best relayer for the transaction (needed for proper gas estimation)
    console.log('[UnshieldTransactions] 🔍 Discovering available relayers...');
    const selectedRelayer = await findBestRelayerForUnshield(chain, tokenAddress);
    const sendWithPublicWallet = !selectedRelayer; // Use relayer if available, fallback to public wallet
    
    if (selectedRelayer) {
      console.log('[UnshieldTransactions] ✅ Selected relayer for private transaction:', {
        relayerAddress: selectedRelayer.railgunAddress?.slice(0, 10) + '...',
        feeToken: selectedRelayer.tokenFee?.tokenAddress?.slice(0, 10) + '...',
        feePerUnitGas: selectedRelayer.tokenFee?.feePerUnitGas?.toString(),
      });
    } else {
      console.warn('[UnshieldTransactions] ⚠️ No relayer available - will use self-signing (reduced privacy)');
    }

    // Step 2: Gas estimation using our broadcaster fee estimator (following official SDK pattern)
    console.log('[UnshieldTransactions] Estimating gas with broadcaster fee consideration...');
    
    // Create minimal gas details for initial estimation
    const initialGasEstimate = 500000;
    const gasString = String(initialGasEstimate);
    
    if (!initialGasEstimate || gasString === '' || gasString === 'undefined' || gasString === 'null' || gasString === 'NaN') {
      throw new Error(`Invalid initial gas estimate: ${initialGasEstimate}`);
    }
    
    const estimationGasDetails = createUnshieldGasDetails(networkName, sendWithPublicWallet, BigInt(gasString));
    
    // Create gas estimation function for our broadcaster fee estimator
    const gasEstimateFunction = async (...params) => {
      return await gasEstimateForUnprovenUnshield(
        txidVersion,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        estimationGasDetails,
        undefined, // feeTokenDetails
        sendWithPublicWallet, // Use the determined value
      );
    };
    
    // Parameters for gas estimation (empty array since gasEstimateForUnprovenUnshield has all params baked in)
    const gasEstimateParams = [];
    
    // Use our broadcaster fee estimator with the selected relayer (follows official SDK iterative pattern)
    const estimationResult = await estimateGasWithBroadcasterFee(
      networkName,
      gasEstimateFunction,
      gasEstimateParams,
      selectedRelayer, // Now we have the actual relayer selection
      'unshield'
    );
    
    // Extract gas details and broadcaster fee info from estimation
    const gasDetails = estimationResult.gasDetails;
    const broadcasterFeeInfo = estimationResult.broadcasterFeeInfo;
    const iterations = estimationResult.iterations;

    console.log('[UnshieldTransactions] Gas estimation completed using broadcaster fee estimator:', {
      gasEstimate: gasDetails.gasEstimate.toString(),
      evmGasType: gasDetails.evmGasType,
      iterations,
      hasBroadcasterFee: !!broadcasterFeeInfo,
      broadcasterFeeAmount: broadcasterFeeInfo?.feeAmount?.toString() || 'none',
      usesRelayer: !sendWithPublicWallet,
    });

    // Step 3: Official SDK Pattern - Relayer-based Unshielding (Private Transactions)
    console.log('[UnshieldTransactions] 🔄 Starting relayer-based unshield transaction...');
    
    // Step 3a: Calculate relayer fee if using relayer (Official SDK Pattern)
    let broadcasterFeeERC20AmountRecipient = null;
    let overallBatchMinGasPrice = undefined;
    
    if (selectedRelayer) {
      console.log('[UnshieldTransactions] 💰 Calculating relayer fee using official SDK...');
      
      // Use official SDK's calculateMaximumGas function
      const maximumGas = calculateMaximumGas(gasDetails);
      const oneUnitGas = 10n ** 18n;
      const tokenFeePerUnitGas = BigInt(selectedRelayer.tokenFee.feePerUnitGas);
      const relayerFeeAmount = (tokenFeePerUnitGas * maximumGas) / oneUnitGas;
      
      // Create broadcaster fee recipient (required for relayer transactions)
      broadcasterFeeERC20AmountRecipient = {
        tokenAddress: selectedRelayer.tokenFee.tokenAddress,
        amount: relayerFeeAmount,
        recipientAddress: selectedRelayer.railgunAddress,
      };
      
      // Set minimum gas price for relayer (required for relayer transactions)
      overallBatchMinGasPrice = gasDetails.gasPrice || gasDetails.maxFeePerGas || BigInt('1000000000'); // 1 gwei fallback
      
      console.log('[UnshieldTransactions] ✅ Relayer fee calculated:', {
        feeAmount: relayerFeeAmount.toString(),
        feeToken: selectedRelayer.tokenFee.tokenAddress?.slice(0, 10) + '...' || 'native',
        maximumGas: maximumGas.toString(),
        overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
        feesID: selectedRelayer.tokenFee.feesID,
      });
    } else {
      console.log('[UnshieldTransactions] ℹ️ No relayer selected - using direct self-signing');
    }
    
    // Step 2c: Generate proof with correct relayer/self-signing parameters (Official SDK Pattern)
    console.log('[UnshieldTransactions] 🔄 Generating proof for transaction...', {
      usesRelayer: !sendWithPublicWallet,
      sendWithPublicWallet,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      overallBatchMinGasPrice: overallBatchMinGasPrice?.toString() || 'undefined',
    });
    
    await generateUnshieldProof(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeERC20AmountRecipient, // ✅ Correctly set for relayer or null for self-signing
      sendWithPublicWallet, // ✅ False for relayer, true for self-signing
      overallBatchMinGasPrice, // ✅ Set for relayer, undefined for self-signing
      (progress) => {
        console.log(`[UnshieldTransactions] Proof generation progress: ${Math.round(progress * 100)}%`);
      }
    );
    
    console.log('[UnshieldTransactions] ✅ Proof generation completed');
    
    // Step 2d: Populate transaction using SDK's internal cache (Official SDK Pattern)
    const populatedTransaction = await populateProvedUnshield(
      txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeERC20AmountRecipient, // ✅ Must match proof generation exactly
      sendWithPublicWallet, // ✅ Must match proof generation exactly
      overallBatchMinGasPrice, // ✅ Must match proof generation exactly
      gasDetails
    );
    
    console.log('[UnshieldTransactions] ✅ Transaction populated and ready for submission:', {
      transactionTo: populatedTransaction.transaction?.to?.slice(0, 10) + '...',
      hasNullifiers: !!populatedTransaction.nullifiers?.length,
      nullifiersCount: populatedTransaction.nullifiers?.length || 0,
      usesRelayer: !sendWithPublicWallet,
    });

    // Debug: Log the raw transaction from Railgun SDK
    console.log('[UnshieldTransactions] 🔍 Raw transaction from Railgun SDK:', {
      transaction: populatedTransaction.transaction,
      to: populatedTransaction.transaction.to,
      data: populatedTransaction.transaction.data ? populatedTransaction.transaction.data.slice(0, 10) + '...' : 'undefined',
      dataLength: populatedTransaction.transaction.data?.length || 0,
      value: populatedTransaction.transaction.value?.toString(),
      nullifiers: populatedTransaction.nullifiers?.length || 0,
      usedRelayer: selectedRelayer ? 'yes' : 'no (self-signing)',
    });
    
    // Step 3: Submit transaction via relayer or fallback to self-signing (Official SDK Pattern)
    let transactionHash, txResponse;
    
    if (selectedRelayer && !sendWithPublicWallet) {
      console.log('[UnshieldTransactions] 📡 Attempting relayer submission (maximum privacy)...', {
        relayerAddress: selectedRelayer.railgunAddress?.slice(0, 10) + '...',
        feesID: selectedRelayer.tokenFee?.feesID,
        hasValidParameters: !!(populatedTransaction.transaction.to && populatedTransaction.transaction.data),
      });
      
      try {
        // Ensure we have all required parameters for relayer submission
        if (!populatedTransaction.transaction.to || !populatedTransaction.transaction.data) {
          throw new Error('Invalid transaction data for relayer submission');
        }
        
        if (!overallBatchMinGasPrice) {
          throw new Error('overallBatchMinGasPrice is required for relayer transactions');
        }
        
        // Submit via relayer using official SDK pattern
        const nullifiers = populatedTransaction.nullifiers ?? [];
        
        const relayerTransaction = await createRelayerTransaction(
          populatedTransaction.transaction.to,
          populatedTransaction.transaction.data,
          selectedRelayer.railgunAddress,
          selectedRelayer.tokenFee.feesID,
          chain,
          nullifiers,
          overallBatchMinGasPrice,
          false // useRelayAdapt - false for standard unshield
        );
        
        transactionHash = await submitRelayerTransaction(relayerTransaction);
        
        console.log('[UnshieldTransactions] ✅ Transaction submitted via relayer (maximum privacy):', {
          transactionHash,
          anonymousSubmission: true,
          privacyLevel: 'high',
        });
        
      } catch (relayerError) {
        console.error('[UnshieldTransactions] ❌ Relayer submission failed:', relayerError.message);
        console.warn('[UnshieldTransactions] 🔄 Falling back to self-signing (reduced privacy)...');
        
        // Important: Need to regenerate proof for self-signing since parameters differ
        console.log('[UnshieldTransactions] 🔄 Regenerating proof for self-signing fallback...');
        
        // Regenerate proof with self-signing parameters
        await generateUnshieldProof(
          txidVersion,
          networkName,
          railgunWalletID,
          encryptionKey,
          erc20AmountRecipients,
          nftAmountRecipients,
          null, // No broadcaster fee for self-signing
          true, // sendWithPublicWallet = true for self-signing
          undefined, // No overallBatchMinGasPrice for self-signing
          (progress) => {
            console.log(`[UnshieldTransactions] Fallback proof generation: ${Math.round(progress * 100)}%`);
          }
        );
        
        // Repopulate transaction for self-signing
        const selfSigningTransaction = await populateProvedUnshield(
          txidVersion,
          networkName,
          railgunWalletID,
          erc20AmountRecipients,
          nftAmountRecipients,
          null, // No broadcaster fee for self-signing
          true, // sendWithPublicWallet = true for self-signing
          undefined, // No overallBatchMinGasPrice for self-signing
          gasDetails
        );
        
        // Fallback to self-signing
        txResponse = await submitTransactionSelfSigned(selfSigningTransaction, walletProvider);
        transactionHash = txResponse.hash || txResponse;
        
        console.warn('[UnshieldTransactions] ⚠️ Used self-signing fallback (reduced privacy):', {
          transactionHash,
          privacyLevel: 'reduced',
          reason: 'relayer_failed',
        });
      }
      
    } else {
      const reason = !selectedRelayer ? 'no_relayer_available' : 'relayer_configuration_error';
      console.log('[UnshieldTransactions] 🔄 Self-signing transaction (no relayer)...', {
        reason,
        sendWithPublicWallet,
        hasRelayer: !!selectedRelayer,
      });
      
      // Self-sign transaction when no relayer available
      txResponse = await submitTransactionSelfSigned(populatedTransaction, walletProvider);
      transactionHash = txResponse.hash || txResponse;
      
      console.warn('[UnshieldTransactions] ⚠️ Self-signed transaction (reduced privacy):', {
        transactionHash,
        privacyLevel: 'reduced',
        reason,
      });
    }
    
    console.log('[UnshieldTransactions] ✅ Unshield operation completed successfully!');
    
    return {
      // Transaction details
      transaction: populatedTransaction.transaction,
      transactionHash, // ✅ CRITICAL: Transaction hash for Graph monitoring
      txResponse, // Full response from wallet (if self-signed)
      
      // Gas information
      gasDetails,
      gasEstimate: gasDetails.gasEstimate,
      
      // Railgun-specific data
      nullifiers: populatedTransaction.nullifiers,
      preTransactionPOIsPerTxidLeafPerList: populatedTransaction.preTransactionPOIsPerTxidLeafPerList,
      
      // Relayer information
      usedRelayer: !sendWithPublicWallet,
      selectedRelayer: selectedRelayer?.railgunAddress,
      broadcasterFeeERC20AmountRecipient,
      
      // Metadata
      transactionType: 'unshield',
      networkName,
      sendWithPublicWallet,
      privacyLevel: selectedRelayer ? 'high' : 'reduced',
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