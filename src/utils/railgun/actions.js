/**
 * Railgun Privacy Actions
 * Implements Shield, Transfer, and Unshield operations using the Railgun SDK
 * 
 * SHIELD OPERATION FLOW (Fixed):
 * ===============================
 * The Railgun SDK requires a 3-step process for shield operations:
 * 
 * 1. Gas Estimation: gasEstimateForShield
 *    - Parameters: networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, fromAddress
 * 
 * 2. Transaction Generation: generateShieldTransaction  
 *    - Parameters: networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, fromAddress
 *    - Returns: { transaction, shieldPrivateKey }
 * 
 * 3. Transaction Population: populateShield (THIS WAS MISSING!)
 *    - Parameters: networkName, railgunWalletID, erc20AmountRecipients, nftAmountRecipients, shieldPrivateKey
 *    - Returns: { transaction } (final ready-to-broadcast transaction)
 * 
 * REQUIRED PARAMETERS FOR SHIELD:
 * ================================
 * - railgunWalletID: String (Railgun wallet identifier)
 * - encryptionKey: String (minimum 32 characters, wallet encryption key)
 * - tokenAddress: String (ERC20 contract address, or '0x0000000000000000000000000000000000000000' for native)
 * - amount: String (amount in token's smallest units)
 * - chain: Object ({ type: string, id: number })
 * - fromAddress: String (EOA address sending tokens)
 * - railgunAddress: String (Railgun address receiving shielded tokens)
 * 
 * UNSHIELD & TRANSFER OPERATIONS:
 * ===============================
 * These were already correctly implemented with proper 3-step flows:
 * - Unshield: gasEstimateForUnprovenUnshield → generateUnshieldProof → populateProvedUnshield
 * - Transfer: gasEstimateForUnprovenTransfer → generateTransferProof → populateProvedTransfer
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
    console.log('[RailgunActions] Shielding tokens with parameters:', {
      railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
      hasEncryptionKey: !!encryptionKey,
      encryptionKeyLength: encryptionKey ? encryptionKey.length : 0,
      tokenAddress,
      amount,
      chain: chain?.type,
      chainId: chain?.id,
      fromAddress,
      railgunAddress: railgunAddress ? `${railgunAddress.slice(0, 8)}...` : 'MISSING',
    });

    // Enhanced parameter validation with detailed logging
    // Note: tokenAddress can be null for native tokens (ETH, MATIC, etc.)
    const missingParams = [];
    if (!railgunWalletID || typeof railgunWalletID !== 'string') missingParams.push('railgunWalletID');
    if (!encryptionKey || typeof encryptionKey !== 'string') missingParams.push('encryptionKey');
    if (tokenAddress === undefined) missingParams.push('tokenAddress'); // Allow null for native tokens
    if (!amount || typeof amount !== 'string') missingParams.push('amount');
    if (!chain || typeof chain !== 'object') missingParams.push('chain');
    if (!fromAddress || typeof fromAddress !== 'string') missingParams.push('fromAddress');
    if (!railgunAddress || typeof railgunAddress !== 'string') missingParams.push('railgunAddress');

    if (missingParams.length > 0) {
      console.error('[RailgunActions] Missing or invalid required parameters:', missingParams);
      throw new Error(`Missing or invalid required parameters for shield operation: ${missingParams.join(', ')}`);
    }

    // Log token type for debugging
    const tokenType = tokenAddress === null ? 'NATIVE' : 'ERC20';
    console.log('[RailgunActions] Token type:', tokenType, 'Address:', tokenAddress);

    // Validate encryption key format
    if (encryptionKey.length < 32) {
      console.error('[RailgunActions] Invalid encryption key length:', encryptionKey.length);
      throw new Error('Encryption key must be at least 32 characters');
    }

    await waitForRailgunReady();

    // Convert chain ID to NetworkName
    const networkName = getNetworkNameFromChainId(chain.id);
    console.log('[RailgunActions] Using network:', networkName);

    // Prepare ERC20 amount object - for shield operations, we need to specify the Railgun address as recipient
    // ✅ CRITICAL: Ensure all fields are properly typed and validated
    const processedTokenAddress = (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') ? undefined : tokenAddress;
    const processedAmount = amount.toString();
    const processedRecipientAddress = railgunAddress;

    // Validate processed values
    if (processedAmount === '0' || processedAmount === 'NaN' || processedAmount === '') {
      throw new Error('Invalid amount: cannot be zero, NaN, or empty');
    }
    
    if (!processedRecipientAddress || processedRecipientAddress.length < 10) {
      throw new Error('Invalid Railgun recipient address');
    }

    const erc20AmountRecipient = {
      tokenAddress: processedTokenAddress,
      amount: processedAmount,
      recipientAddress: processedRecipientAddress,
    };

    // ✅ CRITICAL: Validate the recipient object structure before creating arrays
    if (!erc20AmountRecipient || typeof erc20AmountRecipient !== 'object') {
      throw new Error('Failed to create valid ERC20AmountRecipient object');
    }

    if (typeof erc20AmountRecipient.amount !== 'string') {
      throw new Error('ERC20AmountRecipient amount must be a string');
    }

    if (typeof erc20AmountRecipient.recipientAddress !== 'string') {
      throw new Error('ERC20AmountRecipient recipientAddress must be a string');
    }

    // Ensure arrays are properly initialized (never null) and validate them
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Empty array, never null

    // ✅ CRITICAL: Final validation of arrays before SDK calls
    if (!Array.isArray(erc20AmountRecipients) || erc20AmountRecipients.length === 0) {
      throw new Error('erc20AmountRecipients must be a non-empty array');
    }

    if (!Array.isArray(nftAmountRecipients)) {
      throw new Error('nftAmountRecipients must be an array');
    }
    
    console.log('[RailgunActions] Prepared recipients for shield:', {
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        tokenAddressType: typeof r.tokenAddress,
        amount: r.amount,
        amountType: typeof r.amount,
        recipientAddress: r.recipientAddress ? `${r.recipientAddress.slice(0, 8)}...` : 'MISSING'
      })),
      nftAmountRecipientsCount: nftAmountRecipients.length,
      parametersToSDK: {
        networkName,
        railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
        encryptionKey: encryptionKey ? `${encryptionKey.slice(0, 8)}...` : 'MISSING',
        fromAddress
      }
    });
    
    // Step 1: Get gas estimate first
    console.log('[RailgunActions] Step 1: Getting gas estimate...');
    
    // ✅ DETAILED PARAMETER VALIDATION BEFORE SDK CALL
    console.log('[RailgunActions] Validating all parameters before gasEstimateForShield:', {
      networkName: {
        value: networkName,
        type: typeof networkName,
        isUndefined: networkName === undefined,
        isNull: networkName === null
      },
      railgunWalletID: {
        value: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : railgunWalletID,
        type: typeof railgunWalletID,
        isUndefined: railgunWalletID === undefined,
        isNull: railgunWalletID === null
      },
      encryptionKey: {
        value: encryptionKey ? `${encryptionKey.slice(0, 8)}...` : encryptionKey,
        type: typeof encryptionKey,
        length: encryptionKey ? encryptionKey.length : 0,
        isUndefined: encryptionKey === undefined,
        isNull: encryptionKey === null
      },
      erc20AmountRecipients: {
        value: erc20AmountRecipients,
        type: typeof erc20AmountRecipients,
        isArray: Array.isArray(erc20AmountRecipients),
        length: erc20AmountRecipients ? erc20AmountRecipients.length : 0,
        isUndefined: erc20AmountRecipients === undefined,
        isNull: erc20AmountRecipients === null
      },
      nftAmountRecipients: {
        value: nftAmountRecipients,
        type: typeof nftAmountRecipients,
        isArray: Array.isArray(nftAmountRecipients),
        length: nftAmountRecipients ? nftAmountRecipients.length : 0,
        isUndefined: nftAmountRecipients === undefined,
        isNull: nftAmountRecipients === null
      },
      fromAddress: {
        value: fromAddress,
        type: typeof fromAddress,
        isUndefined: fromAddress === undefined,
        isNull: fromAddress === null
      }
    });

    // Ensure no parameters are undefined before calling the SDK
    if (networkName === undefined) throw new Error('networkName is undefined');
    if (railgunWalletID === undefined) throw new Error('railgunWalletID is undefined');
    if (encryptionKey === undefined) throw new Error('encryptionKey is undefined');
    if (erc20AmountRecipients === undefined) throw new Error('erc20AmountRecipients is undefined');
    if (nftAmountRecipients === undefined) throw new Error('nftAmountRecipients is undefined');
    if (fromAddress === undefined) throw new Error('fromAddress is undefined');
    
    // ✅ CRITICAL: Wrap SDK call in comprehensive error handling
    let gasDetails;
    try {
      console.log('[RailgunActions] Calling gasEstimateForShield with validated parameters...');
      gasDetails = await gasEstimateForShield(
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        fromAddress,
      );
      console.log('[RailgunActions] gasEstimateForShield completed successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] gasEstimateForShield failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack,
        name: sdkError.name
      });
      
      // Provide more specific error messages based on common patterns
      if (sdkError.message && sdkError.message.includes('is not iterable')) {
        throw new Error('Shield operation failed: Invalid parameter structure passed to Railgun SDK. This usually indicates a parameter type mismatch.');
      } else if (sdkError.message && sdkError.message.includes('undefined')) {
        throw new Error('Shield operation failed: Undefined parameter passed to Railgun SDK. All parameters must be properly defined.');
      } else {
        throw new Error(`Shield operation failed: ${sdkError.message || 'Unknown Railgun SDK error'}`);
      }
    }

    console.log('[RailgunActions] Gas estimate completed:', gasDetails);

    // Step 2: Generate shield transaction
    console.log('[RailgunActions] Step 2: Generating shield transaction...');
    let shieldTxResult;
    try {
      console.log('[RailgunActions] Calling generateShieldTransaction...');
      shieldTxResult = await generateShieldTransaction(
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        fromAddress,
      );
      console.log('[RailgunActions] generateShieldTransaction completed successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] generateShieldTransaction failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      
      if (sdkError.message && sdkError.message.includes('is not iterable')) {
        throw new Error('Shield transaction generation failed: Invalid parameter structure passed to Railgun SDK.');
      } else {
        throw new Error(`Shield transaction generation failed: ${sdkError.message || 'Unknown Railgun SDK error'}`);
      }
    }

    console.log('[RailgunActions] Shield transaction generated:', {
      hasTransaction: !!shieldTxResult?.transaction,
      hasShieldPrivateKey: !!shieldTxResult?.shieldPrivateKey,
      shieldTxResult: shieldTxResult
    });

    if (!shieldTxResult || !shieldTxResult.transaction) {
      throw new Error('Failed to generate shield transaction');
    }

    // Step 3: Populate shield transaction (the missing step!)
    console.log('[RailgunActions] Step 3: Populating shield transaction...');
    let populatedResult;
    try {
      console.log('[RailgunActions] Calling populateShield...');
      populatedResult = await populateShield(
        networkName,
        railgunWalletID,
        erc20AmountRecipients,
        nftAmountRecipients,
        shieldTxResult.shieldPrivateKey, // Use the shield private key from generateShieldTransaction
      );
      console.log('[RailgunActions] populateShield completed successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] populateShield failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      
      if (sdkError.message && sdkError.message.includes('is not iterable')) {
        throw new Error('Shield transaction population failed: Invalid parameter structure passed to Railgun SDK.');
      } else {
        throw new Error(`Shield transaction population failed: ${sdkError.message || 'Unknown Railgun SDK error'}`);
      }
    }

    console.log('[RailgunActions] Shield transaction populated:', populatedResult);

    if (!populatedResult || !populatedResult.transaction) {
      throw new Error('Failed to populate shield transaction');
    }

    return { 
      success: true, 
      transaction: populatedResult.transaction,
      gasEstimate: gasDetails,
      shieldPrivateKey: shieldTxResult.shieldPrivateKey // Include for potential future use
    };

  } catch (error) {
    console.error('[RailgunActions] Shield failed with detailed error:', {
      errorMessage: error.message,
      errorStack: error.stack,
      railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
      hasEncryptionKey: !!encryptionKey,
      tokenAddress,
      amount,
      fromAddress,
      railgunAddress: railgunAddress ? `${railgunAddress.slice(0, 8)}...` : 'MISSING'
    });
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
      tokenAddress: (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') ? undefined : tokenAddress,
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
      tokenAddress: (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') ? undefined : tokenAddress,
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