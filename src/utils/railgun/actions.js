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

