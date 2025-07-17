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
 * @param {string} railgunAddress - Railgun address to shield to (recipient)
 * @returns {Object} Transaction result
 */
export const shieldTokens = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, fromAddress, railgunAddress) => {
  try {
    console.log('[RailgunActions] Shielding tokens:', {
      tokenAddress,
      amount,
      chain: chain.type,
      from: fromAddress,
      to: railgunAddress,
    });

    // Validate required parameters
    if (!railgunWalletID || !encryptionKey || !tokenAddress || !amount || !chain || !fromAddress || !railgunAddress) {
      throw new Error('Missing required parameters for shield operation');
    }

    await waitForRailgunReady();

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Prepare ERC20 amount object - for shield operations, we need to specify the Railgun address as recipient
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount.toString(), // Ensure amount is string
      recipientAddress: railgunAddress, // Use the Railgun address as recipient for shield operations
    };

    // Ensure arrays are properly initialized (never null)
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Empty array, never null
    
    console.log('[RailgunActions] Prepared recipients:', {
      erc20AmountRecipients,
      nftAmountRecipients
    });
    
    // Get gas estimate first
    const gasDetails = await gasEstimateForShield(
      networkName,
      railgunWalletID,
      encryptionKey, // Use the provided encryption key directly
      erc20AmountRecipients,
      nftAmountRecipients,
      fromAddress,
    );

    console.log('[RailgunActions] Gas estimate:', gasDetails);

    // Generate shield transaction
    const shieldTxResult = await generateShieldTransaction(
      networkName,
      railgunWalletID,
      encryptionKey, // Use the provided encryption key directly  
      erc20AmountRecipients,
      nftAmountRecipients,
      fromAddress,
    );

    console.log('[RailgunActions] Shield transaction generated:', shieldTxResult);

    if (!shieldTxResult || !shieldTxResult.transaction) {
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

    // Validate required parameters
    if (!railgunWalletID || !encryptionKey || !tokenAddress || !amount || !chain || !toAddress) {
      throw new Error('Missing required parameters for unshield operation');
    }

    await waitForRailgunReady();

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Prepare ERC20 amount recipient for unshield
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount.toString(), // Ensure amount is string
      recipientAddress: toAddress,
    };

    // Ensure arrays are properly initialized (never null)
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Empty array, never null

    console.log('[RailgunActions] Prepared unshield recipients:', {
      erc20AmountRecipients,
      nftAmountRecipients
    });

    // Get gas estimate
    const gasDetails = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Unshield gas estimate:', gasDetails);

    // Generate unshield proof
    const proofResult = await generateUnshieldProof(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Unshield proof generated:', proofResult);

    // Populate the proved unshield transaction
    const populatedResult = await populateProvedUnshield(
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Unshield transaction populated:', populatedResult);

    if (!populatedResult || !populatedResult.transaction) {
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
 * @param {string} toRailgunAddress - Destination Railgun address
 * @param {string} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to transfer (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} memo - Optional memo text
 * @returns {Object} Transaction result
 */
export const transferPrivate = async (railgunWalletID, encryptionKey, toRailgunAddress, tokenAddress, amount, chain, memo = '') => {
  try {
    console.log('[RailgunActions] Transferring tokens privately:', {
      tokenAddress,
      amount,
      chain: chain.type,
      to: toRailgunAddress,
      memo,
    });

    // Validate required parameters
    if (!railgunWalletID || !encryptionKey || !toRailgunAddress || !tokenAddress || !amount || !chain) {
      throw new Error('Missing required parameters for transfer operation');
    }

    await waitForRailgunReady();

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);

    // Prepare ERC20 amount recipient for private transfer
    const erc20AmountRecipient = {
      tokenAddress: tokenAddress === '0x0000000000000000000000000000000000000000' ? undefined : tokenAddress,
      amount: amount.toString(), // Ensure amount is string
      recipientAddress: toRailgunAddress,
    };

    // Ensure arrays are properly initialized (never null)
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Empty array, never null
    const memoArray = memo ? [memo] : []; // Memo array, properly initialized

    console.log('[RailgunActions] Prepared transfer recipients:', {
      erc20AmountRecipients,
      nftAmountRecipients,
      memoArray
    });

    // Get gas estimate
    const gasDetails = await gasEstimateForUnprovenTransfer(
      networkName,
      railgunWalletID,
      encryptionKey,
      memoArray,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Transfer gas estimate:', gasDetails);

    // Generate transfer proof
    const proofResult = await generateTransferProof(
      networkName,
      railgunWalletID,
      encryptionKey,
      memoArray,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Transfer proof generated:', proofResult);

    // Populate the proved transfer transaction
    const populatedResult = await populateProvedTransfer(
      networkName,
      railgunWalletID,
      memoArray,
      erc20AmountRecipients,
      nftAmountRecipients,
    );

    console.log('[RailgunActions] Transfer transaction populated:', populatedResult);

    if (!populatedResult || !populatedResult.transaction) {
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
 * @param {string} railgunAddress - Railgun address to shield to (recipient)
 * @returns {Object} Shield results for all tokens
 */
export const shieldAllTokens = async (railgunWalletID, encryptionKey, tokens, chain, fromAddress, railgunAddress) => {
  try {
    console.log('[RailgunActions] Shielding all tokens:', {
      tokensCount: tokens.length,
      chain: chain.type,
      from: fromAddress,
      to: railgunAddress,
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
          fromAddress,
          railgunAddress  // Pass the railgun address
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
    // Enhanced validation
    if (!amount || amount === '0' || amount === '' || isNaN(parseFloat(amount))) {
      return '0';
    }
    
    // Validate decimals
    if (typeof decimals !== 'number' || decimals < 0 || decimals > 77) {
      console.warn('[RailgunActions] Invalid decimals, using default 18:', decimals);
      decimals = 18;
    }
    
    // Parse using ethers
    const result = parseUnits(amount.toString(), decimals);
    
    // Ensure result is valid
    if (!result || result.toString() === 'NaN') {
      throw new Error(`Failed to parse amount: ${amount} with decimals: ${decimals}`);
    }
    
    const resultString = result.toString();
    console.log('[RailgunActions] parseTokenAmount result:', {
      input: amount,
      decimals,
      output: resultString
    });
    
    return resultString;
  } catch (error) {
    console.error('[RailgunActions] Error parsing amount:', {
      amount,
      decimals,
      error: error.message
    });
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
 * Gas estimation function for shield operations
 * @param {string} networkName - Network name
 * @param {string} railgunWalletID - Railgun wallet ID  
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} erc20AmountRecipients - Array of ERC20 amount recipients
 * @param {Array} nftAmountRecipients - Array of NFT amount recipients
 * @param {string} fromAddress - EOA address sending the tokens
 * @returns {Object} Gas details
 */
export const estimateShieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, fromAddress) => {
  try {
    console.log('[RailgunActions] Estimating shield gas');
    
    // Ensure arrays are properly initialized (never null)
    const safeErc20Recipients = Array.isArray(erc20AmountRecipients) ? erc20AmountRecipients : [];
    const safeNftRecipients = Array.isArray(nftAmountRecipients) ? nftAmountRecipients : [];
    
    // Use actual Railgun gas estimation
    const gasDetails = await gasEstimateForShield(
      networkName,
      railgunWalletID,
      encryptionKey,
      safeErc20Recipients,
      safeNftRecipients,
      fromAddress,
    );
    
    return gasDetails;
  } catch (error) {
    console.warn('[RailgunActions] Shield gas estimation failed, using hardcoded fallback:', error.message);
    
    return {
      gasLimit: BigInt(300000), // 300k gas limit for shield
      gasPrice: BigInt(20000000000), // 20 gwei fallback
    };
  }
};

/**
 * Gas estimation function for unshield operations
 * @param {string} networkName - Network name
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {Array} erc20AmountRecipients - Array of ERC20 amount recipients
 * @param {Array} nftAmountRecipients - Array of NFT amount recipients
 * @returns {Object} Gas details
 */
export const estimateUnshieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients) => {
  try {
    console.log('[RailgunActions] Estimating unshield gas');
    
    // Ensure arrays are properly initialized (never null)
    const safeErc20Recipients = Array.isArray(erc20AmountRecipients) ? erc20AmountRecipients : [];
    const safeNftRecipients = Array.isArray(nftAmountRecipients) ? nftAmountRecipients : [];
    
    // Use actual Railgun gas estimation
    const gasDetails = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      safeErc20Recipients,
      safeNftRecipients,
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