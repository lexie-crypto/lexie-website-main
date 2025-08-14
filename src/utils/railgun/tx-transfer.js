/**
 * Private ERC-20 Transfer utilities (mirrors SDK structure)
 * - estimatePrivateTransferGas
 * - generatePrivateTransferProof
 * - populatePrivateTransfer
 * - build and send orchestrator
 */

import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  getEVMGasTypeForTransaction,
  calculateGasPrice,
} from '@railgun-community/shared-models';
import {
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';

const DEFAULT_TXID = TXIDVersion.V2_PoseidonMerkle;

const buildOriginalGasDetails = async (networkName, sendWithPublicWallet, signer = null) => {
  const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
  const originalGasEstimate = 0n;

  if (evmGasType === EVMGasType.Type2) {
    let maxFeePerGas = BigInt('0x100000');
    let maxPriorityFeePerGas = BigInt('0x010000');
    try {
      if (signer?.provider) {
        const fee = await signer.provider.getFeeData();
        if (fee?.maxFeePerGas) maxFeePerGas = fee.maxFeePerGas;
        if (fee?.maxPriorityFeePerGas) maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
      }
    } catch {}
    return { evmGasType, originalGasEstimate, maxFeePerGas, maxPriorityFeePerGas };
  }

  // Type0/Type1
  let gasPrice = BigInt('0x100000');
  try {
    if (signer?.provider) {
      const fee = await signer.provider.getFeeData();
      if (fee?.gasPrice) gasPrice = fee.gasPrice;
    }
  } catch {}
  return { evmGasType, originalGasEstimate, gasPrice };
};

export const estimatePrivateTransferGas = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients = [],
  memoText = undefined,
  sendWithPublicWallet = true,
  feeTokenDetails = undefined,
  walletSigner = null,
}) => {
  await waitForRailgunReady();
  const originalGasDetails = await buildOriginalGasDetails(networkName, sendWithPublicWallet, walletSigner);

  const { gasEstimate } = await gasEstimateForUnprovenTransfer(
    DEFAULT_TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    memoText,
    erc20AmountRecipients,
    nftAmountRecipients,
    originalGasDetails,
    feeTokenDetails,
    sendWithPublicWallet,
  );

  return { originalGasDetails, gasEstimate };
};

export const generatePrivateTransferProof = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  memoText = undefined,
  erc20AmountRecipients,
  nftAmountRecipients = [],
  sendWithPublicWallet = true,
  showSenderAddressToRecipient = true,
  transactionGasDetails,
  feeTokenAmountRecipient = undefined,
}) => {
  const overallBatchMinGasPrice = await calculateGasPrice(transactionGasDetails);

  const progress = (_p) => {};

  await generateTransferProof(
    DEFAULT_TXID,
    networkName,
    railgunWalletID,
    encryptionKey,
    showSenderAddressToRecipient,
    memoText,
    erc20AmountRecipients,
    nftAmountRecipients,
    feeTokenAmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    progress,
  );

  return { overallBatchMinGasPrice };
};

export const populatePrivateTransfer = async ({
  networkName,
  railgunWalletID,
  memoText = undefined,
  erc20AmountRecipients,
  nftAmountRecipients = [],
  sendWithPublicWallet = true,
  showSenderAddressToRecipient = true,
  transactionGasDetails,
  overallBatchMinGasPrice = undefined,
  feeTokenAmountRecipient = undefined,
}) => {
  const { transaction } = await populateProvedTransfer(
    DEFAULT_TXID,
    networkName,
    railgunWalletID,
    showSenderAddressToRecipient,
    memoText,
    erc20AmountRecipients,
    nftAmountRecipients,
    feeTokenAmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    transactionGasDetails,
  );
  return { transaction };
};

export const buildAndPopulatePrivateTransfer = async ({
  networkName,
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients,
  nftAmountRecipients = [],
  memoText = undefined,
  sendWithPublicWallet = true,
  walletSigner = null,
  showSenderAddressToRecipient = true,
}) => {
  // 1) Estimate gas
  const { originalGasDetails, gasEstimate } = await estimatePrivateTransferGas({
    networkName,
    railgunWalletID,
    encryptionKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    memoText,
    sendWithPublicWallet,
    walletSigner,
  });

  const transactionGasDetails = {
    evmGasType: originalGasDetails.evmGasType,
    gasEstimate,
    gasPrice: originalGasDetails.gasPrice,
    maxFeePerGas: originalGasDetails.maxFeePerGas,
    maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
  };

  // 2) Generate proof (memo supported)
  const { overallBatchMinGasPrice } = await generatePrivateTransferProof({
    networkName,
    railgunWalletID,
    encryptionKey,
    memoText,
    erc20AmountRecipients,
    nftAmountRecipients,
    sendWithPublicWallet,
    showSenderAddressToRecipient,
    transactionGasDetails,
  });

  // 3) Populate
  const { transaction } = await populatePrivateTransfer({
    networkName,
    railgunWalletID,
    memoText,
    erc20AmountRecipients,
    nftAmountRecipients,
    sendWithPublicWallet,
    showSenderAddressToRecipient,
    transactionGasDetails,
    overallBatchMinGasPrice,
  });

  return { transaction, transactionGasDetails };
};

export default {
  estimatePrivateTransferGas,
  generatePrivateTransferProof,
  populatePrivateTransfer,
  buildAndPopulatePrivateTransfer,
};


