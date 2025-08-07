/**
 * RAILGUN Unshield Proof Generation - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-proof-unshield.ts
 * Converted to JavaScript with custom enhancements for Lexie Wallet
 */

import {
  generateUnshieldProof as generateUnshieldProofSDK,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  ProofType,
} from '@railgun-community/shared-models';
import { reportAndSanitizeError } from './utils.js';
import { 
  RelayerConfig, 
  shouldUseRelayer, 
  getRelayerAddress 
} from './relayer-client.js';

/**
 * Generate unshield proof with progress tracking and gas relayer support
 * This wraps the official SDK proof generation with better error handling and logging
 * 
 * @param {TXIDVersion} txidVersion - Transaction ID version
 * @param {NetworkName} networkName - Network name
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} erc20AmountRecipients - ERC20 recipients
 * @param {Array} nftAmountRecipients - NFT recipients (usually empty for unshield)
 * @param {Object} broadcasterFeeERC20AmountRecipient - Broadcaster fee (optional)
 * @param {boolean} sendWithPublicWallet - Whether to send with public wallet
 * @param {bigint} overallBatchMinGasPrice - Minimum gas price (optional)
 * @param {Function} progressCallback - Progress callback function
 * @param {Object} relayerFeeDetails - Gas relayer fee details (optional)
 * @param {number} chainId - Chain ID for relayer support
 */
export const generateUnshieldProof = async (
  txidVersion,
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  broadcasterFeeERC20AmountRecipient,
  sendWithPublicWallet,
  overallBatchMinGasPrice,
  progressCallback,
  relayerFeeDetails = null,
  chainId = null
) => {
  try {
    console.log('[UnshieldProof] Starting proof generation...', {
      txidVersion,
      networkName,
      railgunWalletID: railgunWalletID.slice(0, 8) + '...',
      erc20Recipients: erc20AmountRecipients.length,
      nftRecipients: nftAmountRecipients.length,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      hasRelayerFee: !!relayerFeeDetails,
      chainId,
    });

    // Enhanced recipients array with relayer fee support
    let finalErc20Recipients = [...erc20AmountRecipients];
    let finalBroadcasterFee = broadcasterFeeERC20AmountRecipient;

    // Check if we should add relayer fee to the proof
    if (relayerFeeDetails && chainId && shouldUseRelayer(chainId, '0')) {
      console.log('[UnshieldProof] 🚀 Adding gas relayer fee to proof generation...');
      
      try {
        const relayerAddress = await getRelayerAddress();
        
        if (relayerAddress && relayerFeeDetails.totalFee) {
          // Extract token address from first recipient
          const primaryTokenAddress = erc20AmountRecipients[0]?.tokenAddress;
          
          if (primaryTokenAddress) {
            // Create relayer fee recipient
            const relayerFeeRecipient = {
              tokenAddress: primaryTokenAddress,
              amount: BigInt(relayerFeeDetails.totalFee),
              recipientAddress: relayerAddress,
            };
            
            console.log('[UnshieldProof] ✅ Relayer fee recipient created:', {
              tokenAddress: primaryTokenAddress.slice(0, 10) + '...',
              amount: relayerFeeDetails.totalFee,
              relayerAddress: relayerAddress.slice(0, 10) + '...',
            });
            
            // Add relayer fee to recipients
            finalErc20Recipients.push(relayerFeeRecipient);
          } else {
            console.warn('[UnshieldProof] ⚠️ No token address found for relayer fee');
          }
        } else {
          console.warn('[UnshieldProof] ⚠️ Missing relayer address or fee amount');
        }
      } catch (error) {
        console.error('[UnshieldProof] ❌ Failed to add relayer fee:', error);
        console.log('[UnshieldProof] 🔄 Continuing without relayer fee...');
      }
    }

    // Create a progress wrapper that provides better logging
    const wrappedProgressCallback = (progress) => {
      const percentage = Math.round(progress * 100);
      console.log(`[UnshieldProof] Generation progress: ${percentage}%`);
      
      // Call the original callback if provided
      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback(progress);
      }
    };

    // Call the official SDK proof generation function with enhanced recipients
    // Note: This function stores the proof internally, it doesn't return the proof response
    await generateUnshieldProofSDK(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      finalErc20Recipients, // Use enhanced recipients array with relayer fee
      nftAmountRecipients,
      finalBroadcasterFee,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      wrappedProgressCallback
    );

    console.log('[UnshieldProof] ✅ Proof generation completed successfully');
    console.log('[UnshieldProof] ℹ️ Proof is stored internally in SDK - will be used by populateProvedUnshield');
    
    // Return a success indicator - the actual proof is stored internally in the SDK
    return { success: true, message: 'Proof generated and stored internally' };

  } catch (error) {
    console.error('[UnshieldProof] ❌ Proof generation failed:', error);
    
    // Use the same error reporting as the official SDK
    const sanitizedError = reportAndSanitizeError('generateUnshieldProof', error);
    throw new Error(`Unshield proof generation failed: ${sanitizedError.message}`);
  }
};

/**
 * Validate proof generation parameters
 */
export const validateUnshieldProofParams = (
  txidVersion,
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients
) => {
  if (!txidVersion) {
    throw new Error('txidVersion is required');
  }
  if (!networkName) {
    throw new Error('networkName is required');
  }
  if (!railgunWalletID || typeof railgunWalletID !== 'string') {
    throw new Error('railgunWalletID must be a non-empty string');
  }
  if (!encryptionKey || typeof encryptionKey !== 'string') {
    throw new Error('encryptionKey must be a non-empty string');
  }
  if (!Array.isArray(erc20AmountRecipients)) {
    throw new Error('erc20AmountRecipients must be an array');
  }
  if (!Array.isArray(nftAmountRecipients)) {
    throw new Error('nftAmountRecipients must be an array');
  }
  if (erc20AmountRecipients.length === 0 && nftAmountRecipients.length === 0) {
    throw new Error('At least one recipient must be provided');
  }
};

export default {
  generateUnshieldProof,
  validateUnshieldProofParams,
}; 