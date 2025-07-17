/**
 * Railgun Privacy Actions
 * Implements Shield, Transfer, and Unshield operations using the Railgun SDK
 */

import {
  shieldERC20,
  shieldBaseToken,
  unshieldERC20,
  unshieldBaseToken,
  transact,
  estimateGasForUnprovenTransaction,
  generateTransactionProof,
} from '@railgun-community/wallet';
import { formatUnits, parseUnits, getAddress } from 'ethers';

import { waitForRailgunReady } from './engine.js';
import { getTokensForChain } from '../../constants/tokens.js';

/**
 * Shield ERC20 tokens into Railgun (Public → Private)
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to shield (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} fromAddress - EOA address sending the tokens
 * @returns {Object} Transaction result
 */
export const shieldTokens = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, fromAddress) => {
  try {
    console.log('[RailgunActions] Shielding tokens:', {
      tokenAddress,
      amount,
      chain: chain.type,
      from: fromAddress,
    });

    await waitForRailgunReady();

    // Estimate gas first
    const gasDetails = await estimateShieldGas(railgunWalletID, encryptionKey, tokenAddress, amount, chain);
    
    let txResult;
    
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Shield native token (ETH, MATIC, BNB, etc.)
      txResult = await shieldBaseToken(
        railgunWalletID,
        amount,
        chain,
        gasDetails,
        encryptionKey
      );
    } else {
      // Shield ERC20 token
      txResult = await shieldERC20(
        railgunWalletID,
        tokenAddress,
        amount,
        chain,
        gasDetails,
        encryptionKey
      );
    }

    console.log('[RailgunActions] Shield transaction result:', txResult);
    return { success: true, txResult };
  } catch (error) {
    console.error('[RailgunActions] Shield failed:', error);
    throw new Error(`Shield failed: ${error.message}`);
  }
};

/**
 * Unshield tokens from Railgun (Private → Public)
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to unshield (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} toAddress - Destination EOA address
 * @returns {Object} Transaction result
 */
export const unshieldTokens = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, toAddress) => {
  try {
    console.log('[RailgunActions] Unshielding tokens:', {
      tokenAddress,
      amount,
      chain: chain.type,
      to: toAddress,
    });

    await waitForRailgunReady();

    // Validate destination address
    const checksummedTo = getAddress(toAddress);

    // Estimate gas first
    const gasDetails = await estimateUnshieldGas(railgunWalletID, encryptionKey, tokenAddress, amount, chain, checksummedTo);
    
    let txResult;
    
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Unshield native token
      txResult = await unshieldBaseToken(
        railgunWalletID,
        amount,
        checksummedTo,
        chain,
        gasDetails,
        encryptionKey
      );
    } else {
      // Unshield ERC20 token
      txResult = await unshieldERC20(
        railgunWalletID,
        tokenAddress,
        amount,
        checksummedTo,
        chain,
        gasDetails,
        encryptionKey
      );
    }

    console.log('[RailgunActions] Unshield transaction result:', txResult);
    return { success: true, txResult };
  } catch (error) {
    console.error('[RailgunActions] Unshield failed:', error);
    throw new Error(`Unshield failed: ${error.message}`);
  }
};

/**
 * Private transfer between Railgun wallets (Private → Private)
 * @param {string} fromRailgunWalletID - Sender's Railgun wallet ID
 * @param {string} encryptionKey - Sender's wallet encryption key
 * @param {string} toRailgunAddress - Recipient's Railgun address (0zk...)
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to transfer (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} memo - Optional memo for the transfer
 * @returns {Object} Transaction result
 */
export const transferPrivate = async (fromRailgunWalletID, encryptionKey, toRailgunAddress, tokenAddress, amount, chain, memo = '') => {
  try {
    console.log('[RailgunActions] Private transfer:', {
      to: toRailgunAddress,
      tokenAddress,
      amount,
      chain: chain.type,
      memo,
    });

    await waitForRailgunReady();

    // Validate Railgun address format
    if (!toRailgunAddress.startsWith('0zk')) {
      throw new Error('Invalid Railgun address format. Must start with "0zk"');
    }

    // Prepare transfer data
    const transferData = [{
      toAddress: toRailgunAddress,
      tokenAddress: tokenAddress || '0x0000000000000000000000000000000000000000',
      amount,
      memo: memo || undefined,
    }];

    // Estimate gas first
    const gasDetails = await estimateTransferGas(fromRailgunWalletID, encryptionKey, transferData, chain);

    // Execute private transfer
    const txResult = await transact(
      fromRailgunWalletID,
      transferData,
      chain,
      gasDetails,
      encryptionKey
    );

    console.log('[RailgunActions] Private transfer result:', txResult);
    return { success: true, txResult };
  } catch (error) {
    console.error('[RailgunActions] Private transfer failed:', error);
    throw new Error(`Private transfer failed: ${error.message}`);
  }
};

/**
 * Shield multiple tokens at once (Shield All functionality)
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} tokens - Array of token objects with {address, amount, symbol}
 * @param {Object} chain - Chain configuration
 * @param {string} fromAddress - EOA address sending the tokens
 * @returns {Object} Results of all shield operations
 */
export const shieldAllTokens = async (railgunWalletID, encryptionKey, tokens, chain, fromAddress) => {
  try {
    console.log('[RailgunActions] Shielding all tokens:', {
      tokenCount: tokens.length,
      chain: chain.type,
      from: fromAddress,
    });

    await waitForRailgunReady();

    const results = [];
    const errors = [];

    // Process each token sequentially to avoid gas estimation conflicts
    for (const token of tokens) {
      try {
        const result = await shieldTokens(
          railgunWalletID,
          encryptionKey,
          token.address,
          token.amount,
          chain,
          fromAddress
        );
        
        results.push({
          token: token.symbol,
          success: true,
          result,
        });
        
        console.log(`[RailgunActions] ✅ Shielded ${token.symbol} successfully`);
      } catch (error) {
        const errorMsg = `Failed to shield ${token.symbol}: ${error.message}`;
        errors.push(errorMsg);
        
        results.push({
          token: token.symbol,
          success: false,
          error: errorMsg,
        });
        
        console.error(`[RailgunActions] ❌ Failed to shield ${token.symbol}:`, error);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log('[RailgunActions] Shield All complete:', {
      total: tokens.length,
      successful: successCount,
      failed: failureCount,
    });

    return {
      success: errors.length === 0,
      results,
      summary: {
        total: tokens.length,
        successful: successCount,
        failed: failureCount,
        errors,
      },
    };
  } catch (error) {
    console.error('[RailgunActions] Shield All failed:', error);
    throw new Error(`Shield All failed: ${error.message}`);
  }
};

/**
 * Estimate gas for shield operations
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address
 * @param {string} amount - Amount to shield
 * @param {Object} chain - Chain configuration
 * @returns {Object} Gas details
 */
export const estimateShieldGas = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain) => {
  try {
    console.log('[RailgunActions] Estimating shield gas...');

    const gasEstimate = await estimateGasForUnprovenTransaction(
      railgunWalletID,
      encryptionKey,
      tokenAddress ? 'shield-erc20' : 'shield-base',
      {
        tokenAddress,
        amount,
      },
      chain
    );

    console.log('[RailgunActions] Shield gas estimate:', gasEstimate);
    return gasEstimate;
  } catch (error) {
    console.warn('[RailgunActions] Gas estimation failed, using fallback:', error.message);
    
    // Fallback gas details
    return {
      gasLimit: BigInt(300000), // 300k gas limit fallback
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

/**
 * Estimate gas for unshield operations
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address
 * @param {string} amount - Amount to unshield
 * @param {Object} chain - Chain configuration
 * @param {string} toAddress - Destination address
 * @returns {Object} Gas details
 */
export const estimateUnshieldGas = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, toAddress) => {
  try {
    console.log('[RailgunActions] Estimating unshield gas...');

    const gasEstimate = await estimateGasForUnprovenTransaction(
      railgunWalletID,
      encryptionKey,
      tokenAddress ? 'unshield-erc20' : 'unshield-base',
      {
        tokenAddress,
        amount,
        toAddress,
      },
      chain
    );

    console.log('[RailgunActions] Unshield gas estimate:', gasEstimate);
    return gasEstimate;
  } catch (error) {
    console.warn('[RailgunActions] Gas estimation failed, using fallback:', error.message);
    
    // Fallback gas details
    return {
      gasLimit: BigInt(400000), // 400k gas limit fallback
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

/**
 * Estimate gas for private transfer operations
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} transferData - Transfer data array
 * @param {Object} chain - Chain configuration
 * @returns {Object} Gas details
 */
export const estimateTransferGas = async (railgunWalletID, encryptionKey, transferData, chain) => {
  try {
    console.log('[RailgunActions] Estimating transfer gas...');

    const gasEstimate = await estimateGasForUnprovenTransaction(
      railgunWalletID,
      encryptionKey,
      'transfer',
      { transfers: transferData },
      chain
    );

    console.log('[RailgunActions] Transfer gas estimate:', gasEstimate);
    return gasEstimate;
  } catch (error) {
    console.warn('[RailgunActions] Gas estimation failed, using fallback:', error.message);
    
    // Fallback gas details
    return {
      gasLimit: BigInt(500000), // 500k gas limit fallback
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

/**
 * Check if a token is supported by Railgun on the current chain
 * @param {string} tokenAddress - Token contract address
 * @param {number} chainId - Chain ID
 * @returns {boolean} True if supported
 */
export const isTokenSupportedByRailgun = (tokenAddress, chainId) => {
  const supportedTokens = getTokensForChain(chainId);
  
  if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
    // Native token - check if chain has native token support
    return Object.values(supportedTokens).some(token => token.isNative);
  }
  
  // ERC20 token - check by address
  return Object.values(supportedTokens).some(token => 
    token.address && getAddress(token.address) === getAddress(tokenAddress)
  );
};

/**
 * Get supported tokens for shielding on a specific chain
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of supported token objects
 */
export const getSupportedTokensForShielding = (chainId) => {
  const tokens = getTokensForChain(chainId);
  return Object.values(tokens);
};

/**
 * Format amount for display
 * @param {string} amount - Amount in smallest units
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted amount
 */
export const formatTokenAmount = (amount, decimals = 18) => {
  try {
    return formatUnits(amount, decimals);
  } catch (error) {
    console.error('[RailgunActions] Error formatting amount:', error);
    return '0';
  }
};

/**
 * Parse amount from user input
 * @param {string} amount - User input amount
 * @param {number} decimals - Token decimals
 * @returns {string} Amount in smallest units
 */
export const parseTokenAmount = (amount, decimals = 18) => {
  try {
    return parseUnits(amount, decimals).toString();
  } catch (error) {
    console.error('[RailgunActions] Error parsing amount:', error);
    throw new Error('Invalid amount format');
  }
};

export default {
  shieldTokens,
  unshieldTokens,
  transferPrivate,
  shieldAllTokens,
  estimateShieldGas,
  estimateUnshieldGas,
  estimateTransferGas,
  isTokenSupportedByRailgun,
  getSupportedTokensForShielding,
  formatTokenAmount,
  parseTokenAmount,
}; 