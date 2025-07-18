/**
 * RAILGUN Shield and Unshield Actions
 * Following official docs exactly:
 * - Shield: https://docs.railgun.org/developer-guide/wallet/transactions/shielding/shield-erc-20-tokens
 * - Unshield: https://docs.railgun.org/developer-guide/wallet/transactions/unshielding/unshield-erc-20-tokens
 */

import {
  NetworkName,
  TransactionGasDetails,
  RailgunERC20AmountRecipient,
  EVMGasType,
  getEVMGasTypeForTransaction,
  FeeTokenDetails,
  SelectedRelayer,
  calculateGasPrice,
} from '@railgun-community/shared-models';
import {
  gasEstimateForShield,
  populateShield,
  getShieldPrivateKeySignatureMessage,
  gasEstimateForUnprovenUnshield,
  generateUnshieldProof,
  populateProvedUnshield,
} from '@railgun-community/wallet';
import { keccak256, Wallet, isAddress } from 'ethers';
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
 */
function getRailgunNetworkName(chainId) {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
}

/**
 * Shield ERC-20 tokens (CORE FUNCTION - EXACT FROM DOCS)
 * Following: https://docs.railgun.org/developer-guide/wallet/transactions/shielding/shield-erc-20-tokens
 */
export async function shieldERC20(
  networkName,
  privateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress
) {
  // Generate shield private key
  const wallet = new Wallet(privateKey);
  const shieldSignatureMessage = getShieldPrivateKeySignatureMessage();
  const shieldPrivateKey = keccak256(
    await wallet.signMessage(shieldSignatureMessage),
  );

  // Gas estimate
  const { gasEstimate } = await gasEstimateForShield(
    networkName,
    shieldPrivateKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    fromWalletAddress,
  );

  // Transaction gas details
  const sendWithPublicWallet = true; // Always true for Shield transactions
  const evmGasType = getEVMGasTypeForTransaction(
    networkName,
    sendWithPublicWallet
  );

  let gasDetails;
  switch (evmGasType) {
    case EVMGasType.Type0:
    case EVMGasType.Type1:
      gasDetails = {
        evmGasType,
        gasEstimate,
        gasPrice: BigInt('0x100000'), // Proper calculation of network gasPrice is not covered in this guide
      };
      break;
    case EVMGasType.Type2:
      // Proper calculation of gas Max Fee and gas Max Priority Fee is not covered in this guide
      const maxFeePerGas = BigInt('0x100000');
      const maxPriorityFeePerGas = BigInt('0x010000');

      gasDetails = {
        evmGasType,
        gasEstimate,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
      break;
  }

  // Populate shield transaction
  const { transaction } = await populateShield(
    networkName,
    shieldPrivateKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    gasDetails,
  );

  // Public wallet to shield from
  transaction.from = fromWalletAddress;

  return {
    transaction,
    shieldPrivateKey,
    gasEstimate,
  };
}

/**
 * Unshield ERC-20 tokens (CORE FUNCTION - EXACT FROM DOCS)
 * Following: https://docs.railgun.org/developer-guide/wallet/transactions/unshielding/unshield-erc-20-tokens
 */
export async function unshieldERC20(
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  sendWithPublicWallet,
  selectedRelayer,
  selectedTokenFeeAddress,
  progressCallback
) {
  // Gas estimation setup
  const evmGasType = getEVMGasTypeForTransaction(
    networkName,
    sendWithPublicWallet
  );
  const originalGasEstimate = 0n; // Always 0, we don't have this yet

  let originalGasDetails;
  switch (evmGasType) {
    case EVMGasType.Type0:
    case EVMGasType.Type1:
      originalGasDetails = {
        evmGasType,
        originalGasEstimate,
        gasPrice: BigInt('0x100000'), // Proper calculation of network gasPrice is not covered in this guide
      };
      break;
    case EVMGasType.Type2:
      // Proper calculation of gas Max Fee and gas Max Priority Fee is not covered in this guide
      const maxFeePerGas = BigInt('0x100000');
      const maxPriorityFeePerGas = BigInt('0x010000');

      originalGasDetails = {
        evmGasType,
        originalGasEstimate,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
      break;
  }

  // Token Fee for selected Relayer (if using relayer)
  const feeTokenDetails = sendWithPublicWallet ? undefined : {
    tokenAddress: selectedTokenFeeAddress,
    feePerUnitGas: selectedRelayer.feePerUnitGas,
  };

  // Gas estimate
  const { gasEstimate } = await gasEstimateForUnprovenUnshield(
    networkName,
    railgunWalletID,
    encryptionKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    originalGasDetails,
    feeTokenDetails,
    sendWithPublicWallet,
  );

  const transactionGasDetails = {
    evmGasType,
    gasEstimate,
    gasPrice: originalGasDetails.gasPrice,
  };

  // Generate proof
  const relayerFeeERC20AmountRecipient = sendWithPublicWallet ? undefined : {
    tokenAddress: selectedTokenFeeAddress,
    // NOTE: Proper calculation of "amount" is based on transactionGasDetails and selectedRelayer
    amount: BigInt('0x10000000'), // See "Relayers" > "Calculating the Relayer Fee" for more info
    recipientAddress: selectedRelayer.railgunAddress,
  };

  // ONLY required for transactions that are using a Relayer
  const overallBatchMinGasPrice = sendWithPublicWallet ? undefined : await calculateGasPrice(transactionGasDetails);

  await generateUnshieldProof(
    networkName,
    railgunWalletID,
    encryptionKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    relayerFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    progressCallback,
  );

  // Populate transaction
  const populateResponse = await populateProvedUnshield(
    networkName,
    railgunWalletID,
    erc20AmountRecipients,
    nftAmountRecipients,
    relayerFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    transactionGasDetails,
  );

  return {
    populateResponse,
    gasEstimate,
    transactionGasDetails,
  };
}

// ============================================
// COMPATIBILITY LAYER FOR EXISTING COMPONENTS
// ============================================

/**
 * Shield tokens - wrapper for compatibility with existing components
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
  await waitForRailgunReady();
  
  const networkName = getRailgunNetworkName(chain.id);
  
  // Create ERC20 amount recipient
  const erc20AmountRecipients = [{
    tokenAddress: tokenAddress === null ? undefined : tokenAddress,
    amount: BigInt(amount),
    recipientAddress: railgunAddress,
  }];
  
  // Generate private key from wallet provider
  const message = getShieldPrivateKeySignatureMessage();
  const signature = await walletProvider.request({
    method: 'personal_sign',
    params: [message, fromAddress],
  });
  const privateKeyHash = keccak256(signature);
  
  // Create a temporary wallet with the derived key for signing
  // Note: This is a workaround since docs expect a Wallet instance
  const tempWallet = new Wallet(privateKeyHash);
  
  return await shieldERC20(
    networkName,
    tempWallet.privateKey,
    erc20AmountRecipients,
    [], // nftAmountRecipients
    fromAddress
  );
}

/**
 * Unshield tokens - wrapper for compatibility with existing components
 */
export async function unshieldTokens(
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  toAddress
) {
  await waitForRailgunReady();
  
  const networkName = getRailgunNetworkName(chain.id);
  
  // Create ERC20 amount recipient
  const erc20AmountRecipients = [{
    tokenAddress: tokenAddress === null ? undefined : tokenAddress,
    amount: BigInt(amount),
    recipientAddress: toAddress,
  }];
  
  const sendWithPublicWallet = true; // Always true for direct unshield
  
  const result = await unshieldERC20(
    networkName,
    railgunWalletID,
    encryptionKey,
    erc20AmountRecipients,
    [], // nftAmountRecipients
    sendWithPublicWallet,
    null, // selectedRelayer
    null, // selectedTokenFeeAddress
    null  // progressCallback
  );
  
  return {
    transaction: result.populateResponse.transaction,
    gasEstimate: result.gasEstimate,
  };
}

/**
 * Validate Railgun address format
 */
export function isValidRailgunAddress(address) {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return address.startsWith('0zk') && address.length >= 100;
}

/**
 * Check if a token is supported by Railgun
 */
export function isTokenSupportedByRailgun(tokenAddress, chainId) {
  try {
    const supportedChains = Object.keys(RAILGUN_NETWORK_NAMES).map(Number);
    if (!supportedChains.includes(chainId)) {
      return false;
    }
    
    // Native tokens are always supported
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      return true;
    }
    
    // ERC20 tokens need valid address format
    return isAddress(tokenAddress);
  } catch (error) {
    return false;
  }
}

/**
 * Get supported network IDs
 */
export function getSupportedChainIds() {
  return Object.keys(RAILGUN_NETWORK_NAMES).map(Number);
}

// Re-export utility functions from balances
export { parseTokenAmount, formatTokenAmount } from './balances.js'; 