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
import { keccak256, Wallet } from 'ethers';

/**
 * Shield ERC-20 tokens
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
 * Unshield ERC-20 tokens
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