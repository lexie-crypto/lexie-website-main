/**
 * Railgun Privacy Actions
 * Implements Shield, Transfer, and Unshield operations using the Railgun SDK
 */

import { formatUnits, parseUnits, getAddress } from 'ethers';
import { 
  gasEstimateForShield,
  generateShieldTransaction,
  populateShield,
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
} from '@railgun-community/wallet';
import { NetworkName } from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { getTokensForChain } from '../../constants/tokens.js';
import { deriveEncryptionKey } from './wallet.js';

// Helper to convert chain config to NetworkName
const getNetworkNameFromChainId = (chainId) => {
  switch (chainId) {
    case 1:
      return NetworkName.Ethereum;
    case 137:
      return NetworkName.Polygon;
    case 42161:
      return NetworkName.Arbitrum;
    case 56:
      return NetworkName.BNBChain;
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
};

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

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Prepare ERC20 amount object
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount,
      recipientAddress: undefined, // Shield to wallet, no specific recipient
    };

    // Generate proper encryption key from user address
    const properEncryptionKey = await deriveEncryptionKey(fromAddress, chain.id);
    
    // Get gas estimate first
    const gasDetails = await gasEstimateForShield(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
      fromAddress,
    );

    console.log('[RailgunActions] Gas estimate:', gasDetails);

    // Generate shield transaction
    const shieldTxResult = await generateShieldTransaction(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [erc20AmountRecipient], // erc20AmountRecipients  
      [], // nftAmountRecipients
      fromAddress,
    );

    console.log('[RailgunActions] Shield transaction generated:', shieldTxResult);

    if (!shieldTxResult.transaction) {
      throw new Error('Failed to generate shield transaction');
    }

    return { 
      success: true, 
      transaction: shieldTxResult.transaction,
      gasEstimate: gasDetails 
    };

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
 * @param {string} toAddress - EOA address receiving the tokens
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

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Generate proper encryption key
    const properEncryptionKey = await deriveEncryptionKey(toAddress, chain.id);

    // Prepare ERC20 amount recipient for unshield
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount,
      recipientAddress: toAddress,
    };

    // Get gas estimate
    const gasDetails = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Unshield gas estimate:', gasDetails);

    // Generate unshield proof
    const proofResult = await generateUnshieldProof(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Unshield proof generated:', proofResult);

    // Populate the proved unshield transaction
    const populatedResult = await populateProvedUnshield(
      networkName,
      railgunWalletID,
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Unshield transaction populated:', populatedResult);

    if (!populatedResult.transaction) {
      throw new Error('Failed to populate unshield transaction');
    }

    return { 
      success: true, 
      transaction: populatedResult.transaction,
      gasEstimate: gasDetails 
    };

  } catch (error) {
    console.error('[RailgunActions] Unshield failed:', error);
    throw new Error(`Unshield failed: ${error.message}`);
  }
};

/**
 * Transfer tokens privately within Railgun (Private → Private)
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to transfer (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} toRailgunAddress - Destination Railgun address
 * @param {string} fromAddress - Source address for encryption key generation
 * @returns {Object} Transaction result
 */
export const transferPrivate = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, toRailgunAddress, fromAddress) => {
  try {
    console.log('[RailgunActions] Transferring tokens privately:', {
      tokenAddress,
      amount,
      chain: chain.type,
      to: toRailgunAddress,
    });

    await waitForRailgunReady();

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Generate proper encryption key
    const properEncryptionKey = await deriveEncryptionKey(fromAddress, chain.id);

    // Prepare ERC20 amount recipient for private transfer
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount,
      recipientAddress: toRailgunAddress,
    };

    // Get gas estimate
    const gasDetails = await gasEstimateForUnprovenTransfer(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [], // memoText (optional)
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Transfer gas estimate:', gasDetails);

    // Generate transfer proof
    const proofResult = await generateTransferProof(
      networkName,
      railgunWalletID,
      properEncryptionKey,
      [], // memoText (optional)
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Transfer proof generated:', proofResult);

    // Populate the proved transfer transaction
    const populatedResult = await populateProvedTransfer(
      networkName,
      railgunWalletID,
      [], // memoText (optional)
      [erc20AmountRecipient], // erc20AmountRecipients
      [], // nftAmountRecipients
    );

    console.log('[RailgunActions] Transfer transaction populated:', populatedResult);

    if (!populatedResult.transaction) {
      throw new Error('Failed to populate transfer transaction');
    }

    return { 
      success: true, 
      transaction: populatedResult.transaction,
      gasEstimate: gasDetails 
    };

  } catch (error) {
    console.error('[RailgunActions] Private transfer failed:', error);
    throw new Error(`Private transfer failed: ${error.message}`);
  }
};

/**
 * Shield multiple tokens at once (Shield All functionality)
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} tokens - Array of token objects with balance and address
 * @param {Object} chain - Chain configuration
 * @param {string} fromAddress - EOA address sending the tokens
 * @returns {Object} Shield results for all tokens
 */
export const shieldAllTokens = async (railgunWalletID, encryptionKey, tokens, chain, fromAddress) => {
  try {
    console.log('[RailgunActions] Shielding all tokens:', {
      tokensCount: tokens.length,
      chain: chain.type,
      from: fromAddress,
    });

    // Generate proper encryption key
    const properEncryptionKey = await deriveEncryptionKey(fromAddress, chain.id);

    const results = [];
    const errors = [];
    let successCount = 0;
    let failureCount = 0;

    for (const token of tokens) {
      try {
        const result = await shieldTokens(
          railgunWalletID,
          properEncryptionKey,
          token.address,
          token.balance,
          chain,
          fromAddress
        );
        
        results.push({
          token: token.symbol,
          success: true,
          result,
        });
        successCount++;
      } catch (error) {
        console.error(`[RailgunActions] Failed to shield ${token.symbol}:`, error);
        results.push({
          token: token.symbol,
          success: false,
          error: error.message,
        });
        errors.push(`${token.symbol}: ${error.message}`);
        failureCount++;
      }
    }

    console.log('[RailgunActions] Shield All completed:', {
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
 * Get tokens with shieldable balances from the public balance list
 * @param {string} address - EOA address
 * @param {number} chainId - Chain ID
 * @returns {Array} Array of tokens that can be shielded
 */
export const getShieldableTokens = async (address, chainId) => {
  try {
    console.log('[RailgunActions] Getting shieldable tokens for:', { address, chainId });

    // This should get tokens with balances from the balance fetching service
    const { fetchPublicBalances } = await import('../web3/balances.js');
    const balances = await fetchPublicBalances(address, chainId);
    
    // Filter tokens that have balance and are supported by Railgun
    const shieldableTokens = balances.filter(token => {
      return token.hasBalance && 
             token.numericBalance > 0 && 
             isTokenSupportedByRailgun(token.address, chainId);
    });

    console.log('[RailgunActions] Found shieldable tokens:', {
      total: shieldableTokens.length,
      tokens: shieldableTokens.map(t => `${t.symbol}: ${t.formattedBalance}`),
    });

    return shieldableTokens;
  } catch (error) {
    console.error('[RailgunActions] Failed to get shieldable tokens:', error);
    return [];
  }
};

/**
 * Parse token amount from user input to wei format
 * @param {string} amount - Human readable amount
 * @param {number} decimals - Token decimals
 * @returns {string} Amount in wei
 */
export const parseTokenAmount = (amount, decimals = 18) => {
  try {
    if (!amount || amount === '0') return '0';
    return parseUnits(amount, decimals).toString();
  } catch (error) {
    console.error('[RailgunActions] Error parsing amount:', error);
    throw new Error(`Invalid amount: ${amount}`);
  }
};

/**
 * Format token amount from wei to human readable format
 * @param {string} amount - Amount in wei
 * @param {number} decimals - Token decimals
 * @returns {string} Human readable amount
 */
export const formatTokenAmount = (amount, decimals = 18) => {
  try {
    if (!amount || amount === '0') return '0';
    return formatUnits(amount, decimals);
  } catch (error) {
    console.error('[RailgunActions] Error formatting amount:', error);
    return '0';
  }
};

/**
 * Check if a token is supported by Railgun on the current chain
 * @param {string} tokenAddress - Token contract address
 * @param {number} chainId - Chain ID
 * @returns {boolean} True if supported
 */
export const isTokenSupportedByRailgun = (tokenAddress, chainId) => {
  try {
    const supportedTokens = getTokensForChain(chainId);
    
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Native token - check if chain has native token support
      return Object.values(supportedTokens).some(token => token.isNative);
    }
    
    // ERC20 token - check by address with proper error handling
    return Object.values(supportedTokens).some(token => {
      try {
        if (!token.address) return false;
        return getAddress(token.address) === getAddress(tokenAddress);
      } catch (addressError) {
        console.warn(`[RailgunActions] Invalid address comparison:`, {
          tokenAddress,
          configAddress: token.address,
          error: addressError.message
        });
        return false;
      }
    });
  } catch (error) {
    console.error('[RailgunActions] Error checking token support:', error);
    return false;
  }
};

/**
 * Placeholder gas estimation function
 * @returns {Object} Gas details with fallback values
 */
export const estimateShieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, fromAddress) => {
  try {
    console.log('[RailgunActions] Estimating shield gas');
    
    // Use actual Railgun gas estimation
    const gasDetails = await gasEstimateForShield(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromAddress,
    );
    
    return gasDetails;
  } catch (error) {
    console.warn('[RailgunActions] Shield gas estimation failed, using hardcoded fallback:', error.message);
    
    return {
      gasLimit: BigInt(300000), // 300k gas limit fallback
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

/**
 * Placeholder gas estimation for unshield operations
 * @returns {Object} Gas details with fallback values
 */
export const estimateUnshieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients) => {
  try {
    console.log('[RailgunActions] Estimating unshield gas');
    
    // Use actual Railgun gas estimation
    const gasDetails = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
    );
    
    return gasDetails;
  } catch (error) {
    console.warn('[RailgunActions] Unshield gas estimation failed:', error.message);
    
    return {
      gasLimit: BigInt(350000), // 350k gas limit for unshield
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

export default {
  shieldTokens,
  unshieldTokens,
  transferPrivate,
  shieldAllTokens,
  getShieldableTokens,
  parseTokenAmount,
  formatTokenAmount,
  isTokenSupportedByRailgun,
  estimateShieldGas,
  estimateUnshieldGas,
}; 