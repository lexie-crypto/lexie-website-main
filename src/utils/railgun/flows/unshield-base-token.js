/**
 * Unshield Base Token Flow
 * Handles unshielding of native/base tokens (wETH unwrap) with gas relayer support
 */

import { TXIDVersion, EVMGasType, getEVMGasTypeForTransaction } from '@railgun-community/shared-models';
import { waitForRailgunReady } from '../engine.js';
import { getRailgunNetworkName, refreshWalletBalances } from '../transaction/transaction-prep.js';
import { getSelectedRelayer } from '../relayer-client.js';
import {
  gasEstimateForUnprovenUnshieldBaseToken,
  generateUnshieldBaseTokenProof,
  populateProvedUnshieldBaseToken,
} from '@railgun-community/wallet';
import {
  calculateGasReclamationBaseToken,
  applyGasPriceGuard,
  validateCombinedFee,
  calculateRelayerFee
} from '../fee-calculator.js';
import { submitRelayedTransaction, shouldUseRelayer, checkRelayerHealth } from '../relayer-client.js';
import { submitTransactionSelfSigned } from '../transaction/transaction-submitter.js';

/**
 * Execute base token unshield flow (wETH unwrap)
 * @param {object} params - Flow parameters
 * @returns {object} Transaction result
 */
export const executeBaseTokenUnshield = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  recipientAddress,
  walletProvider,
  walletAddress,
  userAmountGross
}) => {
  console.log('🔧 [UNSHIELD] Base token flow: using SDK unshield base token');

  let selectedRelayer = null;
  let relayerFeeBn = 0n;
  let gasFeeDeducted = 0n;
  let combinedRelayerFee = 0n;

  const useRelayer = shouldUseRelayer(chain.id, amount);
  console.log(`💰 [UNSHIELD] Base token transaction method: ${useRelayer ? 'RelayAdapt Mode (with broadcaster fee)' : 'Self-Signing (Direct)'}`);

  // Use existing function-scope variables for fee calculation
  let adjustedAmount = userAmountGross; // Default to full amount for base tokens
  let wrappedERC20Amount = { tokenAddress, amount: adjustedAmount };

  // Apply combined fee approach for base tokens when using relayer
  if (useRelayer) {
    console.log('🔧 [UNSHIELD] Base token relayer mode: applying combined fee calculation');

    // CRITICAL: Select relayer once, reuse everywhere
    selectedRelayer = await getSelectedRelayer(tokenAddress);
    console.log('🔧 [UNSHIELD] selectedRelayer assigned:', {
      selectedRelayer: selectedRelayer ? 'defined' : 'null',
      address: selectedRelayer?.railgunAddress?.substring(0, 20) + '...'
    });

    if (!selectedRelayer || !selectedRelayer.railgunAddress?.startsWith('0zk')) {
      throw new Error(`Invalid RAILGUN address: ${selectedRelayer?.railgunAddress}. Must start with '0zk'`);
    }
    if (selectedRelayer.railgunAddress.startsWith('0x')) {
      throw new Error(`RAILGUN address cannot start with '0x': ${selectedRelayer.railgunAddress}`);
    }

    console.log('🔍 [UNSHIELD] Selected relayer details:', {
      railgunAddress: selectedRelayer.railgunAddress,
      feeToken: selectedRelayer.feeToken,
      feePerUnitGas: selectedRelayer.feePerUnitGas.toString()
    });

    // Calculate relayer fee from the user's amount
    relayerFeeBn = calculateRelayerFee(userAmountGross);

    // ESTIMATE GAS COST BEFORE PROOF GENERATION (same as ERC-20 relayer mode)
    console.log('🤑 [UNSHIELD] Estimating gas cost for base token reclamation (dummy txn)...');

    // Get network gas prices for estimation
    let networkGasPrices = null;
    try {
      const signer = await walletProvider();
      const provider = signer?.provider;
      if (provider) {
        const feeData = await provider.getFeeData();
        if (feeData?.gasPrice || feeData?.maxFeePerGas) {
          networkGasPrices = feeData;
        }
      }
    } catch (gasPriceError) {
      console.warn('⚠️ [UNSHIELD] Failed to get network gas prices for base token estimation:', gasPriceError.message);
    }

    // Use conservative estimate for dummy txn
    const estimatedGas = BigInt('1000000'); // Conservative 1M gas estimate

    // Get gas price with safety guard
    const rawGasPrice = networkGasPrices?.gasPrice || networkGasPrices?.maxFeePerGas || BigInt('20000000000'); // 20 gwei fallback
    const gasPrice = applyGasPriceGuard(chain.id, rawGasPrice, networkGasPrices);

    const gasCostWei = estimatedGas * gasPrice;

    // For base tokens, gas reclamation is simply the gas cost in wei
    // No USD conversion needed since we're dealing with native tokens
    gasFeeDeducted = calculateGasReclamationBaseToken(gasCostWei);

    // COMBINE FEES FOR BROADCASTER: relayer fee + estimated gas reclamation
    combinedRelayerFee = relayerFeeBn + gasFeeDeducted;

    // PREFLIGHT GUARD: Prevent combined fees from exceeding user amount
    validateCombinedFee(combinedRelayerFee, userAmountGross, 'Base token');

    console.log('🔍 [UNSHIELD] CRITICAL - Base token broadcaster fee updated with combined fee:', {
      relayerFeeBn: relayerFeeBn.toString(),
      gasFeeDeducted: gasFeeDeducted.toString(),
      combinedRelayerFee: combinedRelayerFee.toString(),
      tokenAddress: tokenAddress,
      purpose: 'RAILGUN_BROADCASTER_FEE_VIA_SDK_WITH_GAS_RECLAMATION_BASE_TOKEN'
    });

    // For base tokens, we need to handle the fee differently since we're unshielding the native token
    // The relayer will need to receive the fee in the native token being unshielded
    adjustedAmount = userAmountGross - combinedRelayerFee;

    if (adjustedAmount <= 0n) {
      throw new Error(`Base token amount after fees is too small: ${adjustedAmount.toString()}`);
    }

    console.log('💰 [UNSHIELD] Base token combined fee calculation:', {
      userAmountGross: userAmountGross.toString(),
      relayerFeeBn: relayerFeeBn.toString(),
      gasFeeDeducted: gasFeeDeducted.toString(),
      combinedRelayerFee: combinedRelayerFee.toString(),
      adjustedAmount: adjustedAmount.toString(),
      mode: 'Base token relayer mode with combined fees'
    });

    // Update the wrapped amount to reflect fees
    wrappedERC20Amount = { tokenAddress, amount: adjustedAmount };

  }

  const networkName = getRailgunNetworkName(chain.id);

  // Gas details with network prices and BNB floor
  const evmGasType = getEVMGasTypeForTransaction(networkName, true);
  let originalGasDetails;

  try {
    // Get current network gas prices for base token unshield too
    const signer = await walletProvider();
    const provider = signer?.provider;
    let networkGasPrices = null;

    if (provider) {
      const feeData = await provider.getFeeData();
      networkGasPrices = feeData;
    }

    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        let gasPrice = networkGasPrices?.gasPrice || BigInt('0x100000');
        // No special floor for BNB - treat like other L2s
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n,
          gasPrice,
        };
        break;
      case EVMGasType.Type2:
        let maxFeePerGas = networkGasPrices?.maxFeePerGas || BigInt('0x100000');
        let maxPriorityFeePerGas = networkGasPrices?.maxPriorityFeePerGas || BigInt('0x010000');
        // No special floor for BNB - treat like other L2s
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n,
          maxFeePerGas,
          maxPriorityFeePerGas,
        };
        break;
      default:
        throw new Error(`Unsupported EVM gas type`);
    }

    console.log('💰 [UNSHIELD] Base-token gas details with network prices:', {
      evmGasType,
      gasPrice: originalGasDetails.gasPrice?.toString(),
      maxFeePerGas: originalGasDetails.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas?.toString(),
      chainId: chain.id
    });

  } catch (gasError) {
    console.warn('⚠️ [UNSHIELD] Failed to get network gas prices for base token, using fallbacks:', gasError.message);

    // Fallback with BNB floor
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n,
          gasPrice: BigInt('0x100000'),
        };
        break;
      case EVMGasType.Type2:
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n,
          maxFeePerGas: BigInt('0x100000'),
          maxPriorityFeePerGas: BigInt('0x010000'),
        };
        break;
      default:
        throw new Error(`Unsupported EVM gas type`);
    }
  }

  // Estimate (dummy tx via SDK) and add a small 20% buffer for headroom
  const { gasEstimate: baseTokenGasEstimate } = await gasEstimateForUnprovenUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    networkName,
    recipientAddress,
    railgunWalletID,
    encryptionKey,
    wrappedERC20Amount,
    originalGasDetails,
    null,
    true,
  );

  const paddedBaseTokenGasEstimate = (baseTokenGasEstimate * 120n) / 100n;
  console.log('✅ [UNSHIELD] Base-token gas estimate (padded 20%):', {
    base: baseTokenGasEstimate.toString(),
    padded: paddedBaseTokenGasEstimate.toString()
  });

  // Proof
  await generateUnshieldBaseTokenProof(
    TXIDVersion.V2_PoseidonMerkle,
    networkName,
    recipientAddress,
    railgunWalletID,
    encryptionKey,
    wrappedERC20Amount,
    undefined,
    true,
    undefined,
    (p) => console.log(`[UNSHIELD] Base token proof progress: ${(p * 100).toFixed(1)}%`),
  );

  // Gas details for populate - use same network prices as originalGasDetails
  let gasDetails = {
    evmGasType,
    gasEstimate: paddedBaseTokenGasEstimate,
    gasPrice: originalGasDetails.gasPrice,
    maxFeePerGas: originalGasDetails.maxFeePerGas,
    maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
  };

  const populateResponse = await populateProvedUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    networkName,
    recipientAddress,
    railgunWalletID,
    wrappedERC20Amount,
    undefined,
    true,
    undefined,
    gasDetails,
  );

  // Submit transaction based on mode
  let transactionHash;
  let usedRelayer = false;
  let privacyLevel = 'self-signed';

  if (useRelayer) {
    console.log('🚀 [GAS RELAYER] Attempting base token submission via transparent gas relayer...');

    try {
      // Check relayer health
      const relayerHealthy = await checkRelayerHealth();
      if (!relayerHealthy) {
        throw new Error('Gas relayer service is not available');
      }

      // Get the transaction from RAILGUN
      const contractTransaction = populateResponse.transaction;

      if (!contractTransaction) {
        throw new Error('No transaction found in populated response');
      }

      console.log('🔧 [GAS RELAYER] Preparing base token transaction for relayer signing:', {
        to: contractTransaction.to,
        data: contractTransaction.data ? 'present' : 'missing',
        value: contractTransaction.value?.toString(),
        gasLimit: contractTransaction.gasLimit?.toString(),
        noFees: false,
        format: 'self-signing-compatible'
      });

      // Prepare transaction object
      const transactionObject = {
        to: contractTransaction.to,
        data: contractTransaction.data,
        value: contractTransaction.value || '0x0',
        gasLimit: contractTransaction.gasLimit ? contractTransaction.gasLimit.toString() : undefined,
        gasPrice: contractTransaction.gasPrice ? contractTransaction.gasPrice.toString() : undefined,
        maxFeePerGas: contractTransaction.maxFeePerGas ? contractTransaction.maxFeePerGas.toString() : undefined,
        maxPriorityFeePerGas: contractTransaction.maxPriorityFeePerGas ? contractTransaction.maxPriorityFeePerGas.toString() : undefined,
        type: contractTransaction.type
      };

      // Clean up undefined values
      Object.keys(transactionObject).forEach(key => {
        if (transactionObject[key] === undefined) {
          delete transactionObject[key];
        }
      });

      console.log('🔧 [GAS RELAYER] Base token transaction formatted for relayer:', {
        to: transactionObject.to,
        dataLength: transactionObject.data?.length,
        value: transactionObject.value,
        gasLimit: transactionObject.gasLimit,
        gasPrice: transactionObject.gasPrice,
        maxFeePerGas: transactionObject.maxFeePerGas,
        maxPriorityFeePerGas: transactionObject.maxPriorityFeePerGas,
        type: transactionObject.type,
        mode: transactionObject.type === 2 ? 'EIP-1559' : 'Legacy'
      });

      // Send transaction object as hex-encoded JSON
      const serializedTransaction = '0x' + Buffer.from(JSON.stringify(transactionObject)).toString('hex');

      console.log('📤 [GAS RELAYER] Submitting base token transaction to transparent relayer...');

      // Calculate fee details for base token relayer mode
      const relayerFeeAmount = relayerFeeBn?.toString() || '0';
      const gasReclamationAmount = gasFeeDeducted?.toString() || '0';

      const totalFeeAmount = BigInt(relayerFeeAmount) + BigInt(gasReclamationAmount);

      const feeDetails = {
        relayerFee: relayerFeeAmount,
        gasReclamation: gasReclamationAmount,
        totalFee: totalFeeAmount.toString()
      };

      console.log('💰 [GAS RELAYER] Base token fee details for submission:', feeDetails);

      const relayed = await submitRelayedTransaction({
        chainId: chain.id,
        serializedTransaction,
        tokenAddress,
        amount: adjustedAmount?.toString() || amount,
        userAddress: walletAddress,
        feeDetails,
        gasEstimate: contractTransaction.gasLimit?.toString()
      });

      transactionHash = relayed.transactionHash;
      usedRelayer = true;
      privacyLevel = 'transparent-relayer-base-token';

      console.log('✅ [GAS RELAYER] Base token transaction submitted successfully!', {
        transactionHash,
        privacyLevel,
        adjustedAmount: adjustedAmount?.toString() || amount,
        combinedFee: combinedRelayerFee?.toString() || '0'
      });

    } catch (gasRelayerError) {
      console.error('❌ [GAS RELAYER] Base token submission failed:', gasRelayerError.message);
      console.log('🔄 [GAS RELAYER] Falling back to self-signing...');

      // Fallback to self-signing
      transactionHash = await submitTransactionSelfSigned(populateResponse, walletProvider);
      usedRelayer = false;
      privacyLevel = 'self-signed';
    }
  } else {
    console.log('🔐 [UNSHIELD] Using self-signing mode for base token');
    transactionHash = await submitTransactionSelfSigned(populateResponse, walletProvider);
    privacyLevel = 'self-signed';
  }

  return {
    hash: transactionHash,
    method: 'base-token',
    privacy: privacyLevel,
    usedRelayer,
    combinedRelayerFee: combinedRelayerFee?.toString() || '0'
  };
};
