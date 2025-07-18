/**
 * Railgun Privacy Actions - Clean Implementation
 * 
 * Implements Shield and Unshield operations following official Railgun documentation:
 * - Shield: https://docs.railgun.org/developer-guide/wallet/transactions/shielding/shield-erc-20-token
 * - Unshield: https://docs.railgun.org/developer-guide/wallet/transactions/unshielding/unshield-erc-20-tokens
 * 
 * Only includes shield and unshield functionality - no transfers or batch operations.
 */

import { getAddress, isAddress, keccak256, parseUnits, formatUnits } from 'ethers';
import {
  gasEstimateForShield,
  populateShield,
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
  getShieldPrivateKeySignatureMessage,
} from '@railgun-community/wallet';
import { 
  NetworkName, 
  EVMGasType,
  getEVMGasTypeForTransaction,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';

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
 * @param {number} chainId
 * @returns {NetworkName}
 */
function getRailgunNetworkName(chainId) {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
}

/**
 * Validate and checksum an Ethereum address
 * @param {string} address
 * @param {string} paramName
 * @returns {string} Checksummed address
 */
function validateAddress(address, paramName) {
  if (!address || typeof address !== 'string') {
    throw new Error(`${paramName} must be a valid address string`);
  }
  if (!isAddress(address)) {
    throw new Error(`Invalid ${paramName}: ${address}`);
  }
  return getAddress(address);
}

/**
 * Create an ERC20AmountRecipient object
 * @param {string|undefined} tokenAddress - Token address (undefined for native token)
 * @param {string} amount - Amount as a string
 * @param {string} recipientAddress - Recipient address
 * @returns {Object} ERC20AmountRecipient
 */
function createERC20AmountRecipient(tokenAddress, amount, recipientAddress) {
  // Validate amount
  if (!amount || typeof amount !== 'string') {
    throw new Error('Amount must be a non-empty string');
  }

  // Validate recipient address
  if (!recipientAddress || typeof recipientAddress !== 'string') {
    throw new Error('Recipient address must be a non-empty string');
  }

  // Process token address
  let processedTokenAddress;
  if (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') {
    // Native token - should be undefined
    processedTokenAddress = undefined;
  } else if (tokenAddress) {
    // ERC20 token - validate and checksum
    processedTokenAddress = validateAddress(tokenAddress, 'tokenAddress');
  } else {
    // tokenAddress is already undefined
    processedTokenAddress = undefined;
  }

  return {
    tokenAddress: processedTokenAddress,
    amount: amount,
    recipientAddress: recipientAddress,
  };
}

/**
 * Generate a deterministic shield private key
 * Note: In production, this should be replaced with proper signature from wallet
 * @param {string} railgunWalletID
 * @param {string} fromAddress
 * @param {Object} recipient
 * @returns {string} Shield private key
 */
function generateShieldPrivateKey(railgunWalletID, fromAddress, recipient) {
  // In production, use getShieldPrivateKeySignatureMessage() and have user sign it
  // For now, generate deterministic key
  const seed = `${railgunWalletID}-${fromAddress}-${JSON.stringify(recipient)}`;
  const encoder = new TextEncoder();
  const seedBytes = encoder.encode(seed);
  return keccak256(seedBytes);
}

/**
 * Shield ERC20 tokens into Railgun (Public → Private)
 * 
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string|null} tokenAddress - Token address (null for native token)
 * @param {string} amount - Amount to shield (in token units as string)
 * @param {Object} chain - Chain configuration with id property
 * @param {string} fromAddress - EOA address sending the tokens
 * @param {string} railgunAddress - Railgun address to shield to
 * @returns {Object} Transaction result with gasEstimate and transaction
 */
export async function shieldTokens(
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  fromAddress,
  railgunAddress
) {
  try {
    // Validate inputs
    if (!railgunWalletID || typeof railgunWalletID !== 'string') {
      throw new Error('railgunWalletID must be a non-empty string');
    }

    if (!encryptionKey || typeof encryptionKey !== 'string') {
      throw new Error('encryptionKey must be a non-empty string');
    }

    if (!amount || typeof amount !== 'string') {
      throw new Error('amount must be a non-empty string');
    }

    if (!chain || !chain.id) {
      throw new Error('chain must have an id property');
    }

    if (!railgunAddress || !railgunAddress.startsWith('0zk')) {
      throw new Error('railgunAddress must be a valid Railgun address (starts with 0zk)');
    }

    // Validate fromAddress
    fromAddress = validateAddress(fromAddress, 'fromAddress');

    // Wait for Railgun to be ready
    await waitForRailgunReady();

    // Get network name
    const networkName = getRailgunNetworkName(chain.id);

    // Create recipient
    const erc20AmountRecipient = createERC20AmountRecipient(
      tokenAddress,
      amount,
      railgunAddress
    );

    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for shield

    // Step 1: Generate shield private key
    const shieldPrivateKey = generateShieldPrivateKey(
      railgunWalletID,
      fromAddress,
      erc20AmountRecipient
    );

    // Step 2: Gas estimation
    const sendWithPublicWallet = true; // Always true for shield
    const relayerFeeERC20AmountRecipient = undefined; // No relayer fee for self-relay
    const overallBatchMinGasPrice = undefined; // Optional

    const gasEstimate = await gasEstimateForShield(
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      relayerFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice
    );

    // Step 3: Create transaction gas details
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    let transactionGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        transactionGasDetails = {
          evmGasType,
          gasEstimate: gasEstimate.gasEstimate,
          gasPrice: BigInt(20000000000), // 20 gwei default
        };
        break;
      case EVMGasType.Type2:
        transactionGasDetails = {
          evmGasType,
          gasEstimate: gasEstimate.gasEstimate,
          maxFeePerGas: BigInt(25000000000), // 25 gwei
          maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
        };
        break;
    }

    // Step 4: Populate shield transaction
    const populatedTransaction = await populateShield(
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      relayerFeeERC20AmountRecipient,
      sendWithPublicWallet,
      transactionGasDetails
    );

    return {
      gasEstimate: gasEstimate,
      transaction: populatedTransaction.transaction,
      shieldPrivateKey: shieldPrivateKey,
    };

  } catch (error) {
    console.error('[shieldTokens] Error:', error);
    throw error;
  }
}

/**
 * Unshield tokens from Railgun (Private → Public)
 * 
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string|null} tokenAddress - Token address (null for native token)
 * @param {string} amount - Amount to unshield (in token units as string)
 * @param {Object} chain - Chain configuration with id property
 * @param {string} toAddress - EOA address receiving the tokens
 * @returns {Object} Transaction result
 */
export async function unshieldTokens(
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  toAddress
) {
  try {
    // Validate inputs
    if (!railgunWalletID || typeof railgunWalletID !== 'string') {
      throw new Error('railgunWalletID must be a non-empty string');
    }

    if (!encryptionKey || typeof encryptionKey !== 'string') {
      throw new Error('encryptionKey must be a non-empty string');
    }

    if (!amount || typeof amount !== 'string') {
      throw new Error('amount must be a non-empty string');
    }

    if (!chain || !chain.id) {
      throw new Error('chain must have an id property');
    }

    // Validate toAddress
    toAddress = validateAddress(toAddress, 'toAddress');

    // Wait for Railgun to be ready
    await waitForRailgunReady();

    // Get network name
    const networkName = getRailgunNetworkName(chain.id);

    // Create recipient
    const erc20AmountRecipient = createERC20AmountRecipient(
      tokenAddress,
      amount,
      toAddress
    );

    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for unshield

    // Step 1: Gas estimation
    const gasEstimate = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    // Step 2: Generate unshield proof
    const proofResult = await generateUnshieldProof(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    // Step 3: Populate proved unshield transaction
    const populatedTransaction = await populateProvedUnshield(
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    return {
      gasEstimate: gasEstimate,
      transaction: populatedTransaction.transaction,
      proofResult: proofResult,
    };

  } catch (error) {
    console.error('[unshieldTokens] Error:', error);
    throw error;
  }
}

/**
 * Parse token amount to base units
 * @param {string} amount - Human readable amount
 * @param {number} decimals - Token decimals (default 18)
 * @returns {string} Amount in base units
 */
export function parseTokenAmount(amount, decimals = 18) {
  try {
    if (!amount || amount === '0' || amount === '') {
      return '0';
    }
    
    const result = parseUnits(amount.toString(), decimals);
    return result.toString();
  } catch (error) {
    console.error('[parseTokenAmount] Error:', error);
    throw new Error(`Invalid amount: ${amount}`);
  }
}

/**
 * Format token amount from base units
 * @param {string} amount - Amount in base units
 * @param {number} decimals - Token decimals (default 18)
 * @returns {string} Human readable amount
 */
export function formatTokenAmount(amount, decimals = 18) {
  try {
    if (!amount || amount === '0') {
      return '0';
    }
    
    return formatUnits(amount, decimals);
  } catch (error) {
    console.error('[formatTokenAmount] Error:', error);
    return '0';
  }
}

// Export all functions
export default {
  shieldTokens,
  unshieldTokens,
  parseTokenAmount,
  formatTokenAmount,
}; 