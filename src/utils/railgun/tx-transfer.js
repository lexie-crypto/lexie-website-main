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
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';
import { shouldUseRelayer, checkRelayerHealth, submitRelayedTransaction, estimateRelayerFee, getRelayerAddress } from './relayer-client.js';

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
  // Determine if we'll use the relayer. If yes, build RelayAdapt cross-contract flow.
  const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
  const chainIdForDecision = NETWORK_CONFIG?.[networkName]?.chain?.id;
  if (typeof chainIdForDecision !== 'number') {
    throw new Error(`Invalid network for relayer decision: ${String(networkName)}`);
  }
  const amountForDecision = String(erc20AmountRecipients?.[0]?.amount?.toString?.() || erc20AmountRecipients?.[0]?.amount || '0');
  const useRelayer = shouldUseRelayer(chainIdForDecision, amountForDecision);

  let transaction;
  let transactionGasDetails;
  if (useRelayer && (await checkRelayerHealth())) {
    // Relayer path: use RelayAdapt cross-contract calls so that `to` is RelayAdapt
    const originalGasDetails = await buildOriginalGasDetails(networkName, false, walletSigner);
    const tokenAddress = erc20AmountRecipients[0].tokenAddress;
    const amountBn = BigInt(erc20AmountRecipients[0].amount?.toString?.() || erc20AmountRecipients[0].amount);
    const recipientRG = erc20AmountRecipients[0].recipientAddress;
    const relayerRailgunAddress = await getRelayerAddress();

    // 0.5% fee paid privately to relayer Railgun address
    const RELAYER_FEE_BPS = 50n;
    const relayerFeeBn = (amountBn * RELAYER_FEE_BPS) / 10000n;
    const netAmount = amountBn - relayerFeeBn;

    // Shield outputs created at RelayAdapt destination
    const relayAdaptShieldERC20Recipients = [
      { tokenAddress, recipientAddress: recipientRG, amount: netAmount },
    ];
    const relayAdaptShieldNFTRecipients = [];
    const relayAdaptUnshieldERC20Amounts = [];
    const relayAdaptUnshieldNFTAmounts = [];

    // Include broadcaster fee recipient
    const broadcasterFeeERC20AmountRecipient = {
      tokenAddress,
      recipientAddress: relayerRailgunAddress,
      amount: relayerFeeBn,
    };

    // Add a harmless cross-contract call (ERC20 transfer of 0 to recipient) so SDK accepts bundle
    const { ethers } = await import('ethers');
    const erc20Interface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
    const zeroTransferData = erc20Interface.encodeFunctionData('transfer', [recipientRG, 0n]);
    const crossContractCalls = [{ to: tokenAddress, data: zeroTransferData, value: 0n }];

    // Gas estimate for cross-contract calls
    const feeTokenDetails = { tokenAddress, feePerUnitGas: BigInt('1000000000') };
    const { gasEstimate } = await gasEstimateForUnprovenCrossContractCalls(
      DEFAULT_TXID,
      networkName,
      railgunWalletID,
      encryptionKey,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls,
      originalGasDetails,
      feeTokenDetails,
      false,
      1200000n,
    );

    transactionGasDetails = {
      evmGasType: originalGasDetails.evmGasType,
      gasEstimate,
      gasPrice: originalGasDetails.gasPrice,
      maxFeePerGas: originalGasDetails.maxFeePerGas,
      maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
    };

    // Proof
    await generateCrossContractCallsProof(
      DEFAULT_TXID,
      networkName,
      railgunWalletID,
      encryptionKey,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls,
      broadcasterFeeERC20AmountRecipient,
      false,
      await calculateGasPrice(transactionGasDetails),
      1200000n,
      () => {}
    );

    // Populate to produce RelayAdapt-targeted tx
    const populated = await populateProvedCrossContractCalls(
      DEFAULT_TXID,
      networkName,
      railgunWalletID,
      relayAdaptUnshieldERC20Amounts,
      relayAdaptUnshieldNFTAmounts,
      relayAdaptShieldERC20Recipients,
      relayAdaptShieldNFTRecipients,
      crossContractCalls,
      broadcasterFeeERC20AmountRecipient,
      false,
      await calculateGasPrice(transactionGasDetails),
      transactionGasDetails,
    );
    transaction = populated.transaction;
  } else {
    // Fallback: classic transfer path (self-signing)
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

    transactionGasDetails = {
      evmGasType: originalGasDetails.evmGasType,
      gasEstimate,
      gasPrice: originalGasDetails.gasPrice,
      maxFeePerGas: originalGasDetails.maxFeePerGas,
      maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
    };

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

    const populated = await populatePrivateTransfer({
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
    transaction = populated.transaction;
  }

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


