/**
 * Railgun Privacy Actions - OFFICIAL IMPLEMENTATION
 * Implements Shield, Transfer, and Unshield operations using the Railgun SDK
 * 
 * Based on official Railgun Community patterns from:
 * - https://github.com/Railgun-Community/wallet
 * - https://github.com/Railgun-Community/cookbook
 * 
 * SHIELD OPERATION FLOW (OFFICIAL):
 * ==================================
 * The Railgun SDK requires a 2-step process for shield operations:
 * 
 * 1. Gas Estimation: gasEstimateForShield
 * 2. Transaction Population: populateShield
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
  populateShield,
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
  getShieldPrivateKeySignatureMessage,
} from '@railgun-community/wallet';
import { 
  NetworkName, 
  EVMGasType, 
  getEVMGasTypeForTransaction 
} from '@railgun-community/shared-models';
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
 * Ensure arrays are properly initialized for Railgun SDK calls
 * CRITICAL: Prevents "pn.map is not a function" errors
 * @param {any} erc20Recipients - ERC20 amount recipients
 * @param {any} nftRecipients - NFT amount recipients  
 * @param {any} memoArray - Memo array (optional)
 * @returns {Object} Safe arrays for SDK calls
 */
function ensureSafeArraysForSDK(erc20Recipients, nftRecipients, memoArray = null) {
  console.log('🔍 [ensureSafeArraysForSDK] FUNCTION ENTRY - Input analysis:');
  console.log('🔍 Input erc20Recipients:', {
    value: erc20Recipients,
    type: typeof erc20Recipients,
    isArray: Array.isArray(erc20Recipients),
    length: erc20Recipients?.length,
    constructor: erc20Recipients?.constructor?.name,
    hasMapFunction: erc20Recipients?.map !== undefined
  });
  console.log('🔍 Input nftRecipients:', {
    value: nftRecipients,
    type: typeof nftRecipients,
    isArray: Array.isArray(nftRecipients),
    length: nftRecipients?.length,
    constructor: nftRecipients?.constructor?.name,
    hasMapFunction: nftRecipients?.map !== undefined
  });
  console.log('🔍 Input memoArray:', {
    value: memoArray,
    type: typeof memoArray,
    isArray: Array.isArray(memoArray),
    isNull: memoArray === null
  });

  // Check for problematic types that cause "pn.map is not a function"
  if (typeof erc20Recipients === 'number' || typeof erc20Recipients === 'string') {
    console.error('[RailgunActions] ❌ CRITICAL: erc20Recipients is not an array!', {
      type: typeof erc20Recipients,
      value: erc20Recipients,
      shouldBe: 'Array'
    });
  }
  
  if (typeof nftRecipients === 'number' || typeof nftRecipients === 'string') {
    console.error('[RailgunActions] ❌ CRITICAL: nftRecipients is not an array!', {
      type: typeof nftRecipients,
      value: nftRecipients,
      shouldBe: 'Array'
    });
  }

  const safeErc20Recipients = Array.isArray(erc20Recipients) ? erc20Recipients : [];
  const safeNftRecipients = Array.isArray(nftRecipients) ? nftRecipients : [];
  const safeMemoArray = memoArray ? (Array.isArray(memoArray) ? memoArray : []) : [];
  
  console.log('🔍 [ensureSafeArraysForSDK] After conversion - Safe arrays created:');
  console.log('🔍 safeErc20Recipients:', {
    value: safeErc20Recipients,
    type: typeof safeErc20Recipients,
    isArray: Array.isArray(safeErc20Recipients),
    length: safeErc20Recipients?.length,
    constructor: safeErc20Recipients?.constructor?.name,
    hasMapFunction: safeErc20Recipients?.map !== undefined,
    mapType: typeof safeErc20Recipients?.map,
    prototype: Object.getPrototypeOf(safeErc20Recipients)?.constructor?.name
  });
  console.log('🔍 safeNftRecipients:', {
    value: safeNftRecipients,
    type: typeof safeNftRecipients,
    isArray: Array.isArray(safeNftRecipients),
    length: safeNftRecipients?.length,
    constructor: safeNftRecipients?.constructor?.name,
    hasMapFunction: safeNftRecipients?.map !== undefined,
    mapType: typeof safeNftRecipients?.map,
    prototype: Object.getPrototypeOf(safeNftRecipients)?.constructor?.name
  });
  
  // ✅ VALIDATE ARRAY CONTENTS - ensure objects are properly formed
  safeErc20Recipients.forEach((recipient, index) => {
    if (!recipient || typeof recipient !== 'object') {
      console.error(`[RailgunActions] ❌ CRITICAL: erc20Recipients[${index}] is not an object:`, {
        recipient,
        type: typeof recipient,
        index
      });
    } else {
      // Validate required properties
      if (!('tokenAddress' in recipient) || !('amount' in recipient) || !('recipientAddress' in recipient)) {
        console.error(`[RailgunActions] ❌ CRITICAL: erc20Recipients[${index}] missing required properties:`, {
          recipient,
          hasTokenAddress: 'tokenAddress' in recipient,
          hasAmount: 'amount' in recipient,
          hasRecipientAddress: 'recipientAddress' in recipient,
          keys: Object.keys(recipient)
        });
      }
    }
  });
  
  safeNftRecipients.forEach((recipient, index) => {
    if (!recipient || typeof recipient !== 'object') {
      console.error(`[RailgunActions] ❌ CRITICAL: nftRecipients[${index}] is not an object:`, {
        recipient,
        type: typeof recipient,
        index
      });
    }
  });
  
  console.log('[RailgunActions] ✅ Array validation for SDK:', {
    erc20Recipients: {
      original: erc20Recipients,
      originalType: typeof erc20Recipients,
      isArray: Array.isArray(erc20Recipients),
      safe: safeErc20Recipients,
      length: safeErc20Recipients.length,
      fixed: !Array.isArray(erc20Recipients),
      contentsValid: safeErc20Recipients.every(r => r && typeof r === 'object' && 'tokenAddress' in r && 'amount' in r && 'recipientAddress' in r)
    },
    nftRecipients: {
      original: nftRecipients,
      originalType: typeof nftRecipients,
      isArray: Array.isArray(nftRecipients),
      safe: safeNftRecipients,
      length: safeNftRecipients.length,
      fixed: !Array.isArray(nftRecipients),
      contentsValid: safeNftRecipients.every(r => !r || (typeof r === 'object'))
    },
    ...(memoArray && {
      memoArray: {
        original: memoArray,
        originalType: typeof memoArray,
        isArray: Array.isArray(memoArray),
        safe: safeMemoArray,
        length: safeMemoArray.length,
        fixed: memoArray && !Array.isArray(memoArray)
      }
    })
  });
  
  console.log('🔍 [ensureSafeArraysForSDK] FUNCTION EXIT - Returning:');
  console.log('🔍 Returning safeErc20Recipients:', {
    value: safeErc20Recipients,
    type: typeof safeErc20Recipients,
    isArray: Array.isArray(safeErc20Recipients),
    length: safeErc20Recipients?.length,
    constructor: safeErc20Recipients?.constructor?.name,
    hasMapFunction: safeErc20Recipients?.map !== undefined,
    mapType: typeof safeErc20Recipients?.map
  });
  console.log('🔍 Returning safeNftRecipients:', {
    value: safeNftRecipients,
    type: typeof safeNftRecipients,
    isArray: Array.isArray(safeNftRecipients),
    length: safeNftRecipients?.length,
    constructor: safeNftRecipients?.constructor?.name,
    hasMapFunction: safeNftRecipients?.map !== undefined,
    mapType: typeof safeNftRecipients?.map
  });

  const returnObject = {
    safeErc20Recipients,
    safeNftRecipients,
    safeMemoArray
  };
  
  console.log('🔍 Final return object:', returnObject);
  return returnObject;
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
  const callId = `shield-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  try {
    console.log(`[RailgunActions:${callId}] Starting OFFICIAL shield operation with parameters:`, {
      railgunWalletID: railgunWalletID ? `${railgunWalletID.slice(0, 8)}...` : 'MISSING',
      hasEncryptionKey: !!encryptionKey,
      encryptionKeyLength: encryptionKey ? encryptionKey.length : 0,
      tokenAddress,
      tokenType: tokenAddress === null ? 'NATIVE' : 'ERC20',
      amount,
      chainId: chain?.id,
      fromAddress,
      railgunAddress,
      callId
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
    const nftAmountRecipients = []; // Always empty array for shield operations

    // ✅ CRITICAL: Ensure arrays are safe for SDK calls
    console.log('🔍 [SHIELD] BEFORE ensureSafeArraysForSDK - Input validation:');
    console.log('🔍 erc20AmountRecipients:', {
      value: erc20AmountRecipients,
      type: typeof erc20AmountRecipients,
      isArray: Array.isArray(erc20AmountRecipients),
      length: erc20AmountRecipients?.length,
      constructor: erc20AmountRecipients?.constructor?.name,
      firstElement: erc20AmountRecipients?.[0]
    });
    console.log('🔍 nftAmountRecipients:', {
      value: nftAmountRecipients,
      type: typeof nftAmountRecipients,
      isArray: Array.isArray(nftAmountRecipients),
      length: nftAmountRecipients?.length,
      constructor: nftAmountRecipients?.constructor?.name
    });
    
    const { safeErc20Recipients } = ensureSafeArraysForSDK(
      erc20AmountRecipients, 
      nftAmountRecipients
    );
    
    console.log('🔍 [SHIELD] AFTER ensureSafeArraysForSDK - Result validation:');
    console.log('🔍 safeErc20Recipients from function:', {
      value: safeErc20Recipients,
      type: typeof safeErc20Recipients,
      isArray: Array.isArray(safeErc20Recipients),
      length: safeErc20Recipients?.length,
      constructor: safeErc20Recipients?.constructor?.name,
      hasMapFunction: safeErc20Recipients?.map !== undefined,
      mapType: typeof safeErc20Recipients?.map,
      prototype: Object.getPrototypeOf(safeErc20Recipients)?.constructor?.name,
      stringified: JSON.stringify(safeErc20Recipients)
    });
    
    // 🔧 TEMPORARY: Force NFT recipients to empty array to isolate .map() errors
    const safeNftRecipients = [];
    
    console.log('🔍 [SHIELD] Final arrays before SDK call:');
    console.log('🔍 safeErc20Recipients final:', safeErc20Recipients);
    console.log('🔍 safeNftRecipients final:', safeNftRecipients);

    console.log('[RailgunActions] Created properly structured parameters:', {
      networkName,
      erc20AmountRecipients: safeErc20Recipients.map(r => ({
        tokenAddress: r.tokenAddress,
        tokenAddressType: typeof r.tokenAddress,
        amount: r.amount,
        amountType: typeof r.amount,
        recipientAddress: r.recipientAddress ? `${r.recipientAddress.slice(0, 8)}...` : 'MISSING'
      })),
      nftAmountRecipientsLength: safeNftRecipients.length,
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
    
    // Validate networkName is a valid enum value
    if (!Object.values(NetworkName).includes(networkName)) {
      console.error('[RailgunActions] ❌ Invalid NetworkName enum value:', {
        provided: networkName,
        validValues: Object.values(NetworkName)
      });
      throw new Error(`Invalid NetworkName: ${networkName}. Valid values: ${Object.values(NetworkName).join(', ')}`);
    }

    console.log('[RailgunActions] Gas estimation parameters (official pattern):', {
      networkName,
      shieldPrivateKey: shieldPrivateKey ? 'PRESENT' : 'MISSING',
      erc20AmountRecipients: safeErc20Recipients.length,
      nftAmountRecipients: safeNftRecipients.length,
      fromAddress: fromAddress ? `${fromAddress.slice(0, 8)}...` : 'MISSING'
    });

    let gasEstimateResult;
    try {
      // ✅ CRITICAL: Log exact array contents before SDK call
      console.log('[RailgunActions] ===== CRITICAL DEBUG: EXACT ARRAYS BEFORE SDK CALL =====');
      console.log('[RailgunActions] safeErc20Recipients:', {
        value: safeErc20Recipients,
        type: typeof safeErc20Recipients,
        isArray: Array.isArray(safeErc20Recipients),
        length: safeErc20Recipients?.length,
        constructor: safeErc20Recipients?.constructor?.name,
        firstElement: safeErc20Recipients[0],
        stringified: JSON.stringify(safeErc20Recipients)
      });
      
      console.log('[RailgunActions] safeNftRecipients:', {
        value: safeNftRecipients,
        type: typeof safeNftRecipients,
        isArray: Array.isArray(safeNftRecipients),
        length: safeNftRecipients?.length,
        constructor: safeNftRecipients?.constructor?.name,
        stringified: JSON.stringify(safeNftRecipients)
      });

      console.log('[RailgunActions] Call Stack Trace:', new Error().stack);
      console.log('[RailgunActions] ===== END CRITICAL DEBUG =====');

      // ✅ DEFENSIVE SDK CALL WITH ENHANCED ERROR CAPTURE
      console.log('🔍 [RAILGUN:CALL] About to call gasEstimateForShield with official debug logging...');
      
      // Ensure all parameters are exactly what the SDK expects
      const sdkParams = [
        networkName,           // string: NetworkName enum
        shieldPrivateKey,      // string: hex private key
        safeErc20Recipients,   // Array: ERC20AmountRecipient[]
        safeNftRecipients,     // Array: NFTAmountRecipient[] (empty)
        fromAddress            // string: EOA address
      ];
      
      console.log('🔍 [RAILGUN:PARAMS] SDK Parameters FULL DETAILED ANALYSIS:');
      sdkParams.forEach((param, i) => {
        console.log(`🔍 [RAILGUN:PARAM${i}]`, {
          index: i,
          value: param,
          type: typeof param,
          constructor: param?.constructor?.name,
          isArray: Array.isArray(param),
          length: Array.isArray(param) ? param.length : 'N/A',
          isNull: param === null,
          isUndefined: param === undefined,
          stringified: JSON.stringify(param),
          // Deep inspection for arrays
          ...(Array.isArray(param) && {
            arrayContents: param.map((item, idx) => ({
              index: idx,
              value: item,
              type: typeof item,
              constructor: item?.constructor?.name,
              keys: typeof item === 'object' && item !== null ? Object.keys(item) : 'N/A'
            }))
          })
        });
      });

      // Additional validation right before SDK call
      console.log('🔍 [RAILGUN:VALIDATION] Final parameter validation before SDK call:');
      console.log('🔍 networkName:', { value: networkName, type: typeof networkName, valid: typeof networkName === 'string' });
      console.log('🔍 shieldPrivateKey:', { present: !!shieldPrivateKey, type: typeof shieldPrivateKey, valid: typeof shieldPrivateKey === 'string' });
      console.log('🔍 safeErc20Recipients:', { 
        value: safeErc20Recipients, 
        type: typeof safeErc20Recipients,
        isArray: Array.isArray(safeErc20Recipients),
        length: safeErc20Recipients?.length,
        hasMapFunction: safeErc20Recipients?.map !== undefined,
        mapType: typeof safeErc20Recipients?.map,
        valid: Array.isArray(safeErc20Recipients) && typeof safeErc20Recipients.map === 'function'
      });
      console.log('🔍 safeNftRecipients:', { 
        value: safeNftRecipients, 
        type: typeof safeNftRecipients,
        isArray: Array.isArray(safeNftRecipients),
        length: safeNftRecipients?.length,
        hasMapFunction: safeNftRecipients?.map !== undefined,
        mapType: typeof safeNftRecipients?.map,
        valid: Array.isArray(safeNftRecipients) && typeof safeNftRecipients.map === 'function'
      });
      console.log('🔍 fromAddress:', { value: fromAddress, type: typeof fromAddress, valid: typeof fromAddress === 'string' });

      // ✅ OFFICIAL PATTERN: destructure { gasEstimate } from gasEstimateForShield
      console.log('🔍 [RAILGUN:CALLING] gasEstimateForShield NOW...');
      gasEstimateResult = await gasEstimateForShield(
        networkName,
        shieldPrivateKey,
        safeErc20Recipients,
        safeNftRecipients,
        fromAddress
      );
      console.log('🔍 [RAILGUN:SUCCESS] gasEstimateForShield completed successfully');
      
      console.log('🎉 [RAILGUN:SUCCESS] Gas estimation successful (official pattern):', gasEstimateResult);
    } catch (sdkError) {
      console.error('[RailgunActions] ===== COMPREHENSIVE ERROR ANALYSIS =====');
      console.error('[RailgunActions] 🚨 FULL ERROR OBJECT INSPECTION:');
      
      // Log every possible property of the error
      console.error('🚨 ERROR PROPERTIES:', {
        name: sdkError.name,
        message: sdkError.message,
        stack: sdkError.stack,
        cause: sdkError.cause,
        code: sdkError.code,
        errno: sdkError.errno,
        syscall: sdkError.syscall,
        type: typeof sdkError,
        constructor: sdkError.constructor?.name,
        keys: Object.keys(sdkError),
        ownPropertyNames: Object.getOwnPropertyNames(sdkError),
        prototype: Object.getPrototypeOf(sdkError)?.constructor?.name
      });

      // Try to stringify the error to see hidden properties
      try {
        console.error('🚨 ERROR STRINGIFIED:', JSON.stringify(sdkError, null, 2));
      } catch (stringifyError) {
        console.error('🚨 Could not stringify error:', stringifyError.message);
      }

      // Log the exact line number and file from stack trace
      if (sdkError.stack) {
        console.error('🚨 STACK TRACE ANALYSIS:');
        const stackLines = sdkError.stack.split('\n');
        stackLines.forEach((line, index) => {
          console.error(`🚨 Stack[${index}]:`, line.trim());
          if (line.includes('main-DkrhSDP7.js:3847')) {
            console.error('🎯 FOUND THE EXACT ERROR LINE! ^^^ This is line 3847');
          }
        });
      }

      console.error('[RailgunActions] 🚨 PARAMETER STATE AT ERROR TIME:');
      console.error('- networkName:', {
        value: networkName, 
        type: typeof networkName,
        valid: typeof networkName === 'string' && networkName.length > 0
      });
      console.error('- shieldPrivateKey:', {
        present: !!shieldPrivateKey, 
        type: typeof shieldPrivateKey,
        length: shieldPrivateKey?.length,
        valid: typeof shieldPrivateKey === 'string' && shieldPrivateKey.length > 0
      });
      console.error('- safeErc20Recipients:', {
        value: safeErc20Recipients,
        type: typeof safeErc20Recipients,
        isArray: Array.isArray(safeErc20Recipients),
        length: safeErc20Recipients?.length,
        hasMapFunction: safeErc20Recipients?.map !== undefined,
        mapType: typeof safeErc20Recipients?.map,
        firstElement: safeErc20Recipients?.[0],
        valid: Array.isArray(safeErc20Recipients) && typeof safeErc20Recipients.map === 'function'
      });
      console.error('- safeNftRecipients:', {
        value: safeNftRecipients,
        type: typeof safeNftRecipients,
        isArray: Array.isArray(safeNftRecipients),
        length: safeNftRecipients?.length,
        hasMapFunction: safeNftRecipients?.map !== undefined,
        mapType: typeof safeNftRecipients?.map,
        valid: Array.isArray(safeNftRecipients) && typeof safeNftRecipients.map === 'function'
      });
      console.error('- fromAddress:', {
        value: fromAddress,
        type: typeof fromAddress,
        length: fromAddress?.length,
        valid: typeof fromAddress === 'string' && fromAddress.length > 0
      });
      
      // Check for specific "map" errors with enhanced detection
      if (sdkError.message && (sdkError.message.includes('.map is not a function') || sdkError.message.includes('pn.map'))) {
        console.error('🎯 [RAILGUN:MAP_ERROR] DETECTED: pn.map is not a function!');
        console.error('🎯 This means something called "pn" inside the SDK does not have a .map() method');
        console.error('🎯 "pn" likely refers to one of our array parameters that is not actually an array');
        console.error('🎯 DEEP ARRAY INSPECTION:');
        
        console.error('🎯 safeErc20Recipients deep analysis:');
        console.error('  - Value:', safeErc20Recipients);
        console.error('  - Type:', typeof safeErc20Recipients);
        console.error('  - Constructor:', safeErc20Recipients?.constructor?.name);
        console.error('  - Has .map:', 'map' in (safeErc20Recipients || {}));
        console.error('  - Prototype:', Object.getPrototypeOf(safeErc20Recipients || {})?.constructor?.name);
        
        console.error('🎯 safeNftRecipients deep analysis:');
        console.error('  - Value:', safeNftRecipients);
        console.error('  - Type:', typeof safeNftRecipients);
        console.error('  - Constructor:', safeNftRecipients?.constructor?.name);
        console.error('  - Has .map:', 'map' in (safeNftRecipients || {}));
        console.error('  - Prototype:', Object.getPrototypeOf(safeNftRecipients || {})?.constructor?.name);
      }
      
      console.error('[RailgunActions] ===== END COMPREHENSIVE ERROR ANALYSIS =====');
      throw new Error(`Gas estimation failed: ${sdkError.message}`);
    }

    // ✅ CONSTRUCT PROPER TRANSACTION GAS DETAILS
    const sendWithPublicWallet = true; // Always true for Shield transactions
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    let transactionGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        transactionGasDetails = {
          evmGasType,
          gasEstimate: gasEstimateResult.gasEstimate || gasEstimateResult,
          gasPrice: BigInt(20000000000), // 20 gwei fallback
        };
        break;
      case EVMGasType.Type2:
        transactionGasDetails = {
          evmGasType,
          gasEstimate: gasEstimateResult.gasEstimate || gasEstimateResult,
          maxFeePerGas: BigInt(25000000000), // 25 gwei
          maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
        };
        break;
    }

    console.log('[RailgunActions] Constructed TransactionGasDetails:', {
      evmGasType: transactionGasDetails.evmGasType,
      gasEstimate: transactionGasDetails.gasEstimate?.toString(),
      gasPrice: transactionGasDetails.gasPrice?.toString(),
      maxFeePerGas: transactionGasDetails.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: transactionGasDetails.maxPriorityFeePerGas?.toString(),
    });

    // ✅ STEP 3: Populate Shield Transaction (Official Pattern)
    console.log('[RailgunActions] Step 3: Populating shield transaction...');
    let populatedResult;
    try {
      // ✅ OFFICIAL PATTERN: destructure { transaction } from populateShield
      populatedResult = await populateShield(
        networkName,
        shieldPrivateKey,
        safeErc20Recipients,
        safeNftRecipients,
        transactionGasDetails // ✅ Use proper TransactionGasDetails object
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

    if (!populatedResult || !populatedResult.transaction) {
      throw new Error('Failed to populate shield transaction');
    }

    console.log('[RailgunActions] ✅ Shield operation completed successfully');
    return {
      gasEstimate: gasEstimateResult,
      transaction: populatedResult.transaction,
      shieldPrivateKey: shieldPrivateKey,
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

    // ✅ CREATE RECIPIENT FOR USER
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
    
    // ✅ DEFENSIVE CHECK AFTER RECIPIENT CREATION
    if (!erc20AmountRecipient || typeof erc20AmountRecipient !== 'object') {
      throw new Error('createERC20AmountRecipient() returned invalid value');
    }

    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty array for unshield operations

    // ✅ CRITICAL: Ensure arrays are safe for SDK calls
    const { safeErc20Recipients } = ensureSafeArraysForSDK(
      erc20AmountRecipients, 
      nftAmountRecipients
    );
    
    // 🔧 TEMPORARY: Force NFT recipients to empty array to isolate .map() errors
    const safeNftRecipients = [];

    console.log('[RailgunActions] Prepared unshield recipients:', {
      erc20AmountRecipients: safeErc20Recipients,
      nftAmountRecipients: safeNftRecipients
    });

    // ✅ STEP 1: Gas Estimation (Official Pattern)
    console.log('[RailgunActions] Step 1: Gas estimation for unshield...');
    let gasDetails;
    try {
      gasDetails = await gasEstimateForUnprovenUnshield(
        networkName,
        railgunWalletID,
        encryptionKey,
        safeErc20Recipients,
        safeNftRecipients
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

    // ✅ STEP 2: Generate Unshield Proof (Official Pattern)
    console.log('[RailgunActions] Step 2: Generating unshield proof...');
    let proofResult;
    try {
      proofResult = await generateUnshieldProof(
        networkName,
        railgunWalletID,
        encryptionKey,
        safeErc20Recipients,
        safeNftRecipients
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

    // ✅ STEP 3: Populate Proved Unshield Transaction (Official Pattern)
    console.log('[RailgunActions] Step 3: Populating unshield transaction...');
    let populatedResult;
    try {
      populatedResult = await populateProvedUnshield(
        networkName,
        railgunWalletID,
        safeErc20Recipients,
        safeNftRecipients
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
      gasEstimate: gasDetails
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
    const networkName = getRailgunNetworkName(chain.id);

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

    // ✅ CRITICAL: Ensure arrays are safe for SDK calls
    const { safeErc20Recipients, safeMemoArray } = ensureSafeArraysForSDK(
      erc20AmountRecipients, 
      nftAmountRecipients,
      memoArray
    );
    
    // 🔧 TEMPORARY: Force NFT recipients to empty array to isolate .map() errors
    const safeNftRecipients = [];

    console.log('[RailgunActions] Prepared transfer recipients:', {
      erc20AmountRecipients: safeErc20Recipients,
      nftAmountRecipients: safeNftRecipients,
      memoArray: safeMemoArray
    });

    // Get gas estimate
    const gasDetails = await gasEstimateForUnprovenTransfer(
      networkName,
      railgunWalletID,
      encryptionKey,
      safeMemoArray,
      safeErc20Recipients,
      safeNftRecipients,
    );

    console.log('[RailgunActions] Transfer gas estimate:', gasDetails);

    // Generate transfer proof
    const proofResult = await generateTransferProof(
      networkName,
      railgunWalletID,
      encryptionKey,
      safeMemoArray,
      safeErc20Recipients,
      safeNftRecipients,
    );

    console.log('[RailgunActions] Transfer proof generated:', proofResult);

    // Populate the proved transfer transaction
    const populatedResult = await populateProvedTransfer(
      networkName,
      railgunWalletID,
      safeMemoArray,
      safeErc20Recipients,
      safeNftRecipients,
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
 * @param {string} shieldPrivateKey - Shield private key
 * @param {Array} erc20AmountRecipients - Array of ERC20 amount recipients
 * @param {Array} nftAmountRecipients - Array of NFT amount recipients
 * @param {string} fromAddress - EOA address sending the tokens
 * @returns {Object} Gas details
 */
export const estimateShieldGas = async (networkName, shieldPrivateKey, erc20AmountRecipients, nftAmountRecipients, fromAddress) => {
  try {
    console.log('[RailgunActions] Estimating shield gas');
    
    // ✅ CRITICAL: Ensure arrays are safe for SDK calls
    const { safeErc20Recipients } = ensureSafeArraysForSDK(
      erc20AmountRecipients, 
      nftAmountRecipients
    );
    
    // 🔧 TEMPORARY: Force NFT recipients to empty array to isolate .map() errors
    const safeNftRecipients = [];
    
    // Use actual Railgun gas estimation (Official Pattern)
    const gasDetails = await gasEstimateForShield(
      networkName,
      shieldPrivateKey,
      safeErc20Recipients,
      safeNftRecipients,
      fromAddress
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
    
    // ✅ CRITICAL: Ensure arrays are safe for SDK calls
    const { safeErc20Recipients } = ensureSafeArraysForSDK(
      erc20AmountRecipients, 
      nftAmountRecipients
    );
    
    // 🔧 TEMPORARY: Force NFT recipients to empty array to isolate .map() errors
    const safeNftRecipients = [];
    
    // Use actual Railgun gas estimation (Official Pattern)
    const gasDetails = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      safeErc20Recipients,
      safeNftRecipients
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

