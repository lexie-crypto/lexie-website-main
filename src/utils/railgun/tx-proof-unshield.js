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

/**
 * Generate unshield proof with progress tracking
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
  progressCallback
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
    });

    // Create a progress wrapper that provides better logging
    const wrappedProgressCallback = (progress) => {
      const percentage = Math.round(progress * 100);
      console.log(`[UnshieldProof] Generation progress: ${percentage}%`);
      
      // Call the original callback if provided
      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback(progress);
      }
    };

    // Call the official SDK proof generation function
    await generateUnshieldProofSDK(
      txidVersion,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
      wrappedProgressCallback
    );

    console.log('[UnshieldProof] ✅ Proof generation completed successfully');

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