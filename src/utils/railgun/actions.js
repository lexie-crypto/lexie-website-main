/**
 * RAILGUN Shield and Unshield Actions
 * Following official docs:
 * - Shield: https://docs.railgun.org/developer-guide/wallet/transactions/shielding/shield-erc-20-tokens
 * - Unshield: https://docs.railgun.org/developer-guide/wallet/transactions/unshielding/unshield-erc-20-tokens
 * 
 * Implements only shield and unshield operations - no transfers or batch logic
 */

import { getAddress, isAddress, keccak256 } from 'ethers';
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
  RailgunERC20AmountRecipient,
  TransactionGasDetails,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { parseTokenAmount, formatTokenAmount } from './balances.js';

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
 * @returns {RailgunERC20AmountRecipient} ERC20AmountRecipient object
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

  // Convert amount string to BigInt as expected by RAILGUN SDK
  const amountBigInt = BigInt(amount);

  return {
    tokenAddress: processedTokenAddress,
    amount: amountBigInt,
    recipientAddress: recipientAddress,
  };
}

/**
 * Generate shield private key from wallet signature - PRODUCTION READY
 * @param {string} railgunWalletID
 * @param {string} fromAddress
 * @param {Object} recipient
 * @param {Object} walletProvider - Wallet provider for signing
 * @returns {Promise<string>} Shield private key
 */
async function generateShieldPrivateKey(railgunWalletID, fromAddress, recipient, walletProvider) {
  try {
    if (!walletProvider) {
      throw new Error('Wallet provider required for shield private key generation');
    }

    // Get the official message that should be signed
    const shieldSignatureMessage = getShieldPrivateKeySignatureMessage();
    
    // Create a more descriptive message for the user
    const userMessage = `Lexie Shield Operation\n\nAuthorize shield transaction to move tokens into privacy.\n\nFrom: ${fromAddress}\nTo: ${recipient.recipientAddress}\nAmount: ${recipient.amount}\n\nOfficial Shield Message:\n${shieldSignatureMessage}`;
    
    console.log('[RailgunActions] Requesting shield signature from wallet...');
    
    // Request signature from user's wallet
    const signature = await walletProvider.request({
      method: 'personal_sign',
      params: [userMessage, fromAddress],
    });

    console.log('[RailgunActions] Shield signature received');
    
    // Generate shield private key from the signature
    return keccak256(signature);
  } catch (error) {
    console.error('[RailgunActions] Failed to generate shield private key:', error);
    if (error.code === 4001 || error.message.includes('rejected')) {
      throw new Error('Shield signature required. Please approve the signature request to proceed.');
    }
    throw new Error(`Failed to generate shield private key: ${error.message}`);
  }
}

/**
 * Create transaction gas details from gas estimate
 * @param {NetworkName} networkName - Network name
 * @param {boolean} sendWithPublicWallet - Whether sending with public wallet
 * @param {Object} gasEstimate - Gas estimate result
 * @returns {TransactionGasDetails} Transaction gas details
 */
function createTransactionGasDetails(networkName, sendWithPublicWallet, gasEstimate) {
  const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
  
  switch (evmGasType) {
    case EVMGasType.Type0:
    case EVMGasType.Type1:
      return {
        evmGasType,
        gasEstimate: gasEstimate.gasEstimate || gasEstimate,
        gasPrice: BigInt(20000000000), // 20 gwei default
      };
    case EVMGasType.Type2:
      return {
        evmGasType,
        gasEstimate: gasEstimate.gasEstimate || gasEstimate,
        maxFeePerGas: BigInt(25000000000), // 25 gwei
        maxPriorityFeePerGas: BigInt(2000000000), // 2 gwei
      };
    default:
      throw new Error(`Unsupported gas type: ${evmGasType}`);
  }
}

/**
 * Shield ERC20 tokens into Railgun (Public → Private)
 * Following: https://docs.railgun.org/developer-guide/wallet/transactions/shielding/shield-erc-20-tokens
 * 
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {string} encryptionKey - Wallet encryption key
 * @param {string|null} tokenAddress - Token address (null for native token)
 * @param {string} amount - Amount to shield (in token units as string)
 * @param {Object} chain - Chain configuration with id property
 * @param {string} fromAddress - EOA address sending the tokens
 * @param {string} railgunAddress - Railgun address to shield to
 * @param {Object} walletProvider - Wallet provider for signing
 * @returns {Object} Transaction result with gasEstimate and transaction
 */
export async function shieldTokens(
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  fromAddress,
  railgunAddress,
  walletProvider
) {
  try {
    console.log('[RailgunActions] Starting shield operation:', {
      tokenAddress,
      amount,
      chainId: chain.id,
      fromAddress: fromAddress?.slice(0, 8) + '...',
      railgunAddress: railgunAddress?.slice(0, 10) + '...',
    });

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

    if (!walletProvider) {
      throw new Error('walletProvider is required for shield operations');
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

    // Step 1: Generate shield private key from wallet signature
    const shieldPrivateKey = await generateShieldPrivateKey(
      railgunWalletID,
      fromAddress,
      erc20AmountRecipient,
      walletProvider
    );

    // Step 2: Gas estimation
    const sendWithPublicWallet = true; // Always true for shield
    const relayerFeeERC20AmountRecipient = undefined; // No relayer fee for self-relay
    const overallBatchMinGasPrice = undefined; // Optional

    console.log('[RailgunActions] Estimating gas for shield...');
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
    const transactionGasDetails = createTransactionGasDetails(
      networkName,
      sendWithPublicWallet,
      gasEstimate
    );

    // Step 4: Populate shield transaction
    console.log('[RailgunActions] Populating shield transaction...');
    const populatedTransaction = await populateShield(
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      relayerFeeERC20AmountRecipient,
      sendWithPublicWallet,
      transactionGasDetails
    );

    console.log('[RailgunActions] Shield operation completed successfully');
    return {
      gasEstimate: gasEstimate,
      transaction: populatedTransaction.transaction,
      shieldPrivateKey: shieldPrivateKey,
    };

  } catch (error) {
    console.error('[RailgunActions] Shield operation failed:', error);
    throw new Error(`Shield operation failed: ${error.message}`);
  }
}

/**
 * Unshield tokens from Railgun (Private → Public)
 * Following: https://docs.railgun.org/developer-guide/wallet/transactions/unshielding/unshield-erc-20-tokens
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
    console.log('[RailgunActions] Starting unshield operation:', {
      tokenAddress,
      amount,
      chainId: chain.id,
      toAddress: toAddress?.slice(0, 8) + '...',
    });

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
    console.log('[RailgunActions] Estimating gas for unshield...');
    const gasEstimate = await gasEstimateForUnprovenUnshield(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    // Step 2: Generate unshield proof
    console.log('[RailgunActions] Generating unshield proof...');
    const proofResult = await generateUnshieldProof(
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    // Step 3: Populate proved unshield transaction
    console.log('[RailgunActions] Populating unshield transaction...');
    const populatedTransaction = await populateProvedUnshield(
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients
    );

    console.log('[RailgunActions] Unshield operation completed successfully');
    return {
      gasEstimate: gasEstimate,
      transaction: populatedTransaction.transaction,
      proofResult: proofResult,
    };

  } catch (error) {
    console.error('[RailgunActions] Unshield operation failed:', error);
    throw new Error(`Unshield operation failed: ${error.message}`);
  }
}

/**
 * Validate Railgun address format
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid Railgun address
 */
export function isValidRailgunAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  // Railgun addresses start with 0zk and have specific length
  return address.startsWith('0zk') && address.length >= 100; // Approximate length check
}

/**
 * Check if a token is supported by Railgun
 * @param {string} tokenAddress - Token contract address
 * @param {number} chainId - Chain ID
 * @returns {boolean} True if supported
 */
export function isTokenSupportedByRailgun(tokenAddress, chainId) {
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

    // ERC20 tokens need valid address format
    return isAddress(tokenAddress);
  } catch (error) {
    console.error('[RailgunActions] Error checking token support:', error);
    return false;
  }
}

/**
 * Get supported network IDs
 * @returns {number[]} Array of supported chain IDs
 */
export function getSupportedChainIds() {
  return Object.keys(RAILGUN_NETWORK_NAMES).map(Number);
}

/**
 * Get network name for display
 * @param {number} chainId - Chain ID
 * @returns {string} Network display name
 */
export function getNetworkDisplayName(chainId) {
  const networkNames = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNB Smart Chain',
  };
  
  return networkNames[chainId] || `Chain ${chainId}`;
}

// Export all functions
export default {
  shieldTokens,
  unshieldTokens,
  isValidRailgunAddress,
  isTokenSupportedByRailgun,
  getSupportedChainIds,
  getNetworkDisplayName,
  parseTokenAmount,
  formatTokenAmount,
};

// Re-export utility functions for convenience
export { parseTokenAmount, formatTokenAmount } from './balances.js'; 