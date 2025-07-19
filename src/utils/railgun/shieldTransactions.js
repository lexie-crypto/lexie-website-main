/**
 * RAILGUN Shield Transactions - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-shield.ts
 * Converted to JavaScript with custom enhancements for Lexie Wallet
 */

import { getAddress, isAddress, keccak256 } from 'ethers';
import {
  gasEstimateForShield,
  populateShield,
  getShieldPrivateKeySignatureMessage,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  getEVMGasTypeForTransaction,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { createShieldGasDetails } from './tx-gas-details.js';
import { estimateGasWithBroadcasterFee } from './tx-gas-broadcaster-fee-estimator.js';

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
 */
const getRailgunNetworkName = (chainId) => {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Validate and checksum an Ethereum address
 */
const validateAddress = (address, paramName) => {
  if (!address || typeof address !== 'string') {
    throw new Error(`${paramName} must be a valid address string`);
  }
  if (!isAddress(address)) {
    throw new Error(`Invalid ${paramName}: ${address}`);
  }
  return getAddress(address);
};

/**
 * Generate shield private key from wallet signature
 * This is the key custom functionality to keep from the original implementation
 */
const generateShieldPrivateKey = async (fromAddress, walletProvider) => {
  try {
    if (!walletProvider) {
      throw new Error('Wallet provider required for shield private key generation');
    }

    console.log('[ShieldTransactions] Requesting shield signature from wallet...');
    
    const message = getShieldPrivateKeySignatureMessage();
    const signature = await walletProvider.request({
      method: 'personal_sign',
      params: [message, fromAddress],
    });

    console.log('[ShieldTransactions] Shield signature received');
    return keccak256(signature);
  } catch (error) {
    console.error('[ShieldTransactions] Failed to generate shield private key:', error);
    if (error.code === 4001 || error.message.includes('rejected')) {
      throw new Error('Shield signature required. Please approve the signature request.');
    }
    throw new Error(`Failed to generate shield private key: ${error.message}`);
  }
};

/**
 * Create ERC20AmountRecipient object - simplified from original
 */
const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  // Process token address (null/zero address becomes undefined for native tokens)
  let processedTokenAddress;
  if (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') {
    processedTokenAddress = undefined; // Native token
  } else if (tokenAddress) {
    processedTokenAddress = validateAddress(tokenAddress, 'tokenAddress');
  } else {
    processedTokenAddress = undefined;
  }

  return {
    tokenAddress: processedTokenAddress,
    amount: BigInt(amount),
    recipientAddress: recipientAddress,
  };
};

/**
 * Enhanced gas estimation with broadcaster fee support
 */
const estimateShieldGasWithFees = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress,
  selectedBroadcaster = null
) => {
  // Create the gas estimation function
  const gasEstimateFunction = async (...params) => {
    return await gasEstimateForShield(...params);
  };

  // Prepare gas estimation parameters
  const gasEstimateParams = [
    txidVersion,
    networkName,
    shieldPrivateKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    fromWalletAddress,
  ];

  // Use comprehensive gas estimation with broadcaster fee support
  return await estimateGasWithBroadcasterFee(
    networkName,
    gasEstimateFunction,
    gasEstimateParams,
    selectedBroadcaster,
    'shield'
  );
};

/**
 * Comprehensive gas estimation for shield transaction with broadcaster fee support
 */
export const estimateShieldGas = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress,
  selectedBroadcaster = null
) => {
  try {
    return await estimateShieldGasWithFees(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromWalletAddress,
      selectedBroadcaster
    );
  } catch (error) {
    throw new Error(`Shield gas estimation failed: ${error.message}`);
  }
};

/**
 * Populate shield transaction - Official SDK pattern
 */
export const createShieldTransaction = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  gasDetails
) => {
  try {
    const result = await populateShield(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      gasDetails
    );

    return {
      transaction: result.transaction,
      preTransactionPOIsPerTxidLeafPerList: result.preTransactionPOIsPerTxidLeafPerList || {},
    };
  } catch (error) {
    throw new Error(`Shield transaction creation failed: ${error.message}`);
  }
};

/**
 * Complete shield operation - Clean, focused API
 */
export const shieldTokens = async ({
  tokenAddress,
  amount,
  chain,
  fromAddress,
  railgunAddress,
  walletProvider
}) => {
  try {
    // Basic validation
    if (!amount || typeof amount !== 'string') {
      throw new Error('Amount must be a non-empty string');
    }
    if (!chain?.id) {
      throw new Error('Chain must have an id property');
    }
    if (!railgunAddress?.startsWith('0zk')) {
      throw new Error('Invalid Railgun address');
    }

    // Validate addresses
    fromAddress = validateAddress(fromAddress, 'fromAddress');

    // Wait for Railgun readiness
    await waitForRailgunReady();

    // Get network configuration
    const networkName = getRailgunNetworkName(chain.id);
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    console.log('[ShieldTransactions] Starting shield operation:', {
      tokenAddress,
      amount,
      networkName,
      fromAddress: `${fromAddress.slice(0, 8)}...`,
      railgunAddress: `${railgunAddress.slice(0, 10)}...`,
    });

    // Generate shield private key
    const shieldPrivateKey = await generateShieldPrivateKey(fromAddress, walletProvider);

    // Create recipients
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, railgunAddress);
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for ERC20 shield

    // Enhanced gas estimation with broadcaster fee support
    console.log('[ShieldTransactions] Estimating gas with comprehensive fee calculation...');
    const gasEstimationResult = await estimateShieldGasWithFees(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromAddress,
      null // No broadcaster for shield transactions (always public wallet)
    );

    const { gasDetails, broadcasterFeeInfo, iterations } = gasEstimationResult;
    
    console.log('[ShieldTransactions] Gas estimation completed:', {
      gasEstimate: gasDetails.gasEstimate.toString(),
      evmGasType: gasDetails.evmGasType,
      iterations,
      hasBroadcasterFee: !!broadcasterFeeInfo,
    });

    // Create transaction
    console.log('[ShieldTransactions] Creating transaction...');
    const { transaction } = await createShieldTransaction(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      gasDetails
    );

    // Set from address
    transaction.from = fromAddress;

    console.log('[ShieldTransactions] Shield operation completed successfully');
    return {
      gasEstimate: gasDetails.gasEstimate,
      gasDetails,
      transaction,
      shieldPrivateKey,
      broadcasterFeeInfo,
      gasEstimationIterations: iterations,
    };

  } catch (error) {
    console.error('[ShieldTransactions] Shield operation failed:', error);
    throw new Error(`Shield operation failed: ${error.message}`);
  }
};

export default {
  shieldTokens,
  estimateShieldGas,
  createShieldTransaction,
}; 