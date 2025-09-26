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
// Import our custom unshield implementation
import { unshieldTokens } from './tx-unshield.js';
import { privateTransferWithRelayer } from './private-transfer.js';

// Import our new modular utilities
import { shieldTokens } from './shieldTransactions.js';
// Removed: tx-transfer.js merged into tx-unshield.js (privateTransferWithRelayer)
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

// Re-export the custom unshield implementation
export { unshieldTokens };

/**
 * TRANSFER: Send tokens privately between Railgun wallets
 * Uses tx-generator.js for comprehensive transaction generation
 * ✅ ENHANCED: Includes Graph monitoring integration
 */
export const transferTokens = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  recipients, // Array of {tokenAddress, amount, recipientAddress}
  selectedBroadcaster = null,
  txConfig = {},
  chainId = null, // Required for Graph monitoring
  walletProvider = null, // Required for transaction sending
  enableGraphMonitoring = true, // Enable/disable Graph monitoring
}) => {
  try {
    console.log('[RailgunActions] Starting private transfer:', {
      networkName,
      recipientCount: recipients?.length,
      hasBroadcaster: !!selectedBroadcaster,
      enableGraphMonitoring,
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

    console.log('[RailgunActions] Private transfer transaction generated successfully');

    // If wallet provider is available, send the transaction and start monitoring
    let txHash = null;
    if (walletProvider && result.transaction) {
      try {
        console.log('[RailgunActions] Sending transfer transaction...');
        
        // Send transaction to the blockchain
        txHash = await walletProvider.request({
          method: 'eth_sendTransaction',
          params: [result.transaction],
        });
        
        console.log('[RailgunActions] Transfer transaction sent:', txHash);

        // ✅ Start Graph monitoring if enabled
        if (enableGraphMonitoring && chainId && txHash) {
          console.log('[RailgunActions] Starting Graph monitoring for transfer...');
          
          try {
            const { monitorTransactionInGraph } = await import('./transactionMonitor.js');
            
            // Start monitoring in background (don't await)
            monitorTransactionInGraph({
              txHash,
              chainId,
              transactionType: 'transfer',
              listener: async (event) => {
                console.log(`[RailgunActions] ✅ Transfer tx ${txHash} indexed on chain ${chainId}`);
                
                // 🎯 FIXED: Just log - let useBalances hook handle refresh when appropriate
                console.log('[RailgunActions] Transfer confirmed and indexed! Balance will update via event system.');
              }
            })
            .then((monitorResult) => {
              if (monitorResult.found) {
                console.log(`[RailgunActions] Transfer monitoring completed in ${monitorResult.elapsedTime/1000}s`);
              } else {
                console.warn('[RailgunActions] Transfer monitoring timed out');
              }
            })
            .catch((error) => {
              console.error('[RailgunActions] Transfer Graph monitoring failed:', error);
            });
            
          } catch (monitorError) {
            console.error('[RailgunActions] Failed to start transfer monitoring:', monitorError);
          }
        }
        
      } catch (sendError) {
        console.error('[RailgunActions] Failed to send transfer transaction:', sendError);
        throw new Error(`Failed to send transfer transaction: ${sendError.message}`);
      }
    }

    return {
      ...result,
      txHash, // Include transaction hash in response
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
 * PRIVATE TRANSFER (memo-capable, single-recipient convenience)
 * Uses tx-transfer.js to mirror SDK structure and include memo support.
 */
export const privateTransfer = async ({
  chainId,
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  recipientRailgunAddress,
  memoText = undefined,
  walletProvider = null,
}) => {
  try {
    const networkName = getRailgunNetworkName(chainId);
    
    // Resolve recipient: could be Lexie ID, Railgun address, or ENS
    let resolvedRecipient = recipientRailgunAddress;

    console.log('📤 [PRIVATE_TRANSFER] ===== RECIPIENT RESOLUTION START =====');
    console.log('📤 [PRIVATE_TRANSFER] Original recipient input:', {
      input: recipientRailgunAddress,
      type: typeof recipientRailgunAddress,
      isRailgunAddress: recipientRailgunAddress?.startsWith?.('0zk'),
      inputLength: recipientRailgunAddress?.length,
      isNull: recipientRailgunAddress === null,
      isUndefined: recipientRailgunAddress === undefined
    });

    // Check if it's a Lexie ID and resolve to Railgun address
    if (recipientRailgunAddress && typeof recipientRailgunAddress === 'string') {
      const input = recipientRailgunAddress.trim();

      console.log('🔍 [PRIVATE_TRANSFER] Processing recipient input:', {
        rawInput: recipientRailgunAddress,
        trimmedInput: input,
        startsWith0zk: input.startsWith('0zk'),
        length: input.length,
        isEmpty: input === ''
      });

      // If it's not already a Railgun address (0zk...), try to resolve it
      if (!input.startsWith('0zk')) {
        console.log('🔎 [PRIVATE_TRANSFER] Input is NOT a Railgun address, attempting resolution:', input);

        // Check if it's a Lexie ID pattern
        const lexieIdPattern = /^[a-zA-Z0-9_]{3,20}$/;
        const isValidLexieId = lexieIdPattern.test(input.toLowerCase());

        console.log('🎯 [PRIVATE_TRANSFER] Lexie ID pattern check:', {
          input: input,
          pattern: lexieIdPattern.toString(),
          matchesPattern: isValidLexieId,
          lowercaseInput: input.toLowerCase()
        });

        if (isValidLexieId) {
          console.log('🎯 [PRIVATE_TRANSFER] Valid Lexie ID pattern detected, attempting Redis lookup:', input.toLowerCase());

          try {
            const response = await fetch(`/api/wallet-metadata?action=lexie-resolve&lexieID=${encodeURIComponent(input.toLowerCase())}`);
            console.log('📡 [PRIVATE_TRANSFER] API response status:', response.status);

            const data = await response.json();
            console.log('📡 [PRIVATE_TRANSFER] API response data:', {
              success: data.success,
              hasWalletAddress: !!data.walletAddress,
              walletAddressLength: data.walletAddress?.length,
              error: data.error,
              fullResponse: data
            });

            if (data.success && data.walletAddress) {
              resolvedRecipient = data.walletAddress;
              console.log('✅ [PRIVATE_TRANSFER] SUCCESS - Lexie ID resolved to Railgun address:', {
                originalLexieID: input,
                resolvedRailgunAddress: resolvedRecipient,
                addressLength: resolvedRecipient.length,
                startsWith0zk: resolvedRecipient.startsWith('0zk'),
                first20Chars: resolvedRecipient.substring(0, 20) + '...'
              });
            } else {
              console.error('❌ [PRIVATE_TRANSFER] API returned success=false or no wallet address:', {
                success: data.success,
                error: data.error,
                hasWalletAddress: !!data.walletAddress
              });
              throw new Error(`Lexie ID "${input}" not found or not linked to a wallet`);
            }
          } catch (lexieError) {
            console.error('❌ [PRIVATE_TRANSFER] Lexie ID resolution failed:', {
              error: lexieError.message,
              stack: lexieError.stack?.substring(0, 500),
              input: input,
              apiUrl: `/api/lexie/resolve?lexieID=${encodeURIComponent(input.toLowerCase())}`
            });
            throw new Error(`Could not resolve Lexie ID "${input}": ${lexieError.message}`);
          }
        } else {
          console.error('❌ [PRIVATE_TRANSFER] Invalid recipient format - does not match Lexie ID pattern:', {
            input: input,
            pattern: lexieIdPattern.toString(),
            matchesPattern: isValidLexieId,
            inputLength: input.length,
            containsSpecialChars: /[^a-zA-Z0-9_]/.test(input)
          });
          throw new Error(`Invalid recipient format: "${input}". Must be a Lexie ID (3-20 chars, alphanumeric + underscore) or Railgun address (0zk...)`);
        }
      } else {
        console.log('✅ [PRIVATE_TRANSFER] Input is already a valid Railgun address - no resolution needed:', {
          address: input,
          length: input.length,
          first20Chars: input.substring(0, 20) + '...',
          last10Chars: input.substring(input.length - 10)
        });
        resolvedRecipient = input;
      }
    } else {
      console.warn('⚠️ [PRIVATE_TRANSFER] Invalid recipient input:', {
        recipientRailgunAddress,
        type: typeof recipientRailgunAddress,
        isNull: recipientRailgunAddress === null,
        isUndefined: recipientRailgunAddress === undefined
      });
    }
    
    // Validate final recipient is a Railgun address
    if (!resolvedRecipient || !resolvedRecipient.startsWith('0zk')) {
      console.error('❌ [PRIVATE_TRANSFER] Final recipient validation FAILED:', {
        resolvedRecipient,
        type: typeof resolvedRecipient,
        isNull: resolvedRecipient === null,
        isUndefined: resolvedRecipient === undefined,
        startsWith0zk: resolvedRecipient?.startsWith?.('0zk'),
        length: resolvedRecipient?.length
      });
      throw new Error(`Invalid Railgun address: "${resolvedRecipient}". Private transfers require a Railgun address (0zk...)`);
    }

    console.log('✅ [PRIVATE_TRANSFER] ===== RECIPIENT RESOLUTION COMPLETE =====');
    console.log('✅ [PRIVATE_TRANSFER] Final recipient address validated:', {
      railgunAddress: resolvedRecipient,
      length: resolvedRecipient.length,
      startsWith0zk: resolvedRecipient.startsWith('0zk'),
      first30Chars: resolvedRecipient.substring(0, 30) + '...',
      last20Chars: '...' + resolvedRecipient.substring(resolvedRecipient.length - 20),
      originalInput: recipientRailgunAddress,
      wasResolutionNeeded: recipientRailgunAddress !== resolvedRecipient
    });
    
    const erc20AmountRecipients = [{ tokenAddress, amount: BigInt(amount), recipientAddress: resolvedRecipient }];

    console.log('🚀 [PRIVATE_TRANSFER] ===== TRANSACTION EXECUTION =====');
    console.log('🚀 [PRIVATE_TRANSFER] Transaction parameters:', {
      networkName,
      tokenAddress,
      amount: amount.toString(),
      amountBigInt: BigInt(amount).toString(),
      recipientAddress: resolvedRecipient,
      recipientLength: resolvedRecipient.length,
      memoText: memoText || 'none',
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        amount: r.amount.toString(),
        recipientAddress: r.recipientAddress.substring(0, 30) + '...'
      }))
    });

    // Use our relayer path for private transfers
    console.log('🚀 [PRIVATE_TRANSFER] Calling privateTransferWithRelayer...');
    const { transactionHash } = await privateTransferWithRelayer({
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      memoText,
      networkName,
    });

    console.log('✅ [PRIVATE_TRANSFER] Transaction submitted successfully:', {
      transactionHash,
      recipientAddress: resolvedRecipient,
      amount: amount.toString(),
      networkName
    });

    return {
      txHash: transactionHash,
      resolvedRecipientAddress: resolvedRecipient, // Add resolved recipient for timeline
      originalRecipientInput: recipientRailgunAddress // Keep original input for reference
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

