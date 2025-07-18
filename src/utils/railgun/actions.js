/**
 * Railgun Privacy Actions - OFFICIAL IMPLEMENTATION
 * Implements Shield, Transfer, and Unshield operations using the Railgun SDK
 * 
 * Based on official Railgun Community patterns from:
 * - https://github.com/Railgun-Community/wallet
 * - https://github.com/Railgun-Community/cookbook
 * 
 * SHIELD OPERATION FLOW (CORRECTED):
 * ==================================
 * The Railgun SDK requires a 3-step process for shield operations:
 * 
 * 1. Gas Estimation: gasEstimateForShield
 * 2. Transaction Generation: generateShieldTransaction  
 * 3. Transaction Population: populateShield
 * 
 * CRITICAL PARAMETER REQUIREMENTS:
 * - networkName: Must be exact match: "Ethereum", "Arbitrum", "Polygon", "BNB", "Hardhat"
 * - erc20AmountRecipients: Array of { tokenAddress, amount, recipientAddress }
 * - nftAmountRecipients: Always empty array []
 * - Native tokens: tokenAddress must be undefined (not null)
 * - All amounts: Must be strings (hex BigNumber values)
 * - All addresses: Must be checksummed Ethereum addresses
 */

import { formatUnits, parseUnits, getAddress, isAddress, keccak256 } from 'ethers';
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
  getShieldPrivateKeySignatureMessage,
} from '@railgun-community/wallet';
import { NetworkName } from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import railgunEngine from './engine.js';
import { getTokensForChain } from '../../constants/tokens.js';
import { deriveEncryptionKey } from './wallet.js';

/**
 * NETWORK NAME MAPPING 
 * =====================
 * Maps our chain configuration to Railgun's expected NetworkName enum values
 */
const RAILGUN_NETWORK_MAPPING = {
  1: NetworkName.Ethereum,      // Mainnet
  42161: NetworkName.Arbitrum,  // Arbitrum One
  137: NetworkName.Polygon,     // Polygon Mainnet
  56: NetworkName.BNBChain,     // BNB Smart Chain
};

/**
 * FEE COLLECTION CONFIGURATION
 * ============================
 * 1% fee on all private transactions collected to specified wallet
 */
const FEE_COLLECTION_CONFIG = {
  // Fee recipient wallet address
  RECIPIENT_ADDRESS: '0x108eA687844AB79223E5D5F49ecDf69f2E93B453',
  
  // Fee percentage (1% = 100 basis points)
  FEE_PERCENTAGE: 1.0, // 1%
  FEE_BASIS_POINTS: 100, // 1% in basis points
  
  // Minimum fee amount to avoid dust
  MIN_FEE_THRESHOLD: '1000000', // 1 USDC/USDT (6 decimals)
};

/**
 * Calculate fee amount for a transaction
 * @param {string} amount - Transaction amount in token units
 * @param {number} decimals - Token decimals
 * @returns {string} Fee amount in token units
 */
const calculateTransactionFee = (amount, decimals) => {
  try {
    const amountBigInt = BigInt(amount);
    const feeAmount = (amountBigInt * BigInt(FEE_COLLECTION_CONFIG.FEE_BASIS_POINTS)) / BigInt(10000);
    
    // Apply minimum threshold
    const minFee = BigInt(FEE_COLLECTION_CONFIG.MIN_FEE_THRESHOLD);
    const finalFee = feeAmount > minFee ? feeAmount : minFee;
    
    console.log('[FeeCollection] Calculated fee:', {
      originalAmount: amount,
      feeAmount: feeAmount.toString(),
      finalFee: finalFee.toString(),
      percentage: FEE_COLLECTION_CONFIG.FEE_PERCENTAGE + '%'
    });
    
    return finalFee.toString();
  } catch (error) {
    console.error('[FeeCollection] Error calculating fee:', error);
    return '0';
  }
};

/**
 * Get the correct Railgun network name for a given chain ID
 * @param {number} chainId - The chain ID
 * @returns {string} The Railgun network name
 */
function getRailgunNetworkName(chainId) {
  const networkName = RAILGUN_NETWORK_MAPPING[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID for Railgun: ${chainId}`);
  }
  return networkName;
}

/**
 * Validates and formats an Ethereum address
 * @param {string} address - The address to validate
 * @param {string} paramName - Parameter name for error messages
 * @returns {string} Checksummed address
 */
function validateAndFormatAddress(address, paramName) {
  if (!address || typeof address !== 'string') {
    throw new Error(`${paramName} must be a valid Ethereum address string`);
  }
  try {
    return getAddress(address); // This validates and checksums the address
  } catch (error) {
    throw new Error(`Invalid ${paramName}: ${address}. ${error.message}`);
  }
}

/**
 * Creates a properly structured ERC20AmountRecipient for Railgun SDK
 * @param {string|null} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount in token units as string
 * @param {string} recipientAddress - Recipient Railgun address
 * @returns {Object} Properly structured recipient object
 */
function createERC20AmountRecipient(tokenAddress, amount, recipientAddress) {
  // ✅ 1. SANITIZE TOKEN INPUTS BEFORE SHIELDING (SYMBOL FIX)
  console.log('[CreateRecipient] Raw input validation:', {
    tokenAddress: {
      value: tokenAddress,
      type: typeof tokenAddress,
      isSymbol: typeof tokenAddress === 'symbol',
      constructor: tokenAddress?.constructor?.name
    },
    amount: {
      value: amount,
      type: typeof amount,
      isSymbol: typeof amount === 'symbol',
      constructor: amount?.constructor?.name
    },
    recipientAddress: {
      value: recipientAddress ? `${recipientAddress.slice(0, 8)}...` : recipientAddress,
      type: typeof recipientAddress,
      isSymbol: typeof recipientAddress === 'symbol',
      constructor: recipientAddress?.constructor?.name
    }
  });

  // ✅ 2. PREVENT SYMBOL OBJECTS FROM REACHING SDK
  if (typeof tokenAddress === 'symbol') {
    console.error('Invalid token address (Symbol object detected):', tokenAddress);
    throw new Error('Invalid token address (Symbol object detected): ' + String(tokenAddress));
  }
  
  if (typeof amount === 'symbol') {
    console.error('Invalid amount (Symbol object detected):', amount);
    throw new Error('Invalid amount (Symbol object detected): ' + String(amount));
  }
  
  if (typeof recipientAddress === 'symbol') {
    console.error('Invalid recipient address (Symbol object detected):', recipientAddress);
    throw new Error('Invalid recipient address (Symbol object detected): ' + String(recipientAddress));
  }

  // ✅ 3. VALIDATE STRING INPUTS AFTER SYMBOL CHECK
  if (!amount || typeof amount !== 'string') {
    throw new Error('Amount must be a string, got: ' + typeof amount);
  }
  
  if (!recipientAddress || typeof recipientAddress !== 'string') {
    throw new Error('Recipient address must be a string, got: ' + typeof recipientAddress);
  }

  // ✅ TOKEN ADDRESS VALIDATION (ETHERS.JS)
  let processedTokenAddress;
  
  if (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') {
    // Native token - should be undefined
    processedTokenAddress = undefined;
    console.log('[CreateRecipient] Processing NATIVE token (tokenAddress set to undefined)');
  } else {
    // ERC20 token - must be valid address
    if (!tokenAddress || !isAddress(tokenAddress)) {
      console.error(`[CreateRecipient] Invalid or missing tokenAddress: ${tokenAddress}`);
      throw new Error("Invalid token address passed to shielding flow");
    }
    processedTokenAddress = validateAndFormatAddress(tokenAddress, 'tokenAddress');
    console.log('[CreateRecipient] Processing ERC20 token with valid address:', processedTokenAddress);
  }

  // ✅ 4. FINAL VALIDATION OF RECIPIENT OBJECT
  const recipient = {
    tokenAddress: processedTokenAddress,
    amount: String(amount), // Ensure it's a string
    recipientAddress: String(recipientAddress), // Ensure it's a string
  };

  // 🔍 VALIDATE CREATED RECIPIENT OBJECT
  console.log('[CreateRecipient] Validating created recipient object:', {
    recipient,
    isObject: typeof recipient === 'object' && recipient !== null,
    hasCorrectKeys: Object.keys(recipient).sort().join(',') === 'amount,recipientAddress,tokenAddress',
    tokenAddress: {
      value: recipient.tokenAddress,
      type: typeof recipient.tokenAddress,
      defined: recipient.tokenAddress !== undefined
    },
    amount: {
      value: recipient.amount,
      type: typeof recipient.amount,
      isString: typeof recipient.amount === 'string'
    },
    recipientAddress: {
      value: recipient.recipientAddress ? `${recipient.recipientAddress.slice(0, 8)}...` : recipient.recipientAddress,
      type: typeof recipient.recipientAddress,
      isString: typeof recipient.recipientAddress === 'string'
    }
  });

  // Validate the recipient object structure
  if (!recipient || typeof recipient !== 'object') {
    console.error('[CreateRecipient] ❌ Created recipient is not an object:', recipient);
    throw new Error('Failed to create valid recipient object');
  }

  if (!('tokenAddress' in recipient) || !('amount' in recipient) || !('recipientAddress' in recipient)) {
    console.error('[CreateRecipient] ❌ Created recipient missing required properties:', {
      hasTokenAddress: 'tokenAddress' in recipient,
      hasAmount: 'amount' in recipient,
      hasRecipientAddress: 'recipientAddress' in recipient,
      keys: Object.keys(recipient)
    });
    throw new Error('Created recipient object missing required properties');
  }

  console.log('[CreateRecipient] Created recipient object:', {
    tokenAddress: recipient.tokenAddress,
    tokenAddressType: typeof recipient.tokenAddress,
    amount: recipient.amount,
    amountType: typeof recipient.amount,
    recipientAddress: recipient.recipientAddress ? `${recipient.recipientAddress.slice(0, 8)}...` : 'MISSING',
    recipientAddressType: typeof recipient.recipientAddress
  });

  return recipient;
}

/**
 * Shield ERC20 tokens into Railgun (Public → Private)
 * OFFICIAL IMPLEMENTATION based on Railgun Community patterns
 * 
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string|null} tokenAddress - Token contract address (null for native)
 * @param {string} amount - Amount to shield (in token units)
 * @param {Object} chain - Chain configuration
 * @param {string} fromAddress - EOA address sending the tokens
 * @param {string} railgunAddress - Railgun address to shield to (user's own wallet)
 * @returns {Object} Transaction result
 */
export const shieldTokens = async (railgunWalletID, encryptionKey, tokenAddress, amount, chain, fromAddress, railgunAddress) => {
  try {
    console.log('[RailgunActions] Starting OFFICIAL shield operation with parameters:', {
      railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
      hasEncryptionKey: !!encryptionKey,
      encryptionKeyLength: encryptionKey ? encryptionKey.length : 0,
      tokenAddress,
      tokenType: tokenAddress === null ? 'NATIVE' : 'ERC20',
      amount,
      chainId: chain?.id,
      fromAddress,
      railgunAddress,
    });

    // Wait for Railgun to be ready
    await waitForRailgunReady();

    // ✅ COMPREHENSIVE PARAMETER VALIDATION (Official Railgun Pattern)
    if (!railgunWalletID || typeof railgunWalletID !== 'string') {
      throw new Error('railgunWalletID must be a non-empty string');
    }

    if (!encryptionKey || typeof encryptionKey !== 'string' || encryptionKey.length < 32) {
      throw new Error('encryptionKey must be a string with at least 32 characters');
    }

    // ✅ ENHANCED TOKEN ADDRESS VALIDATION (ETHERS.JS)
    if (tokenAddress !== null && tokenAddress !== undefined) {
      if (!isAddress(tokenAddress)) {
        console.error(`[Shield] Invalid or missing tokenAddress: ${tokenAddress}`);
        throw new Error("Invalid token address passed to shielding flow");
      }
      tokenAddress = validateAndFormatAddress(tokenAddress, 'tokenAddress');
    }

    if (!amount || typeof amount !== 'string') {
      throw new Error('amount must be a non-empty string');
    }

    if (!chain || typeof chain !== 'object' || !chain.id) {
      throw new Error('chain must be an object with an id property');
    }

    fromAddress = validateAndFormatAddress(fromAddress, 'fromAddress');

    if (!railgunAddress || typeof railgunAddress !== 'string') {
      throw new Error('railgunAddress must be a non-empty string');
    }

    // Validate railgunAddress format (starts with 0zk)
    if (!railgunAddress.startsWith('0zk')) {
      throw new Error('railgunAddress must be a valid Railgun address (starts with 0zk)');
    }

    // Get the correct Railgun network name
    const networkName = getRailgunNetworkName(chain.id);
    console.log('[RailgunActions] Using Railgun network:', {
      chainId: chain.id,
      networkName,
      networkNameType: typeof networkName,
      networkNameValue: networkName,
      isString: typeof networkName === 'string',
      availableNetworkNames: Object.keys(NetworkName),
      networkNameEnum: NetworkName
    });

    // ✅ CREATE RECIPIENT FOR SHIELDING (should always be user's own Railgun address)
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, railgunAddress);
    
    // ✅ DEFENSIVE CHECK AFTER RECIPIENT CREATION
    if (!erc20AmountRecipient || typeof erc20AmountRecipient !== 'object') {
      throw new Error('createERC20AmountRecipient() returned invalid value');
    }

    const erc20AmountRecipients = [erc20AmountRecipient];
    
    // 🔍 IMMEDIATE VALIDATION OF ARRAY CONSTRUCTION
    console.log('[RailgunActions] === ARRAY CONSTRUCTION VALIDATION ===');
    console.log('[RailgunActions] erc20AmountRecipients array construction:', {
      originalRecipient: erc20AmountRecipient,
      arrayConstruction: {
        method: 'Array literal [erc20AmountRecipient]',
        result: erc20AmountRecipients,
        isArray: Array.isArray(erc20AmountRecipients),
        length: erc20AmountRecipients?.length,
        type: typeof erc20AmountRecipients,
        constructor: erc20AmountRecipients?.constructor?.name
      },
      firstElement: {
        value: erc20AmountRecipients[0],
        type: typeof erc20AmountRecipients[0],
        isObject: typeof erc20AmountRecipients[0] === 'object' && erc20AmountRecipients[0] !== null,
        keys: erc20AmountRecipients[0] ? Object.keys(erc20AmountRecipients[0]) : 'NO_KEYS'
      }
    });

    // Validate array was created correctly
    if (!Array.isArray(erc20AmountRecipients)) {
      console.error('[RailgunActions] ❌ Array construction failed - not an array:', erc20AmountRecipients);
      throw new Error('Failed to create erc20AmountRecipients array');
    }

    if (erc20AmountRecipients.length !== 1) {
      console.error('[RailgunActions] ❌ Array construction failed - wrong length:', erc20AmountRecipients.length);
      throw new Error('erc20AmountRecipients array should have exactly 1 element');
    }

    if (!erc20AmountRecipients[0] || typeof erc20AmountRecipients[0] !== 'object') {
      console.error('[RailgunActions] ❌ Array construction failed - first element not an object:', erc20AmountRecipients[0]);
      throw new Error('First element of erc20AmountRecipients must be an object');
    }

    console.log('[RailgunActions] ✅ Array construction validated successfully');
    console.log('[RailgunActions] === END ARRAY CONSTRUCTION VALIDATION ===');

    const nftAmountRecipients = []; // Always empty array for shield operations

    // 🔍 VALIDATE NFT ARRAY CONSTRUCTION
    console.log('[RailgunActions] === NFT ARRAY VALIDATION ===');
    console.log('[RailgunActions] nftAmountRecipients array construction:', {
      value: nftAmountRecipients,
      isArray: Array.isArray(nftAmountRecipients),
      length: nftAmountRecipients?.length,
      type: typeof nftAmountRecipients,
      constructor: nftAmountRecipients?.constructor?.name,
      isEmpty: nftAmountRecipients.length === 0
    });

    if (!Array.isArray(nftAmountRecipients)) {
      console.error('[RailgunActions] ❌ NFT array construction failed - not an array:', nftAmountRecipients);
      throw new Error('Failed to create nftAmountRecipients array');
    }

    console.log('[RailgunActions] ✅ NFT array construction validated successfully');
    console.log('[RailgunActions] === END NFT ARRAY VALIDATION ===');

    // ✅ GUARD AGAINST EMPTY FIELDS
    if (!erc20AmountRecipient.tokenAddress && tokenAddress !== null) {
      throw new Error('Missing tokenAddress in recipient');
    }

    if (!erc20AmountRecipient.amount) {
      throw new Error('Missing amount in recipient');
    }

    if (!erc20AmountRecipient.recipientAddress) {
      throw new Error('Missing recipientAddress in recipient');
    }

    // ✅ GET STORED RAILGUN FEES FOR THIS NETWORK
    const storedFees = railgunEngine.getFees(networkName);
    console.log('[RailgunActions] Retrieved stored fees for', networkName, ':', storedFees);

    // ✅ CALCULATE 1% FEE USING RAILGUN ENGINE DATA
    const shieldAmount = BigInt(amount); // User's input amount
    const feeBps = BigInt(FEE_COLLECTION_CONFIG.FEE_BASIS_POINTS); // 100n (1%)
    const feeAmount = (shieldAmount * feeBps) / 10000n; // Calculate 1% fee
    
    // ✅ GET TOKEN DETAILS FOR FEE TOKEN DETAILS
    const tokens = getTokensForChain(chain.id);
    const currentToken = Object.values(tokens).find(token => {
      if (tokenAddress === null && token.isNative) return true;
      if (tokenAddress && token.address) {
        return getAddress(token.address) === getAddress(tokenAddress);
      }
      return false;
    });
    
    if (!currentToken) {
      throw new Error(`Token not found for address: ${tokenAddress || 'native'}`);
    }

    // ✅ CONSTRUCT PROPER FEE TOKEN DETAILS WITH FEE AMOUNT
    const feeTokenDetails = {
      tokenAddress: tokenAddress === null ? currentToken.address : tokenAddress, // Token being shielded
      feeAmount, // ✅ CRITICAL: Calculated fee amount for SDK to deduct
      feePerUnitGas: 0n, // We're not using a relayer
      feeReceiverAddress: FEE_COLLECTION_CONFIG.RECIPIENT_ADDRESS, // ✅ Our fee wallet
      chainId: chain.id, // CRITICAL: SDK uses chainId to derive chain internally  
      decimals: currentToken.decimals,
      symbol: currentToken.symbol,
    };
    
    console.log('[RailgunActions] ✅ Constructed feeTokenDetails with 1% fee collection:', {
      tokenAddress: feeTokenDetails.tokenAddress,
      feeAmount: feeAmount.toString(),
      feeReceiverAddress: feeTokenDetails.feeReceiverAddress,
      chainId: feeTokenDetails.chainId,
      symbol: feeTokenDetails.symbol,
      feePercentage: '1%'
        });

    // ✅ VALIDATE FEE TOKEN DETAILS STRUCTURE
    if (!feeTokenDetails || typeof feeTokenDetails !== 'object') {
      throw new Error('feeTokenDetails must be an object');
    }
    
    if (typeof feeTokenDetails.chainId !== 'number') {
      throw new Error('feeTokenDetails.chainId must be a number');
    }
    
    if (typeof feeTokenDetails.decimals !== 'number') {
      throw new Error('feeTokenDetails.decimals must be a number');
    }
    
    if (typeof feeTokenDetails.symbol !== 'string') {
      throw new Error('feeTokenDetails.symbol must be a string');
    }

    if (typeof feeTokenDetails.feeAmount !== 'bigint') {
      throw new Error('feeTokenDetails.feeAmount must be a BigInt');
    }

    if (typeof feeTokenDetails.feeReceiverAddress !== 'string') {
      throw new Error('feeTokenDetails.feeReceiverAddress must be a string');
    }

    console.log('[RailgunActions] Created properly structured parameters:', {
      networkName,
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        tokenAddressType: typeof r.tokenAddress,
        amount: r.amount,
        amountType: typeof r.amount,
        recipientAddress: r.recipientAddress ? `${r.recipientAddress.slice(0, 8)}...` : 'MISSING'
      })),
      nftAmountRecipientsLength: nftAmountRecipients.length,
    });

    // ✅ STEP 1: Generate Shield Private Key (Official Pattern from docs)
    console.log('[RailgunActions] Step 1: Generating shield private key...');
    let shieldPrivateKey;
    try {
      const shieldSignatureMessage = getShieldPrivateKeySignatureMessage();
      console.log('[RailgunActions] Shield signature message:', shieldSignatureMessage);
      
      // Note: In a real implementation, you'd need the user's wallet to sign this message
      // For now, we'll generate a deterministic key based on the wallet and transaction
      const deterministicSeed = `${railgunWalletID}-${fromAddress}-${JSON.stringify(erc20AmountRecipients)}`;
      const encoder = new TextEncoder();
      const seedBytes = encoder.encode(deterministicSeed);
      shieldPrivateKey = keccak256(seedBytes);
      
      console.log('[RailgunActions] Generated shield private key:', shieldPrivateKey ? 'SUCCESS' : 'FAILED');
    } catch (keyError) {
      console.error('[RailgunActions] Failed to generate shield private key:', keyError);
      throw new Error(`Shield private key generation failed: ${keyError.message}`);
    }

    // ✅ STEP 2: Gas Estimation (Official Pattern - following docs exactly)
    console.log('[RailgunActions] Step 2: Gas estimation with official pattern...');
    
    // 🔍 COMPREHENSIVE PARAMETER VALIDATION AND LOGGING
    console.log('[RailgunActions] === DEBUGGING pn.map ERROR ===');
    
    // Validate erc20AmountRecipients array
    console.log('[RailgunActions] Validating erc20AmountRecipients:', {
      value: erc20AmountRecipients,
      isArray: Array.isArray(erc20AmountRecipients),
      length: erc20AmountRecipients?.length,
      type: typeof erc20AmountRecipients,
      constructor: erc20AmountRecipients?.constructor?.name,
      hasMapMethod: typeof erc20AmountRecipients?.map === 'function'
    });

    // Safety check for erc20AmountRecipients
    if (!Array.isArray(erc20AmountRecipients)) {
      console.error('[RailgunActions] ❌ erc20AmountRecipients must be an array:', erc20AmountRecipients);
      throw new Error(`erc20AmountRecipients must be an array, got: ${typeof erc20AmountRecipients}`);
    }

    if (erc20AmountRecipients.length === 0) {
      console.error('[RailgunActions] ❌ erc20AmountRecipients array is empty');
      throw new Error('erc20AmountRecipients array cannot be empty');
    }

    // Validate nftAmountRecipients array  
    console.log('[RailgunActions] Validating nftAmountRecipients:', {
      value: nftAmountRecipients,
      isArray: Array.isArray(nftAmountRecipients),
      length: nftAmountRecipients?.length,
      type: typeof nftAmountRecipients,
      constructor: nftAmountRecipients?.constructor?.name,
      hasMapMethod: typeof nftAmountRecipients?.map === 'function'
    });

    // Safety check for nftAmountRecipients
    if (!Array.isArray(nftAmountRecipients)) {
      console.error('[RailgunActions] ❌ nftAmountRecipients must be an array:', nftAmountRecipients);
      throw new Error(`nftAmountRecipients must be an array, got: ${typeof nftAmountRecipients}`);
    }

    // Inspect each erc20AmountRecipient object structure
    erc20AmountRecipients.forEach((recipient, index) => {
      console.log(`[RailgunActions] erc20AmountRecipient[${index}]:`, {
        tokenAddress: {
          value: recipient?.tokenAddress,
          type: typeof recipient?.tokenAddress,
          isUndefined: recipient?.tokenAddress === undefined,
          isNull: recipient?.tokenAddress === null
        },
        amount: {
          value: recipient?.amount,
          type: typeof recipient?.amount,
          isString: typeof recipient?.amount === 'string'
        },
        recipientAddress: {
          value: recipient?.recipientAddress ? `${recipient.recipientAddress.slice(0, 8)}...` : recipient?.recipientAddress,
          type: typeof recipient?.recipientAddress,
          length: recipient?.recipientAddress?.length,
          startsWithRailgun: recipient?.recipientAddress?.startsWith?.('0zk')
        },
        objectStructure: {
          hasTokenAddress: 'tokenAddress' in (recipient || {}),
          hasAmount: 'amount' in (recipient || {}),
          hasRecipientAddress: 'recipientAddress' in (recipient || {}),
          keys: Object.keys(recipient || {})
        }
      });

      // Validate each recipient object
      if (!recipient || typeof recipient !== 'object') {
        console.error(`[RailgunActions] ❌ erc20AmountRecipient[${index}] must be an object:`, recipient);
        throw new Error(`erc20AmountRecipient[${index}] must be an object`);
      }

      if (!('tokenAddress' in recipient)) {
        console.error(`[RailgunActions] ❌ erc20AmountRecipient[${index}] missing tokenAddress property`);
        throw new Error(`erc20AmountRecipient[${index}] must have tokenAddress property`);
      }

      if (!('amount' in recipient)) {
        console.error(`[RailgunActions] ❌ erc20AmountRecipient[${index}] missing amount property`);
        throw new Error(`erc20AmountRecipient[${index}] must have amount property`);
      }

      if (!('recipientAddress' in recipient)) {
        console.error(`[RailgunActions] ❌ erc20AmountRecipient[${index}] missing recipientAddress property`);
        throw new Error(`erc20AmountRecipient[${index}] must have recipientAddress property`);
      }
    });

    // Validate all other parameters
    console.log('[RailgunActions] Validating all gasEstimateForShield parameters:', {
      networkName: {
        value: networkName,
        type: typeof networkName,
        isString: typeof networkName === 'string'
      },
      shieldPrivateKey: {
        hasValue: !!shieldPrivateKey,
        type: typeof shieldPrivateKey,
        isString: typeof shieldPrivateKey === 'string',
        length: shieldPrivateKey?.length
      },
      erc20AmountRecipients: {
        isArray: Array.isArray(erc20AmountRecipients),
        length: erc20AmountRecipients.length,
        type: typeof erc20AmountRecipients
      },
      nftAmountRecipients: {
        isArray: Array.isArray(nftAmountRecipients),
        length: nftAmountRecipients.length,
        type: typeof nftAmountRecipients
      },
      fromAddress: {
        value: fromAddress ? `${fromAddress.slice(0, 8)}...` : fromAddress,
        type: typeof fromAddress,
        isString: typeof fromAddress === 'string',
        length: fromAddress?.length
      }
    });

    // Final safety checks before SDK call
    if (typeof networkName !== 'string') {
      throw new Error(`networkName must be a string, got: ${typeof networkName}`);
    }
    if (typeof shieldPrivateKey !== 'string') {
      throw new Error(`shieldPrivateKey must be a string, got: ${typeof shieldPrivateKey}`);
    }
    if (typeof fromAddress !== 'string') {
      throw new Error(`fromAddress must be a string, got: ${typeof fromAddress}`);
    }

    console.log('[RailgunActions] ✅ All parameters validated successfully');
    console.log('[RailgunActions] === END DEBUGGING ===');

    // 🔍 DETAILED NETWORK NAME LOGGING BEFORE SDK CALL
    console.log('[RailgunActions] === NETWORK NAME VALIDATION ===');
    console.log('[RailgunActions] networkName detailed analysis:', {
      value: networkName,
      type: typeof networkName,
      stringValue: String(networkName),
      isString: typeof networkName === 'string',
      isEnum: Object.values(NetworkName).includes(networkName),
      enumValues: Object.values(NetworkName),
      enumKeys: Object.keys(NetworkName),
      networkNameEnum: NetworkName,
      arbitrumValue: NetworkName.Arbitrum,
      isArbitrum: networkName === NetworkName.Arbitrum
    });

    // Validate networkName is a valid enum value
    if (!Object.values(NetworkName).includes(networkName)) {
      console.error('[RailgunActions] ❌ Invalid NetworkName enum value:', {
        provided: networkName,
        validValues: Object.values(NetworkName)
      });
      throw new Error(`Invalid NetworkName: ${networkName}. Valid values: ${Object.values(NetworkName).join(', ')}`);
    }

    console.log('[RailgunActions] ✅ NetworkName is valid enum value');
    console.log('[RailgunActions] === END NETWORK NAME VALIDATION ===');

    console.log('[RailgunActions] Gas estimation parameters (official pattern):', {
      networkName,
      shieldPrivateKey: shieldPrivateKey ? 'PRESENT' : 'MISSING',
      erc20AmountRecipients: erc20AmountRecipients.length,
      nftAmountRecipients: nftAmountRecipients.length,
      fromAddress: fromAddress ? `${fromAddress.slice(0, 8)}...` : 'MISSING'
    });

    let gasDetails;
    try {
      // ✅ USE OFFICIAL PATTERN: gasEstimateForShield with shieldPrivateKey
      gasDetails = await gasEstimateForShield(
        networkName,
        shieldPrivateKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        fromAddress
      );
      console.log('[RailgunActions] Gas estimation successful (official pattern):', gasDetails);
    } catch (sdkError) {
      console.error('[RailgunActions] Gas estimation failed (official pattern):', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Gas estimation failed: ${sdkError.message}`);
    }

    // ✅ STEP 3: Generate Shield Transaction (Official Pattern)
    console.log('[RailgunActions] Step 3: Generating shield transaction...');
    let shieldTxResult;
    try {
      shieldTxResult = await generateShieldTransaction(
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        fromAddress,
        feeTokenDetails // ✅ Add fee token details for transaction generation
      );
      console.log('[RailgunActions] Shield transaction generated successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] Shield transaction generation failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Shield transaction generation failed: ${sdkError.message}`);
    }

    // ✅ STEP 4: Populate Shield Transaction (Official Pattern)
    console.log('[RailgunActions] Step 4: Populating shield transaction...');
    let populatedResult;
    try {
      populatedResult = await populateShield(
        networkName,
        railgunWalletID,
        erc20AmountRecipients,
        nftAmountRecipients,
        shieldTxResult.shieldPrivateKey,
        feeTokenDetails // ✅ Add fee token details for consistency (if required by SDK)
      );
      console.log('[RailgunActions] Shield transaction populated successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] Shield transaction population failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Shield transaction population failed: ${sdkError.message}`);
    }

    console.log('[RailgunActions] ✅ Shield operation completed successfully');
    return {
      gasEstimate: gasDetails,
      transaction: populatedResult.transaction,
      shieldPrivateKey: shieldTxResult.shieldPrivateKey,
    };

  } catch (error) {
    console.error('[RailgunActions] ❌ Shield operation failed:', {
      error: error,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Unshield tokens from Railgun (Private → Public) with 1% fee collection
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
    console.log('[RailgunActions] Starting unshield operation with parameters:', {
      railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
      hasEncryptionKey: !!encryptionKey,
      encryptionKeyLength: encryptionKey ? encryptionKey.length : 0,
      tokenAddress,
      tokenType: tokenAddress === null ? 'NATIVE' : 'ERC20',
      amount,
      chainId: chain?.id,
      toAddress,
    });

    // Wait for Railgun to be ready
    await waitForRailgunReady();

    // ✅ COMPREHENSIVE PARAMETER VALIDATION
    if (!railgunWalletID || typeof railgunWalletID !== 'string') {
      throw new Error('railgunWalletID must be a non-empty string');
    }

    if (!encryptionKey || typeof encryptionKey !== 'string' || encryptionKey.length < 32) {
      throw new Error('encryptionKey must be a string with at least 32 characters');
    }

    // ✅ ENHANCED TOKEN ADDRESS VALIDATION (ETHERS.JS)
    if (tokenAddress !== null && tokenAddress !== undefined) {
      if (!isAddress(tokenAddress)) {
        console.error(`[Unshield] Invalid or missing tokenAddress: ${tokenAddress}`);
        throw new Error("Invalid token address passed to unshielding flow");
      }
      tokenAddress = validateAndFormatAddress(tokenAddress, 'tokenAddress');
    }

    if (!amount || typeof amount !== 'string') {
      throw new Error('amount must be a non-empty string');
    }

    if (!chain || typeof chain !== 'object' || !chain.id) {
      throw new Error('chain must be an object with an id property');
    }

    toAddress = validateAndFormatAddress(toAddress, 'toAddress');

    // Get the correct Railgun network name
    const networkName = getRailgunNetworkName(chain.id);
    console.log('[RailgunActions] Using Railgun network:', networkName);

    // ✅ CALCULATE 1% FEE USING RAILGUN ENGINE DATA
    const unshieldAmount = BigInt(amount); // User's input amount
    const feeBps = BigInt(FEE_COLLECTION_CONFIG.FEE_BASIS_POINTS); // 100n (1%)
    const feeAmount = (unshieldAmount * feeBps) / 10000n; // Calculate 1% fee
    
    // ✅ GET TOKEN DETAILS FOR FEE TOKEN DETAILS
    const tokens = getTokensForChain(chain.id);
    const currentToken = Object.values(tokens).find(token => {
      if (tokenAddress === null && token.isNative) return true;
      if (tokenAddress && token.address) {
        return getAddress(token.address) === getAddress(tokenAddress);
      }
      return false;
    });
    
    if (!currentToken) {
      throw new Error(`Token not found for address: ${tokenAddress || 'native'}`);
    }

    // ✅ CONSTRUCT PROPER FEE TOKEN DETAILS WITH FEE AMOUNT
    const feeTokenDetails = {
      tokenAddress: tokenAddress === null ? currentToken.address : tokenAddress, // Token being unshielded
      feeAmount, // ✅ CRITICAL: Calculated fee amount for SDK to deduct
      feePerUnitGas: 0n, // We're not using a relayer
      feeReceiverAddress: FEE_COLLECTION_CONFIG.RECIPIENT_ADDRESS, // ✅ Our fee wallet
      chainId: chain.id, // CRITICAL: SDK uses chainId to derive chain internally  
      decimals: currentToken.decimals,
      symbol: currentToken.symbol,
    };
    
    console.log('[RailgunActions] ✅ Constructed feeTokenDetails with 1% fee collection:', {
      tokenAddress: feeTokenDetails.tokenAddress,
      feeAmount: feeAmount.toString(),
      feeReceiverAddress: feeTokenDetails.feeReceiverAddress,
      chainId: feeTokenDetails.chainId,
      symbol: feeTokenDetails.symbol,
      feePercentage: '1%'
    });

    // ✅ CREATE RECIPIENT FOR USER (SDK WILL HANDLE FEE DEDUCTION)
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
    
    // ✅ DEFENSIVE CHECK AFTER RECIPIENT CREATION
    if (!erc20AmountRecipient || typeof erc20AmountRecipient !== 'object') {
      throw new Error('createERC20AmountRecipient() returned invalid value');
    }

    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty array for unshield operations

    console.log('[RailgunActions] Prepared unshield recipients:', {
      erc20AmountRecipients,
      nftAmountRecipients
    });

    // ✅ STEP 1: Gas Estimation with feeTokenDetails
    console.log('[RailgunActions] Step 1: Gas estimation for unshield...');
    let gasDetails;
    try {
      gasDetails = await gasEstimateForUnprovenUnshield(
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        feeTokenDetails // ✅ CRITICAL: V10.4.x requires feeTokenDetails to prevent 'chain' property error
      );
      console.log('[RailgunActions] Unshield gas estimation successful:', gasDetails);
    } catch (sdkError) {
      console.error('[RailgunActions] Unshield gas estimation failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Unshield gas estimation failed: ${sdkError.message}`);
    }

    // ✅ STEP 2: Generate Unshield Proof
    console.log('[RailgunActions] Step 2: Generating unshield proof...');
    let proofResult;
    try {
      proofResult = await generateUnshieldProof(
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients,
        nftAmountRecipients,
        feeTokenDetails // ✅ Add fee token details for consistency
      );
      console.log('[RailgunActions] Unshield proof generated successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] Unshield proof generation failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Unshield proof generation failed: ${sdkError.message}`);
    }

    // ✅ STEP 3: Populate Proved Unshield Transaction
    console.log('[RailgunActions] Step 3: Populating unshield transaction...');
    let populatedResult;
    try {
      populatedResult = await populateProvedUnshield(
        networkName,
        railgunWalletID,
        erc20AmountRecipients,
        nftAmountRecipients,
        feeTokenDetails // ✅ Add fee token details for consistency (if required by SDK)
      );
      console.log('[RailgunActions] Unshield transaction populated successfully');
    } catch (sdkError) {
      console.error('[RailgunActions] Unshield transaction population failed:', {
        error: sdkError,
        message: sdkError.message,
        stack: sdkError.stack
      });
      throw new Error(`Unshield transaction population failed: ${sdkError.message}`);
    }

    if (!populatedResult || !populatedResult.transaction) {
      throw new Error('Failed to populate unshield transaction');
    }

    console.log('[RailgunActions] ✅ Unshield operation completed successfully');
    return { 
      success: true, 
      transaction: populatedResult.transaction,
      gasEstimate: gasDetails,
      feeAmount: feeAmount.toString(), // Return fee amount for user reference
      feeReceiverAddress: FEE_COLLECTION_CONFIG.RECIPIENT_ADDRESS
    };

  } catch (error) {
    console.error('[RailgunActions] ❌ Unshield operation failed:', {
      error: error,
      message: error.message,
      stack: error.stack
    });
    throw error;
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
 * @param {string} gasEstimationRecipient - Public EOA address for gas estimation (required by SDK)
 * @returns {Object} Shield results for all tokens
 */
export const shieldAllTokens = async (railgunWalletID, encryptionKey, tokens, chain, fromAddress, railgunAddress, gasEstimationRecipient) => {
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
 * @param {Object} feeTokenDetails - Fee token details with chain property
 * @returns {Object} Gas details
 */
export const estimateShieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, fromAddress, feeTokenDetails) => {
  try {
    console.log('[RailgunActions] Estimating shield gas');
    
    // ✅ VALIDATE FEE TOKEN DETAILS PARAMETER
    if (!feeTokenDetails || typeof feeTokenDetails !== 'object') {
      throw new Error('feeTokenDetails is required and must be an object');
    }
    
    if (!feeTokenDetails.chain || typeof feeTokenDetails.chain !== 'string') {
      throw new Error('feeTokenDetails.chain is required and must be a string (network name)');
    }
    
    console.log('[RailgunActions] Using feeTokenDetails:', {
      chain: feeTokenDetails.chain,
      chainId: feeTokenDetails.chainId,
      symbol: feeTokenDetails.symbol
    });
    
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
      feeTokenDetails // ✅ CRITICAL: V10.4.x requires feeTokenDetails to prevent 'chain' property error
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
 * @param {Object} feeTokenDetails - Fee token details with chain property
 * @returns {Object} Gas details
 */
export const estimateUnshieldGas = async (networkName, railgunWalletID, encryptionKey, erc20AmountRecipients, nftAmountRecipients, feeTokenDetails) => {
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
      feeTokenDetails // ✅ CRITICAL: V10.4.x requires feeTokenDetails to prevent 'chain' property error
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

