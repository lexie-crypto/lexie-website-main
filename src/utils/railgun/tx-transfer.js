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
import { shouldUseRelayer, checkRelayerHealth, submitRelayedTransaction, estimateRelayerFee } from './relayer-client.js';

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

  // 4) Attempt relayed submission to hide EOA
  try {
    // Robustly resolve chainId from NETWORK_CONFIG using the enum key
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const netCfg = NETWORK_CONFIG?.[networkName];
    if (!netCfg || !netCfg.chain || typeof netCfg.chain.id !== 'number') {
      throw new Error(`Invalid network config for ${String(networkName)}`);
    }
    const chainId = netCfg.chain.id;
    const tokenAddress = erc20AmountRecipients[0]?.tokenAddress;
    const amount = erc20AmountRecipients[0]?.amount?.toString?.() || String(erc20AmountRecipients[0]?.amount);

    if (shouldUseRelayer(chainId, amount) && (await checkRelayerHealth())) {
      // Serialize transaction for relayer
      const txObj = {
        to: transaction.to,
        data: transaction.data,
        value: transaction.value?.toString?.() || transaction.value || '0x0',
        gasLimit: transaction.gasLimit ? transaction.gasLimit.toString() : undefined,
        gasPrice: transaction.gasPrice ? transaction.gasPrice.toString() : undefined,
        maxFeePerGas: transaction.maxFeePerGas ? transaction.maxFeePerGas.toString() : undefined,
        maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? transaction.maxPriorityFeePerGas.toString() : undefined,
        type: transaction.type,
      };
      Object.keys(txObj).forEach(k => txObj[k] === undefined && delete txObj[k]);
      const serializedTransaction = '0x' + Buffer.from(JSON.stringify(txObj)).toString('hex');

      // Optional: estimate fee (can be shown in UI later)
      try { await estimateRelayerFee({ chainId, tokenAddress, amount, gasEstimate: transactionGasDetails.gasEstimate }); } catch {}

      const relayed = await submitRelayedTransaction({
        chainId,
        serializedTransaction,
        tokenAddress,
        amount,
        userAddress: null,
        feeDetails: {},
        gasEstimate: transactionGasDetails.gasEstimate?.toString?.(),
      });

      return { transactionHash: relayed.transactionHash, relayed: true };
    }
  } catch (e) {
    // Fallback to self-signing below
    console.warn('[tx-transfer] Relayer submission failed or unavailable, falling back to self-sign:', e?.message);
  }

  // 5) Fallback: self-sign when relayer not available
  if (!walletSigner) throw new Error('Wallet signer required when relayer is unavailable');
  const txResponse = await walletSigner.sendTransaction(transaction);
  return { transactionHash: txResponse.hash, relayed: false };
};

export default {
  estimatePrivateTransferGas,
  generatePrivateTransferProof,
  populatePrivateTransfer,
  buildAndPopulatePrivateTransfer,
};


