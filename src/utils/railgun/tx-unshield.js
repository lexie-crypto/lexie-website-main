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
// Official Relayer SDK imports (following docs pattern)
import {
  WakuRelayerClient,
  RelayerTransaction,
} from '@railgun-community/waku-relayer-client-web';
import {
  calculateMaximumGas,
  ChainType,
  RelayerConnectionStatus,
} from '@railgun-community/shared-models';

// Status callback for connection updates (following docs pattern)
const statusCallback = (chain, status) => {
  console.log('[UnshieldTransactions] 📡 Relayer connection status:', {
    chainId: chain.id,
    chainName: chain.name || 'unknown',
    status,
    statusName: Object.keys(RelayerConnectionStatus).find(
      key => RelayerConnectionStatus[key] === status
    ) || 'unknown',
  });
  
  // Handle specific connection status updates
  switch (status) {
    case RelayerConnectionStatus.Connected:
      console.log('[UnshieldTransactions] ✅ Relayer connected successfully');
      break;
    case RelayerConnectionStatus.Connecting:
      console.log('[UnshieldTransactions] 🔄 Connecting to relayers...');
      break;
    case RelayerConnectionStatus.Disconnected:
      console.warn('[UnshieldTransactions] ⚠️ Relayer disconnected');
      break;
    case RelayerConnectionStatus.Error:
      console.error('[UnshieldTransactions] ❌ Relayer connection error');
      break;
    case RelayerConnectionStatus.Searching:
      console.log('[UnshieldTransactions] 🔍 Searching for relayers...');
      break;
    default:
      console.log('[UnshieldTransactions] ℹ️ Unknown relayer status:', status);
  }
};

// Relayer debugger setup (following docs pattern)
const relayerDebugger = {
  log: (msg) => {
    console.log('[Relayer Debug]', msg);
  },
  error: (err) => {
    console.error('[Relayer Error]', err.message);
  },
};

// Singleton flag to ensure relayer client is only initialized once per app boot
let relayerClientInitialized = false;

/**
 * Initialize WakuRelayerClient with proper configuration (following docs pattern)
 * @param {Object} chain - Chain configuration
 * @returns {Promise<boolean>} Success status
 */
const initializeRelayerClient = async (chain) => {
  if (relayerClientInitialized) {
    console.log('[UnshieldTransactions] ✅ Relayer client already initialized');
    return true;
  }

  // Define relayerOptions outside try block to avoid scope issues
  const relayerOptions = {
    pubSubTopic: undefined, // Use default (/waku/2/rs/0/1)
    // 🔗 DIRECT CONNECTION: Force frontend to connect ONLY to our custom Waku node
    // This completely bypasses the public fleet discovery
    staticPeers: ['/dns4/waku.lexiecrypto.com/tcp/8000/wss'], // Direct peer connection
    additionalDirectPeers: ['/dns4/waku.lexiecrypto.com/tcp/8000/wss'], // Additional direct connection
    fleetNodes: false, // DISABLE fleet nodes completely
    bootstrapPeers: false, // DISABLE bootstrap peers completely  
    peerDiscoveryTimeout: 30000, // Reduced timeout since we're connecting to specific node
    poiActiveListKeys: undefined, // Use default POI lists
  };

  try {
    // Get the proper chain name from chain ID
    const chainName = chain.name || getChainNameFromId(chain.id);
    
    console.log('[UnshieldTransactions] 🚀 Initializing WakuRelayerClient...', {
      chainId: chain.id,
      chainName: chainName,
      discovery: 'FORCED DIRECT CONNECTION - Custom node ONLY',
      customNode: '/dns4/waku.lexiecrypto.com/tcp/8000/wss',
      fleetDisabled: true,
    });

    // Create chain object for relayer client
    const chainConfig = {
      type: ChainType.EVM,
      id: chain.id,
    };

    console.log('[UnshieldTransactions] 🔄 Starting WakuRelayerClient with extended timeout...', {
      peerDiscoveryTimeout: relayerOptions.peerDiscoveryTimeout,
      chainConfig,
    });

    // 🔍 Log peer discovery configuration
    console.log('[UnshieldTransactions] 🎯 Peer discovery configuration:', {
      customNodeOnly: true, // ONLY our custom node
      fleetNodesDisabled: relayerOptions.fleetNodes === false,
      bootstrapDisabled: relayerOptions.bootstrapPeers === false,
      staticPeers: relayerOptions.staticPeers,
      additionalDirectPeers: relayerOptions.additionalDirectPeers,
      timeout: relayerOptions.peerDiscoveryTimeout,
    });

    console.log('[UnshieldTransactions] 🔗 FORCING connection to custom node ONLY - no fleet discovery!');

    // Initialize WakuRelayerClient (following docs pattern)
    await WakuRelayerClient.start(
      chainConfig,
      relayerOptions,
      statusCallback,
      relayerDebugger
    );

    console.log('[UnshieldTransactions] ✅ WakuRelayerClient initialized successfully');
    relayerClientInitialized = true;
    return true;

  } catch (error) {
    console.error('[UnshieldTransactions] ❌ Failed to initialize WakuRelayerClient:', {
      error: error.message,
      name: error.name,
      errorType: error.constructor.name,
      chainId: chain.id,
      timeout: relayerOptions.peerDiscoveryTimeout,
    });
    
    // Log specific timeout errors
    if (error.message.includes('Timed out') || error.message.includes('timeout')) {
      console.warn('[UnshieldTransactions] ⏰ Relayer initialization timed out - this is common with network connectivity issues');
      console.warn('[UnshieldTransactions] 💡 Suggestion: Check network connection or try again later');
    }
    
    // Log network connectivity errors
    if (error.message.includes('Cannot connect') || error.message.includes('network')) {
      console.warn('[UnshieldTransactions] 🌐 Network connectivity issue detected');
      console.warn('[UnshieldTransactions] 💡 Relayer network may be experiencing issues - falling back to self-signing');
    }
    
    return false;
  }
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
    console.log('🚨 [WAKU DEBUG] *** CREATING RELAYER TRANSACTION - THIS SHOULD SEND MESSAGE TO WAKU! ***');
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
    console.log('🚨🚨🚨 [WAKU DEBUG] CALLING RelayerTransaction.create() - THIS SENDS MESSAGE TO WAKU NODE! 🚨🚨🚨');
    console.log('[WAKU DEBUG] Message will be sent via static peer:', '/dns4/waku.lexiecrypto.com/tcp/8000/wss');
    console.log('[WAKU DEBUG] Content topic will be: /railgun/v2/0-42161-transact/json');
    console.log('[WAKU DEBUG] PubSub topic will be: /waku/2/rs/0/1');
    console.log('[WAKU DEBUG] Fleet nodes disabled:', true);
    
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
      // CRITICAL: Use the gas limit from our proper gas estimation, don't override to undefined
      gasLimit: populatedTransaction.transaction.gasLimit ? '0x' + populatedTransaction.transaction.gasLimit.toString(16) : undefined,
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
      gasLimit: txForSending.gasLimit,
      gasPrice: txForSending.gasPrice,
      hasData: !!txForSending.data,
    });
    
    // Debug: Log transaction details for analysis
    console.log('[UnshieldTransactions] 🔍 Transaction debug info:', {
      originalTxKeys: Object.keys(populatedTransaction.transaction),
      originalTo: populatedTransaction.transaction.to,
      originalDataLength: populatedTransaction.transaction.data?.length || 0,
      originalValue: populatedTransaction.transaction.value?.toString() || '0',
      nullifiersPresent: !!populatedTransaction.nullifiers,
      nullifiersCount: populatedTransaction.nullifiers?.length || 0,
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
 * Get human-readable chain name for a chain ID
 */
const getChainNameFromId = (chainId) => {
  const chainNames = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNB Chain',
  };
  return chainNames[chainId] || `Chain ${chainId}`;
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
 * Main unshield function - Enhanced with comprehensive debugging
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
  console.log('🚀 [UNSHIELD DEBUG] Starting unshield transaction with relayer support...', {
    railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
    encryptionKey: encryptionKey ? 'present' : 'missing',
    tokenAddress: tokenAddress?.substring(0, 10) + '...',
    amount,
    toAddress: toAddress?.substring(0, 10) + '...',
    chainId: chain.id,
    chainName: chain.name,
    timestamp: new Date().toISOString(),
  });

  let selectedRelayer = null;
  let usedRelayer = false;
  let privacyLevel = 'self-signed';

  try {
    // Validate required parameters
    if (!encryptionKey) {
      throw new Error('Encryption key is required for unshield operations');
    }
    if (!railgunWalletID) {
      throw new Error('Railgun wallet ID is required');
    }
    if (!amount) {
      throw new Error('Amount is required');
    }
    if (!toAddress) {
      throw new Error('Recipient address is required');
    }
    // STEP 1: Initialize Relayer Client
    console.log('🔧 [UNSHIELD DEBUG] Step 1: Initializing WakuRelayerClient...');
    const relayerInitialized = await initializeRelayerClient(chain);
    console.log('🔧 [UNSHIELD DEBUG] WakuRelayerClient initialization result:', {
      success: relayerInitialized,
      isStarted: WakuRelayerClient.isStarted ? WakuRelayerClient.isStarted() : 'unknown',
    });

    if (!relayerInitialized) {
      console.warn('⚠️ [UNSHIELD DEBUG] Relayer initialization failed - proceeding with self-signing');
    } else {
      // STEP 2: Find Best Relayer
      console.log('🔍 [UNSHIELD DEBUG] Step 2: Searching for available relayers...');
      try {
        selectedRelayer = await findBestRelayerForUnshield(chain, tokenAddress);
        console.log('🔍 [UNSHIELD DEBUG] Relayer search result:', {
          found: !!selectedRelayer,
          relayerAddress: selectedRelayer?.railgunAddress?.substring(0, 20) + '...' || 'none',
          tokenFeeId: selectedRelayer?.tokenFee?.feesID || 'none',
        });
      } catch (relayerError) {
        console.error('❌ [UNSHIELD DEBUG] Relayer search failed:', relayerError.message);
        selectedRelayer = null;
      }
    }

    // STEP 3: Prepare transaction parameters
    console.log('🔧 [UNSHIELD DEBUG] Step 3: Preparing transaction parameters...');
    
    let broadcasterFeeERC20AmountRecipient = null;
    let overallBatchMinGasPrice = '0x0';
    let sendWithPublicWallet = true; // Default for self-signing

    if (selectedRelayer) {
      console.log('💰 [UNSHIELD DEBUG] Using relayer - calculating broadcaster fees...');
      usedRelayer = true;
      privacyLevel = 'high-privacy';
      sendWithPublicWallet = false;

      // Calculate broadcaster fee
      broadcasterFeeERC20AmountRecipient = {
        tokenAddress,
        recipientAddress: selectedRelayer.railgunAddress,
        amount: selectedRelayer.tokenFee.feePerUnitGas,
      };

              // Calculate gas price with relayer fee
        try {
          // Create properly formatted ERC20AmountRecipient for gas estimation
          const gasEstimationRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
          
          const gasDetailsWithFee = await estimateGasWithBroadcasterFee({
            txidVersion: TXIDVersion.V2_PoseidonMerkle,
            networkName: chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
            railgunWalletID,
            memoText: undefined,
            erc20AmountRecipients: [gasEstimationRecipient],
          nftAmountRecipients: [],
          broadcasterFeeERC20AmountRecipient,
          sendWithPublicWallet: false,
        });

        overallBatchMinGasPrice = gasDetailsWithFee.overallBatchMinGasPrice;
        console.log('💰 [UNSHIELD DEBUG] Broadcaster fee calculated:', {
          feeAmount: selectedRelayer.tokenFee.feePerUnitGas,
          feeRecipient: selectedRelayer.railgunAddress?.substring(0, 20) + '...',
          overallBatchMinGasPrice,
        });
      } catch (feeError) {
        console.error('❌ [UNSHIELD DEBUG] Broadcaster fee estimation failed:', feeError.message);
        console.warn('🔄 [UNSHIELD DEBUG] Falling back to self-signing due to fee calculation error');
        selectedRelayer = null;
        usedRelayer = false;
        privacyLevel = 'self-signed';
        sendWithPublicWallet = true;
      }
    } else {
      console.log('🔐 [UNSHIELD DEBUG] No relayer available - using self-signing mode');
    }

    // STEP 4: Generate Proof
    console.log('🔮 [UNSHIELD DEBUG] Step 4: Generating unshield proof...');
    const proofStartTime = Date.now();
    
    // Create properly formatted ERC20AmountRecipient with BigInt conversion
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
    console.log('🔮 [UNSHIELD DEBUG] Created ERC20AmountRecipient:', {
      tokenAddress: erc20AmountRecipient.tokenAddress,
      amount: erc20AmountRecipient.amount.toString(),
      recipientAddress: erc20AmountRecipient.recipientAddress,
    });
    
            const proofResult = await generateUnshieldProof(
      TXIDVersion.V2_PoseidonMerkle,
      chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
      railgunWalletID,
      encryptionKey, // Encryption key is required
      [erc20AmountRecipient], // Use properly formatted recipient
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      (progress) => {
        console.log(`🔮 [UNSHIELD DEBUG] Proof generation progress: ${Math.round(progress * 100)}%`);
      }
    );

    const proofDuration = Date.now() - proofStartTime;
    console.log('🔮 [UNSHIELD DEBUG] Proof generation completed:', {
      duration: `${proofDuration}ms`,
      success: proofResult?.success,
      message: proofResult?.message,
      note: 'Proof stored internally in SDK - nullifiers will come from populateProvedUnshield'
    });

        // STEP 5: Gas Estimation (following shield pattern)
    console.log('📝 [UNSHIELD DEBUG] Step 5: Estimating gas for unshield operation...');
    
    console.log('📝 [UNSHIELD DEBUG] Performing real gas estimation...');
    const gasEstimateResponse = await gasEstimateForUnprovenUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
      railgunWalletID,
      encryptionKey,
      [erc20AmountRecipient],
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice
    );
    
    // Extract the gas estimate from response
    const gasEstimate = gasEstimateResponse.gasEstimate || gasEstimateResponse;
    console.log('📝 [UNSHIELD DEBUG] Gas estimation completed:', {
      gasEstimate: gasEstimate.toString(),
      type: typeof gasEstimate
    });
    
    // Create proper gas details using the dedicated function (like shield transactions)
    const networkName = chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum;
    const gasDetails = createUnshieldGasDetails(networkName, sendWithPublicWallet, gasEstimate);
    
    console.log('📝 [UNSHIELD DEBUG] Gas details created:', {
      evmGasType: gasDetails.evmGasType,
      gasEstimate: gasDetails.gasEstimate.toString(),
      hasGasPrice: !!gasDetails.gasPrice,
      hasMaxFeePerGas: !!gasDetails.maxFeePerGas,
    });
    
    // STEP 6: Populate Transaction with real gas details
    console.log('📝 [UNSHIELD DEBUG] Step 6: Populating transaction with real gas...');
    console.log('📝 [UNSHIELD DEBUG] Using internally stored proof from SDK...');
    
    const populatedTransaction = await populateProvedUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
      railgunWalletID,
      [erc20AmountRecipient], // Reuse the properly formatted recipient
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      gasDetails // Now using REAL gas estimation
    );

    console.log('📝 [UNSHIELD DEBUG] Transaction populated:', {
      to: populatedTransaction.transaction.to,
      dataLength: populatedTransaction.transaction.data?.length || 0,
      gasLimit: populatedTransaction.transaction.gasLimit,
      hasNullifiers: !!populatedTransaction.nullifiers,
      nullifiersCount: populatedTransaction.nullifiers?.length || 0,
      populatedTransactionKeys: Object.keys(populatedTransaction),
    });

    // STEP 7: Submit Transaction
    console.log('📡 [UNSHIELD DEBUG] Step 7: Submitting transaction...');
    console.log('📡 [UNSHIELD DEBUG] Transaction submission decision:', {
      hasSelectedRelayer: !!selectedRelayer,
      usedRelayer,
      selectedRelayerAddress: selectedRelayer?.railgunAddress?.substring(0, 20) + '...' || 'none',
      willUseRelayer: !!(selectedRelayer && usedRelayer),
      willSelfSign: !(selectedRelayer && usedRelayer),
    });
    
    let transactionHash = null;

    if (selectedRelayer && usedRelayer) {
      console.log('🚀 [UNSHIELD DEBUG] Attempting relayer submission...');
      try {
        // Create relayer transaction
        console.log('🔧 [UNSHIELD DEBUG] Creating RelayerTransaction...');
        
        // Get nullifiers from populated transaction (only source in new SDK pattern)
        const nullifiers = populatedTransaction.nullifiers || [];
        console.log('🔧 [UNSHIELD DEBUG] Nullifiers for relayer transaction:', {
          fromPopulatedTx: !!populatedTransaction.nullifiers,
          nullifiersCount: nullifiers.length,
          nullifiersSource: 'populatedTransaction (SDK internal proof pattern)'
        });
        
        if (!nullifiers.length) {
          throw new Error('No nullifiers found in populated transaction - proof generation may have failed');
        }
        
        const relayerTransaction = await createRelayerTransaction(
          populatedTransaction.transaction.to,
          populatedTransaction.transaction.data,
          selectedRelayer.railgunAddress,
          selectedRelayer.tokenFee.feesID,
          chain,
          nullifiers,
          overallBatchMinGasPrice,
          false // useRelayAdapt
        );

        console.log('🔧 [UNSHIELD DEBUG] RelayerTransaction created successfully');

        // Submit via relayer
        console.log('📤 [UNSHIELD DEBUG] Sending transaction via relayer...');
        transactionHash = await submitRelayerTransaction(relayerTransaction);
        
        console.log('✅ [UNSHIELD DEBUG] Relayer submission successful!', {
          transactionHash,
          privacyLevel: 'high-privacy',
          relayerUsed: true,
        });

      } catch (relayerSubmissionError) {
        console.error('❌ [UNSHIELD DEBUG] Relayer submission failed:', relayerSubmissionError.message);
        console.warn('🔄 [UNSHIELD DEBUG] Falling back to self-signing...');
        
        // Regenerate proof for self-signing
        console.log('🔮 [UNSHIELD DEBUG] Regenerating proof for self-signing...');
        
        // Create new ERC20AmountRecipient for self-signing (reuse same values)
        const selfSignRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
        
        const selfSignResult = await generateUnshieldProof(
          TXIDVersion.V2_PoseidonMerkle,
          chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
          railgunWalletID,
          encryptionKey, // Encryption key is required
          [selfSignRecipient],
          [], // nftAmountRecipients
          null, // broadcasterFeeERC20AmountRecipient - No broadcaster fee for self-signing
          true, // sendWithPublicWallet
          '0x0', // overallBatchMinGasPrice
          (progress) => {
            console.log(`🔮 [UNSHIELD DEBUG] Fallback proof generation: ${Math.round(progress * 100)}%`);
          }
        );

        console.log('🔮 [UNSHIELD DEBUG] Fallback proof result:', selfSignResult);

        // Re-estimate gas for self-signing mode
        const fallbackGasEstimateResponse = await gasEstimateForUnprovenUnshield(
          TXIDVersion.V2_PoseidonMerkle,
          chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
          railgunWalletID,
          encryptionKey,
          [selfSignRecipient],
          [], // nftAmountRecipients
          null, // broadcasterFeeERC20AmountRecipient
          true, // sendWithPublicWallet
          '0x0' // overallBatchMinGasPrice
        );
        
        const fallbackGasEstimate = fallbackGasEstimateResponse.gasEstimate || fallbackGasEstimateResponse;
        const fallbackGasDetails = createUnshieldGasDetails(
          chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
          true, // sendWithPublicWallet for fallback
          fallbackGasEstimate
        );

        // Repopulate transaction for self-signing using internally stored proof
        const selfSignTx = await populateProvedUnshield(
          TXIDVersion.V2_PoseidonMerkle,
          chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum,
          railgunWalletID,
          [selfSignRecipient], // Reuse the properly formatted recipient
          [], // nftAmountRecipients
          null, // broadcasterFeeERC20AmountRecipient
          true, // sendWithPublicWallet
          '0x0', // overallBatchMinGasPrice
          fallbackGasDetails // Use fallback gas estimation
        );

        // Submit self-signed transaction
        transactionHash = await submitTransactionSelfSigned(selfSignTx, walletProvider);
        usedRelayer = false;
        privacyLevel = 'self-signed';
      }
    } else {
      console.log('🔐 [UNSHIELD DEBUG] Using self-signing mode (no relayer available)');
      transactionHash = await submitTransactionSelfSigned(populatedTransaction, walletProvider);
    }

    console.log('🎉 [UNSHIELD DEBUG] Unshield transaction completed successfully!', {
      transactionHash,
      usedRelayer,
      privacyLevel,
      relayerAddress: selectedRelayer?.railgunAddress?.substring(0, 20) + '...' || 'none',
      timestamp: new Date().toISOString(),
    });

    return {
      transactionHash,
      usedRelayer,
      privacyLevel,
      selectedRelayer,
    };

  } catch (error) {
    console.error('💥 [UNSHIELD DEBUG] Unshield transaction failed:', {
      error: error.message,
      stack: error.stack,
      step: 'unknown',
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
};

export default {
  unshieldTokens,
}; 