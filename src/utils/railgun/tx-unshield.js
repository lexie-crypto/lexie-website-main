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
  EVMGasType,
  getEVMGasTypeForTransaction,
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

    // WALLET COMPATIBILITY FIX: For EIP-1559 transactions, some wallets expect gasPrice as fallback
    if (!txForSending.gasPrice && txForSending.maxFeePerGas) {
      console.log('[UnshieldTransactions] 🔧 Adding gasPrice fallback for wallet compatibility...');
      txForSending.gasPrice = txForSending.maxFeePerGas; // Use maxFeePerGas as gasPrice fallback
    }
    
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
      maxFeePerGas: txForSending.maxFeePerGas,
      maxPriorityFeePerGas: txForSending.maxPriorityFeePerGas,
      hasData: !!txForSending.data,
      allGasFields: {
        gasLimit: txForSending.gasLimit || 'MISSING',
        gasPrice: txForSending.gasPrice || 'MISSING', 
        maxFeePerGas: txForSending.maxFeePerGas || 'MISSING',
        maxPriorityFeePerGas: txForSending.maxPriorityFeePerGas || 'MISSING',
      }
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

    // VALIDATION: Ensure transaction has required fields before sending to wallet
    if (!txForSending.to) {
      throw new Error('Transaction missing contract address (to field)');
    }
    if (!txForSending.data || txForSending.data.length < 10) {
      throw new Error('Transaction missing or invalid call data');
    }
    if (!txForSending.gasLimit || txForSending.gasLimit === '0x0') {
      throw new Error('Transaction missing valid gas limit');
    }
    if (!txForSending.gasPrice && !txForSending.maxFeePerGas) {
      throw new Error('Transaction missing gas pricing (neither gasPrice nor maxFeePerGas)');
    }

    console.log('[UnshieldTransactions] ✅ Transaction validation passed, sending to wallet...');
    
    // Send transaction via wallet with retry logic for mobile wallet compatibility
    let txResponse;
    try {
      txResponse = await walletSigner.sendTransaction(txForSending);
      console.log('[UnshieldTransactions] ✅ Self-signed transaction sent');
    } catch (walletError) {
      console.warn('[UnshieldTransactions] 🔄 Primary transaction failed, trying simplified gas format...', walletError.message);
      
      // FALLBACK: Try with simplified gas format for mobile wallet compatibility
      const simplifiedTx = {
        to: txForSending.to,
        data: txForSending.data,
        value: txForSending.value,
        gasLimit: txForSending.gasLimit,
        // Use only gasPrice for maximum compatibility
        gasPrice: txForSending.gasPrice || txForSending.maxFeePerGas,
      };
      
      console.log('[UnshieldTransactions] 🔄 Retrying with simplified transaction format...', {
        to: simplifiedTx.to?.slice(0, 10) + '...',
        gasLimit: simplifiedTx.gasLimit,
        gasPrice: simplifiedTx.gasPrice,
        hasAllFields: !!(simplifiedTx.to && simplifiedTx.data && simplifiedTx.gasLimit && simplifiedTx.gasPrice),
      });
      
      txResponse = await walletSigner.sendTransaction(simplifiedTx);
      console.log('[UnshieldTransactions] ✅ Self-signed transaction sent (simplified format)');
    }
    
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

    // STEP 5: Gas Estimation (OFFICIAL SDK PATTERN)
    console.log('📝 [UNSHIELD DEBUG] Step 5: Following OFFICIAL SDK gas estimation pattern...');
    
    const networkName = chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum;
    
    // OFFICIAL PATTERN: Determine EVM gas type based on wallet type
    sendWithPublicWallet = true; // True for self-signing (we're not using relayer for this flow)
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    const originalGasEstimate = 0n; // Always start with 0 per official docs
    
    console.log('📝 [UNSHIELD DEBUG] Determined gas type (OFFICIAL):', {
      networkName,
      sendWithPublicWallet,
      evmGasType,
      gasTypeDescription: evmGasType === EVMGasType.Type0 ? 'Legacy (Type0)' : 
                         evmGasType === EVMGasType.Type1 ? 'Legacy (Type1)' : 
                         evmGasType === EVMGasType.Type2 ? 'EIP-1559 (Type2)' : 'Unknown'
    });
    
    // OFFICIAL PATTERN: Create original gas details based on determined gas type
    let originalGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        originalGasDetails = {
          evmGasType,
          gasEstimate: originalGasEstimate,
          gasPrice: BigInt('0x100000'), // Placeholder value per docs
        };
        break;
      case EVMGasType.Type2:
        originalGasDetails = {
          evmGasType,
          gasEstimate: originalGasEstimate,
          maxFeePerGas: BigInt('0x100000'), // Placeholder value per docs
          maxPriorityFeePerGas: BigInt('0x010000'), // Placeholder value per docs
        };
        break;
      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }
    
    console.log('📝 [UNSHIELD DEBUG] Created original gas details:', {
      evmGasType: originalGasDetails.evmGasType,
      gasEstimate: originalGasDetails.gasEstimate.toString(),
      hasGasPrice: !!originalGasDetails.gasPrice,
      hasMaxFeePerGas: !!originalGasDetails.maxFeePerGas,
    });

    // OFFICIAL PATTERN: Call gas estimation with proper parameters
    console.log('📝 [UNSHIELD DEBUG] Calling gasEstimateForUnprovenUnshield...');
    const gasEstimateResponse = await gasEstimateForUnprovenUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      [erc20AmountRecipient],
      [], // nftAmountRecipients
      originalGasDetails, // Pass the properly structured original gas details
      null, // feeTokenDetails (null for self-signing)
      sendWithPublicWallet
    );
    
    // Extract the final gas estimate
    const finalGasEstimate = gasEstimateResponse.gasEstimate;
    console.log('📝 [UNSHIELD DEBUG] Gas estimation completed:', {
      finalGasEstimate: finalGasEstimate.toString(),
      type: typeof finalGasEstimate
    });

    // OFFICIAL PATTERN: Create final transaction gas details with actual estimate
    let gasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        gasDetails = {
          evmGasType,
          gasEstimate: finalGasEstimate,
          gasPrice: originalGasDetails.gasPrice, // Keep the gas price from original
        };
        break;
      case EVMGasType.Type2:
        gasDetails = {
          evmGasType,
          gasEstimate: finalGasEstimate,
          maxFeePerGas: originalGasDetails.maxFeePerGas, // Keep from original
          maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas, // Keep from original
        };
        break;
    }
    
    console.log('📝 [UNSHIELD DEBUG] Gas details created (SHIELD PATTERN):', {
      evmGasType: gasDetails.evmGasType,
      gasEstimate: gasDetails.gasEstimate.toString(),
      hasGasPrice: !!gasDetails.gasPrice,
      hasMaxFeePerGas: !!gasDetails.maxFeePerGas,
      gasPrice: gasDetails.gasPrice ? gasDetails.gasPrice.toString() : 'undefined',
      maxFeePerGas: gasDetails.maxFeePerGas ? gasDetails.maxFeePerGas.toString() : 'undefined',
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
        // FALLBACK: Use same official SDK pattern for gas estimation
        const fallbackNetworkName = chain.type === 0 ? NetworkName.Ethereum : NetworkName.Arbitrum;
        const fallbackSendWithPublicWallet = true; // Self-signing fallback
        const fallbackEvmGasType = getEVMGasTypeForTransaction(fallbackNetworkName, fallbackSendWithPublicWallet);
        
        // Create fallback original gas details
        let fallbackOriginalGasDetails;
        switch (fallbackEvmGasType) {
          case EVMGasType.Type0:
          case EVMGasType.Type1:
            fallbackOriginalGasDetails = {
              evmGasType: fallbackEvmGasType,
              gasEstimate: 0n,
              gasPrice: BigInt('0x100000'),
            };
            break;
          case EVMGasType.Type2:
            fallbackOriginalGasDetails = {
              evmGasType: fallbackEvmGasType,
              gasEstimate: 0n,
              maxFeePerGas: BigInt('0x100000'),
              maxPriorityFeePerGas: BigInt('0x010000'),
            };
            break;
        }

        const fallbackGasEstimateResponse = await gasEstimateForUnprovenUnshield(
          TXIDVersion.V2_PoseidonMerkle,
          fallbackNetworkName,
          railgunWalletID,
          encryptionKey,
          [selfSignRecipient],
          [], // nftAmountRecipients
          fallbackOriginalGasDetails, // Use structured gas details
          null, // feeTokenDetails
          fallbackSendWithPublicWallet
        );
        
        const fallbackGasEstimate = fallbackGasEstimateResponse.gasEstimate;
        
        // Create final fallback gas details
        let fallbackGasDetails;
        switch (fallbackEvmGasType) {
          case EVMGasType.Type0:
          case EVMGasType.Type1:
            fallbackGasDetails = {
              evmGasType: fallbackEvmGasType,
              gasEstimate: fallbackGasEstimate,
              gasPrice: fallbackOriginalGasDetails.gasPrice,
            };
            break;
          case EVMGasType.Type2:
            fallbackGasDetails = {
              evmGasType: fallbackEvmGasType,
              gasEstimate: fallbackGasEstimate,
              maxFeePerGas: fallbackOriginalGasDetails.maxFeePerGas,
              maxPriorityFeePerGas: fallbackOriginalGasDetails.maxPriorityFeePerGas,
            };
            break;
        }

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

    // Start transaction monitoring for balance updates
    if (transactionHash && chain.id) {
      console.log('🔍 [UNSHIELD DEBUG] Starting transaction monitoring for balance updates...');
      try {
        const { monitorTransactionInGraph } = await import('./transactionMonitor.js');
        
        // Start monitoring in background (don't await to avoid blocking the UI)
        monitorTransactionInGraph({
          txHash: transactionHash,
          chainId: chain.id,
          transactionType: 'unshield',
          transactionDetails: {
            amount: amount,
            tokenAddress,
            tokenSymbol: 'Token', // We don't have symbol readily available here
            toAddress,
          },
          listener: (event) => {
            console.log(`🎉 [UNSHIELD DEBUG] Transaction ${transactionHash} confirmed in Graph! Balance will update.`);
          }
        }).catch(monitorError => {
          console.warn('⚠️ [UNSHIELD DEBUG] Transaction monitoring failed (transaction still succeeded):', monitorError.message);
        });
      } catch (importError) {
        console.warn('⚠️ [UNSHIELD DEBUG] Could not start transaction monitoring:', importError.message);
      }
    }

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