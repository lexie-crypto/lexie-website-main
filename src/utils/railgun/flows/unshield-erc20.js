/**
 * Unshield ERC-20 Flow
 * Handles unshielding of ERC-20 tokens with relay adapt mode and cross-contract calls
 */

import { TXIDVersion, EVMGasType, getEVMGasTypeForTransaction } from '@railgun-community/shared-models';
import { waitForRailgunReady } from '../engine.js';
import { getRailgunNetworkName, refreshWalletBalances, createERC20AmountRecipient } from '../transaction/transaction-prep.js';
import { getSelectedRelayer } from '../relayer-client.js';
import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import {
  calculateGasReclamationERC20,
  applyGasPriceGuard,
  validateCombinedFee,
  calculateRelayerFee
} from '../fee-calculator.js';
import { buildGasAndEstimate } from '../tx-gas-details.js';
import { fetchTokenPrices } from '../../pricing/coinGecko.js';
import { getNativeGasToken } from '../balances.js';
import { submitRelayedTransaction, shouldUseRelayer, checkRelayerHealth } from '../relayer-client.js';
import { submitTransactionSelfSigned } from '../transaction/transaction-submitter.js';

/**
 * Execute ERC-20 unshield flow with relay adapt mode
 * @param {object} params - Flow parameters
 * @returns {object} Transaction result
 */
export const executeERC20Unshield = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  recipientAddress,
  walletProvider,
  walletAddress,
  decimals,
}) => {
  console.log('🔧 [UNSHIELD] ERC-20 flow with relay adapt mode');

  const useRelayer = shouldUseRelayer(chain.id, amount);
  console.log(`💰 [UNSHIELD] ERC-20 transaction method: ${useRelayer ? 'RelayAdapt Mode (with broadcaster fee)' : 'Self-Signing (Direct)'}`);

  // Protocol fee is handled by SDK internally. We still account for it in the
  // NET sent to the recipient, but we DO NOT add it to the spend requirement.
  const UNSHIELD_FEE_BPS = 25n; // 0.25%
  const RELAYER_FEE_BPS = 50n; // 0.5% (or from relayer quote)
  const MIN_GAS_LIMIT = 1600000n; // Lower floor - real txs land ~1.1-1.3M

  const userAmountGross = BigInt(amount); // user's entered amount (private balance units)

  let relayerFeeBn = 0n;
  let recipientBn = 0n;
  let unshieldInputAmount = userAmountGross; // amount to unshield into RelayAdapt
  let feeTokenDetails = null;
  let combinedRelayerFee = 0n;  // Hoisted variable for gas reclamation
  let gasFeeDeducted = 0n;  // Initialize gas fee deduction at function scope
  let selectedRelayer = null; // Hoisted for gas reclamation access

  // Define net variable at function scope level for use throughout
  let net;

  // Parity bundle variables for cross-phase validation
  let parityBundleBeforeEstimate = null;

  // SDK will validate balance internally

  if (useRelayer) {
    console.log('🔧 [UNSHIELD] Preparing RelayAdapt mode with cross-contract calls...');

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

    // Calculate relayer fee from the user's amount, then unshield NET of that fee
    relayerFeeBn = calculateRelayerFee(userAmountGross);

    // ESTIMATE GAS COST BEFORE PROOF GENERATION (dummy txn approach)
    console.log('🤑 [UNSHIELD] Estimating gas cost for reclamation (dummy txn)...');

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
      console.warn('⚠️ [UNSHIELD] Failed to get network gas prices for estimation:', gasPriceError.message);
    }

    // Snapshot token prices once for both preview and proof (single source)
    const nativeGasToken = getNativeGasToken(chain.id);
    const feeTokenInfo = getKnownTokenDecimals(selectedRelayer.feeToken, chain.id);
    const feeTokenSymbol = feeTokenInfo?.symbol || selectedRelayer.feeToken;
    const tokenSymbols = [nativeGasToken, feeTokenSymbol];
    const tokenPrices = await fetchTokenPrices(tokenSymbols);

    console.log('💰 [UNSHIELD] Token prices snapshot for fee calculation:', {
      nativeGasToken,
      feeTokenSymbol,
      prices: Object.fromEntries(
        Object.entries(tokenPrices).map(([k, v]) => [k, v?.toFixed(4)])
      )
    });

    // Calculate gas reclamation fee using the exact same estimator as UI preview
    gasFeeDeducted = await calculateGasReclamationERC20(
      selectedRelayer.feeToken,
      chain.id,
      tokenPrices
    );

    // COMBINE FEES FOR BROADCASTER: relayer fee + estimated gas reclamation
    // This amount gets baked into the proof and cannot be changed
    combinedRelayerFee = relayerFeeBn + gasFeeDeducted;
    unshieldInputAmount = userAmountGross; // Send full amount to SDK, let it deduct fees

    // PREFLIGHT GUARD: Prevent combined fees from exceeding user amount
    validateCombinedFee(combinedRelayerFee, userAmountGross, 'ERC-20');

    // CREATE SINGLE BROADCASTER FEE OBJECT: Used for proof generation
    // This includes the ESTIMATED gas reclamation that gets baked into the proof
    const broadcasterFeeERC20AmountRecipient = {
      tokenAddress: selectedRelayer.feeToken,
      recipientAddress: selectedRelayer.railgunAddress, // RAILGUN address (0zk...)
      amount: combinedRelayerFee, // Includes estimated gas reclamation
    };

    console.log('🔍 [UNSHIELD] CRITICAL - Broadcaster fee updated with combined fee:', {
      feeRecipient: selectedRelayer.railgunAddress,
      relayerFeeBn: relayerFeeBn.toString(),
      gasFeeDeducted: gasFeeDeducted.toString(),
      combinedRelayerFee: combinedRelayerFee.toString(),
      tokenAddress: tokenAddress,
      purpose: 'RAILGUN_BROADCASTER_FEE_VIA_SDK_WITH_GAS_RECLAMATION'
    });

    // Apply Railgun protocol fee (0.25%) to the PUBLIC transfer amount only
    const PROTOCOL_FEE_BPS = 25n;
    // SDK receives (userAmount - broadcasterFee), then deducts protocol fee
    // Recipient gets: (userAmount - broadcasterFee) - protocolFee
    const sdkInputAmount = unshieldInputAmount - combinedRelayerFee;
    recipientBn = (sdkInputAmount * (10000n - PROTOCOL_FEE_BPS)) / 10000n;

    console.log('💰 [UNSHIELD] Combined fee calculation (relayer + gas reclamation):', {
      userAmountGross: userAmountGross.toString(),
      relayerFeeBn: relayerFeeBn.toString(),
      gasFeeDeducted: gasFeeDeducted.toString(),
      combinedRelayerFee: combinedRelayerFee.toString(),
      unshieldInputAmount: unshieldInputAmount.toString(),
      recipientBn: recipientBn.toString(),
      requiredSpend: (unshieldInputAmount + combinedRelayerFee).toString(),
      assertion: 'SDK receives full amount, deducts fees internally',
      balanceCheck: `recipient (${recipientBn.toString()}) + broadcaster (${combinedRelayerFee.toString()}) ≤ userGross (${userAmountGross.toString()})`
    });

    // Assertions (before proof/populate)
    if (recipientBn <= 0n) {
      throw new Error(`Recipient amount must be > 0. Got: ${recipientBn.toString()}`);
    }
    if (unshieldInputAmount !== userAmountGross) {
      throw new Error(`Math error: unshieldInput (${unshieldInputAmount.toString()}) != userAmountGross (${userAmountGross.toString()})`);
    }
    const protocolFee = (unshieldInputAmount - combinedRelayerFee) - recipientBn;
    if (recipientBn + combinedRelayerFee + protocolFee !== userAmountGross) {
      throw new Error(`Conservation error: recipient (${recipientBn.toString()}) + broadcaster (${combinedRelayerFee.toString()}) + protocol (${protocolFee.toString()}) != userGross (${userAmountGross.toString()})`);
    }

    // SANITY CHECK: Ensure proof outputs don't exceed user balance
    if (recipientBn + combinedRelayerFee > userAmountGross) {
      throw new Error(`Proof outputs exceed user balance: recipient (${recipientBn.toString()}) + broadcaster fee (${combinedRelayerFee.toString()}) = ${(recipientBn + combinedRelayerFee).toString()} > userAmountGross (${userAmountGross.toString()})`);
    }

    // Guard: Relayer must provide a valid 0zk address
    if (!selectedRelayer.railgunAddress?.startsWith('0zk')) {
      throw new Error('Invalid RAILGUN address for relayer');
    }

    // SDK handles relayer fee via RAILGUN's internal mechanism
    // Note: broadcasterFeeERC20AmountRecipient will be set after combined fee calculation

    // Create consistent objects for all SDK calls
    feeTokenDetails = {
      tokenAddress: selectedRelayer.feeToken,
      feePerUnitGas: selectedRelayer.feePerUnitGas,
    };

    // Note: Detailed broadcaster fee logging happens after combined fee calculation

    // Protocol fee is deducted internally by SDK from unshieldInputAmount

    // Note: erc20AmountRecipients is not used in cross-contract calls mode
    // Instead, we use relayAdaptUnshieldERC20Amounts + crossContractCalls
    // erc20AmountRecipients is already initialized as empty array

    console.log('📝 [UNSHIELD] RelayAdapt recipients prepared:', {
      recipientAmount: { amount: recipientBn.toString(), to: recipientAddress },
      broadcasterFee: { amount: combinedRelayerFee.toString(), to: selectedRelayer.railgunAddress, note: 'includes gas reclamation' },
      unshieldFee: { amount: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
      mode: 'RelayAdapt_CrossContractCalls_Official_Pattern'
    });

    // RelayAdapt params (estimate, proof, populate) — reuse EXACTLY:
    // Send amount after broadcaster fee deduction to avoid SDK balance check issues
    const relayAdaptUnshieldERC20Amounts = [{
      tokenAddress,
      amount: unshieldInputAmount - combinedRelayerFee, // Amount after broadcaster fee deduction
    }];

    const { ethers } = await import('ethers');
    const erc20Interface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)'
    ]);
    const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
      recipientAddress,
      recipientBn, // Use recipientAmount (after protocol fee) for the transfer
    ]);
    const crossContractCalls = [{
      to: tokenAddress,
      data: recipientCallData,
      value: 0n,
    }];

    // DEBUG: Log crossContractCalls construction
    console.log('🔧 [UNSHIELD] Cross-contract calls constructed:', {
      crossContractCalls: crossContractCalls.map(c => ({
        to: c.to,
        dataLength: c.data.length,
        dataPrefix: c.data.substring(0, 10),
        value: c.value.toString(),
        decodedTransfer: (() => {
          try {
            const [, to, amount] = erc20Interface.decodeFunctionData('transfer', c.data);
            return { to, amount: amount.toString() };
          } catch (e) {
            return { error: e.message };
          }
        })()
      })),
      recipientAddress,
      recipientBn: recipientBn.toString(),
      unshieldInputAmount: unshieldInputAmount.toString()
    });

    // STEP 4: Build final gas details using SDK estimation + live fee data (with correct params)
    console.log('📝 [UNSHIELD] Step 4: Building final gas details with correct proof parameters...');

    const networkName = getRailgunNetworkName(chain.id);

    // Use buildGasAndEstimate for populate/submit gas details
    // Gas reclamation is already estimated above and baked into the proof
    const { gasDetails: transactionGasDetails, paddedGasEstimate, overallBatchMinGasPrice, accurateGasEstimate } = await buildGasAndEstimate({
      mode: useRelayer ? 'relayadapt' : 'self',
      chainId: chain.id,
      networkName,
      railgunWalletID,
      encryptionKey,
      relayAdaptUnshieldERC20Amounts,
      crossContractCalls,
      erc20AmountRecipients: [], // Empty for cross-contract calls mode
      feeTokenDetails,
      sendWithPublicWallet: !useRelayer,
      walletProvider,
    });

    // Set variables to match working implementation
    const finalGasEstimate = paddedGasEstimate;
    const minGasForSDK = finalGasEstimate > MIN_GAS_LIMIT ? finalGasEstimate : MIN_GAS_LIMIT;

    // Set evmGasType for logging (matches working implementation)
    const evmGasType = getEVMGasTypeForTransaction(networkName, !useRelayer);

    // NOTE: Gas reclamation estimate is already calculated above and baked into the proof
    // The relayer takes win/loss on the difference between estimated vs actual gas costs

    console.log('📝 [UNSHIELD] Step 5: Generating real unshield proof with accurate gas...');

    console.log('🔧 [UNSHIELD] Real proof mode:', {
      sendWithPublicWallet: !useRelayer,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing',
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString()
    });

    // PUBLIC INPUTS FINGERPRINTING - Proof Step
    const canonRecipients = (xs) => JSON.stringify(xs.map(r => ({
      token: r.tokenAddress.toLowerCase(),
      amt: r.amount.toString(),
      to: r.recipientAddress.toLowerCase(),
    })));

    const proofFP = {
      token: tokenAddress.toLowerCase(),
      recipients: canonRecipients([]),
      sendWithPublicWallet: !useRelayer,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      broadcasterAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString() || 'null'
    };

    console.log('🔍 [UNSHIELD] PUBINPUTS - Proof step:', { step: 'proof', ...proofFP });

    console.log('📝 [UNSHIELD] Generating proof with recipients:', {
      userRecipients: 0, // Empty for cross-contract calls
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing',
      sendWithPublicWallet: !useRelayer
    });

    // Generate proof with correct type based on transaction mode
    let proofResponse;

    console.log('🔐 [UNSHIELD] Generating cross-contract calls proof for RelayAdapt mode...');

    // DEBUG: Check if crossContractCalls is properly constructed
    console.log('🔧 [UNSHIELD] RelayAdapt proof inputs check:', {
      relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts?.length || 0,
      crossContractCalls: crossContractCalls?.length || 0,
      broadcasterFeeERC20AmountRecipient: !!broadcasterFeeERC20AmountRecipient,
      crossContractCallsDetails: crossContractCalls?.map(c => ({
        to: c.to,
        dataLength: c.data?.length || 0,
        value: c.value?.toString() || '0'
      })) || []
    });

    // LOG PARITY BUNDLE BEFORE PROOF (should match estimate bundle)
    const parityBundleBeforeProof = {
      relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({
        tokenAddress: a.tokenAddress,
        amount: a.amount.toString()
      })),
      relayAdaptUnshieldNFTAmounts: [],
      relayAdaptShieldERC20Recipients: [], // Empty for unshielding operations
      relayAdaptShieldNFTRecipients: [],
      crossContractCalls: crossContractCalls.map(c => ({
        to: c.to,
        data: String(c.data),
        value: c.value?.toString?.() ?? '0'
      })),
      broadcasterFeeERC20AmountRecipient: broadcasterFeeERC20AmountRecipient ? {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount.toString()
      } : null,
      sendWithPublicWallet: !useRelayer,
      unshieldInputAmount: unshieldInputAmount.toString(),
      recipientAmount: recipientBn.toString(),
      protocolFee: (unshieldInputAmount - recipientBn).toString(),
      userAmountGross: userAmountGross.toString(),
      combinedRelayerFee: combinedRelayerFee.toString()
    };

    console.log('📋 [UNSHIELD] PARITY BUNDLE BEFORE PROOF:', parityBundleBeforeProof);

    // ASSERT PARITY: Proof bundle should match estimate bundle (only if estimate ran)
    if (parityBundleBeforeEstimate) {
      if (JSON.stringify(parityBundleBeforeEstimate) !== JSON.stringify(parityBundleBeforeProof)) {
        console.error('❌ [UNSHIELD] PARITY MISMATCH: Estimate vs Proof bundles differ!');
        console.error('Estimate bundle:', parityBundleBeforeEstimate);
        console.error('Proof bundle:', parityBundleBeforeProof);
        throw new Error('Parity mismatch between estimate and proof bundles');
      }
      console.log('✅ [UNSHIELD] Parity verified: Estimate and proof bundles match');
    } else {
      console.log('ℹ️ [UNSHIELD] Parity check skipped: No estimate bundle (likely fallback gas used)');
    }

    // Create JSON-serializable version for logging
    const proofBundleForLogging = {
      relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({ tokenAddress: a.tokenAddress, amount: a.amount.toString() })),
      relayAdaptUnshieldNFTAmounts: [],
      relayAdaptShieldERC20Recipients: [], // Empty for unshielding operations
      relayAdaptShieldNFTRecipients: [],
      crossContractCalls: crossContractCalls.map(c => ({ to: c.to, data: String(c.data), value: c.value?.toString?.() ?? '0' })),
      broadcasterFeeERC20AmountRecipient: {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount.toString()
      },
      sendWithPublicWallet: !useRelayer,
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      minGasLimit: MIN_GAS_LIMIT.toString()
    };
    const proofBundleString = JSON.stringify(proofBundleForLogging);
    console.log('🔧 [UNSHIELD] Proof generation parameters:', proofBundleForLogging);

    // INVARIANTS CHECK: Value conservation - user amount should equal all outputs
    const totalBroadcasterFee = broadcasterFeeERC20AmountRecipient ? broadcasterFeeERC20AmountRecipient.amount : 0n;
    const invariantsSdkInputAmount = unshieldInputAmount - totalBroadcasterFee;
    const invariantsProtocolFee = invariantsSdkInputAmount - recipientBn;

    // Conservation: userAmountGross = recipientAmount + broadcasterFee + protocolFee
    const expectedGross = recipientBn + totalBroadcasterFee + invariantsProtocolFee;

    if (userAmountGross !== expectedGross) {
      const errorMsg = `❌ INVARIANT FAIL: Value conservation broken! ` +
        `userAmountGross=${userAmountGross.toString()}, ` +
        `expected=${expectedGross.toString()}, ` +
        `broadcasterFee=${totalBroadcasterFee.toString()}, ` +
        `recipientAmount=${recipientBn.toString()}, ` +
        `protocolFee=${invariantsProtocolFee.toString()}`;
      console.error('🔴 [UNSHIELD] Value conservation check failed:', {
        userAmountGross: userAmountGross.toString(),
        expectedGross: expectedGross.toString(),
        totalBroadcasterFee: totalBroadcasterFee.toString(),
        recipientAmount: recipientBn.toString(),
        protocolFee: invariantsProtocolFee.toString(),
        difference: (userAmountGross - expectedGross).toString()
      });
      throw new Error(errorMsg);
    }

    console.log('✅ [UNSHIELD] Value conservation verified:', {
      userAmountGross: userAmountGross.toString(),
      totalBroadcasterFee: totalBroadcasterFee.toString(),
      recipientAmount: recipientBn.toString(),
      protocolFee: invariantsProtocolFee.toString(),
      balance: '✓'
    });

    // DEBUG: Log what we're sending to proof generation
    console.log('🔐 [UNSHIELD] Proof generation inputs:', {
      relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({
        tokenAddress: a.tokenAddress,
        amount: a.amount.toString()
      })),
      crossContractCalls: crossContractCalls.map(c => ({
        to: c.to,
        dataLength: c.data.length,
        value: c.value.toString()
      })),
      broadcasterFeeERC20AmountRecipient: broadcasterFeeERC20AmountRecipient ? {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount.toString()
      } : null,
      sendWithPublicWallet: !useRelayer,
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      minGasForSDK: minGasForSDK.toString(),
      expectedOutputs: {
        userRecipient: recipientBn.toString(),
        broadcasterFee: combinedRelayerFee.toString(),
        total: (recipientBn + combinedRelayerFee).toString()
      }
    });

    const proofBundle = {
      relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({ tokenAddress: a.tokenAddress, amount: a.amount.toString() })),
      relayAdaptUnshieldNFTAmounts: [],
      relayAdaptShieldERC20Recipients: [],
      relayAdaptShieldNFTRecipients: [],
      crossContractCalls: crossContractCalls.map(c => ({ to: c.to, data: String(c.data), value: c.value?.toString?.() ?? '0' })),
      broadcasterFeeERC20AmountRecipient: {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount.toString()
      },
      sendWithPublicWallet: !useRelayer,
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      minGasLimit: MIN_GAS_LIMIT.toString()
    };

    proofResponse = await generateCrossContractCallsProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      relayAdaptUnshieldERC20Amounts,
      [], // relayAdaptUnshieldNFTAmounts
      [], // relayAdaptShieldERC20Recipients
      [], // relayAdaptShieldNFTRecipients
      crossContractCalls, // Single transfer call (recipient only)
      broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
      !useRelayer, // sendWithPublicWallet
      overallBatchMinGasPrice,
      minGasForSDK,
      (progress) => {
        console.log(`📊 [UNSHIELD] Cross-contract calls Proof Progress: ${(progress * 100).toFixed(2)}%`);
      } // progressCallback
    );

    console.log('✅ [UNSHIELD] Cross-contract calls proof generated for RelayAdapt mode');

    console.log('✅ [UNSHIELD] Proof generation completed with gas padding:', {
      originalGasEstimate: accurateGasEstimate.toString(),
      paddedGasEstimate: finalGasEstimate.toString(),
      minGasForSDK: minGasForSDK.toString(),
      padding: '20%',
      evmGasType,
      hasProof: !!proofResponse,
      method: 'official-sdk-gas-estimation'
    });

    // Create proper gas details using official RAILGUN pattern
    console.log('💰 [UNSHIELD] Creating transaction gas details using SDK pattern...');

    let gasDetails;
    try {
      // Get current network gas prices
      const signer = await walletProvider();
      const provider = signer?.provider;

      let networkGasPrices = null;
      if (provider) {
        try {
          const feeData = await provider.getFeeData();
          console.log('💰 [UNSHIELD] Network gas prices:', {
            gasPrice: feeData.gasPrice?.toString(),
            maxFeePerGas: feeData.maxFeePerGas?.toString(),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
          });

          // Use network prices if available and reasonable
          if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            // Ensure priority fee is not higher than max fee
            if (feeData.maxPriorityFeePerGas > feeData.maxFeePerGas) {
              feeData.maxPriorityFeePerGas = feeData.maxFeePerGas / 2n;
            }
            networkGasPrices = feeData;
          }
        } catch (feeError) {
          console.warn('⚠️ [UNSHIELD] Failed to get network gas prices:', feeError.message);
        }
      }

      // Create gas details following official SDK pattern with network-appropriate fallbacks
      let gasPriceFallback, maxFeeFallback, priorityFeeFallback;

      // Network-specific gas price fallbacks
      if (chain.id === 42161) { // Arbitrum
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei
        maxFeeFallback = BigInt('1000000000'); // 1 gwei
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei
      } else if (chain.id === 1) { // Ethereum
        gasPriceFallback = BigInt('3000000000'); // 3 gwei
        maxFeeFallback = BigInt('4000000000'); // 4 gwei
        priorityFeeFallback = BigInt('3000000000'); // 3 gwei
      } else if (chain.id === 56) { // BNB Chain - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else if (chain.id === 137) { // Polygon - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else { // Default for other networks
        gasPriceFallback = BigInt('5000000000'); // 5 gwei
        maxFeeFallback = BigInt('6000000000'); // 6 gwei
        priorityFeeFallback = BigInt('1000000000'); // 1 gwei
      }

      console.log('💰 [UNSHIELD] Using network-specific gas fallbacks:', {
        chainId: chain.id,
        gasPriceFallback: gasPriceFallback.toString(),
        maxFeeFallback: maxFeeFallback.toString(),
        priorityFeeFallback: priorityFeeFallback.toString(),
        accurateGasEstimate: accurateGasEstimate.toString()
      });

      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let finalGasPrice = networkGasPrices?.gasPrice || gasPriceFallback;
          // No special gas price floor for BNB - treat like other L2s
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            gasPrice: finalGasPrice,
          };
          break;
        case EVMGasType.Type2:
          let finalMaxFee = networkGasPrices?.maxFeePerGas || maxFeeFallback;
          // No special gas price floor for BNB - treat like other L2s
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            maxFeePerGas: finalMaxFee,
            maxPriorityFeePerGas: networkGasPrices?.maxPriorityFeePerGas || priorityFeeFallback,
          };
          break;
        default:
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }

      console.log('✅ [UNSHIELD] Gas details created:', {
        evmGasType,
        gasEstimate: gasDetails.gasEstimate.toString(),
        gasPrice: gasDetails.gasPrice?.toString(),
        maxFeePerGas: gasDetails.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: gasDetails.maxPriorityFeePerGas?.toString(),
        usingNetworkPrices: !!networkGasPrices
      });

    } catch (gasError) {
      console.error('❌ [UNSHIELD] Failed to create gas details:', gasError.message);

      // Create fallback gas details with network-appropriate values
      let gasPriceFallback, maxFeeFallback, priorityFeeFallback;

      if (chain.id === 42161) { // Arbitrum
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei
        maxFeeFallback = BigInt('1000000000'); // 1 gwei
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei
      } else if (chain.id === 1) { // Ethereum
        gasPriceFallback = BigInt('20000000000'); // 20 gwei
        maxFeeFallback = BigInt('25000000000'); // 25 gwei
        priorityFeeFallback = BigInt('2000000000'); // 2 gwei
      } else if (chain.id === 56) { // BNB Chain - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else if (chain.id === 137) { // Polygon - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else {
        gasPriceFallback = BigInt('5000000000'); // 5 gwei
        maxFeeFallback = BigInt('6000000000'); // 6 gwei
        priorityFeeFallback = BigInt('1000000000'); // 1 gwei
      }

      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let fallbackGasPrice = gasPriceFallback;
          // No special gas price floor for BNB - treat like other L2s
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            gasPrice: fallbackGasPrice,
          };
          break;
        case EVMGasType.Type2:
          let fallbackMaxFee = maxFeeFallback;
          // No special gas price floor for BNB - treat like other L2s
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            maxFeePerGas: fallbackMaxFee,
            maxPriorityFeePerGas: priorityFeeFallback,
          };
          break;
        default:
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }

      console.log('⚠️ [UNSHIELD] Using fallback gas details due to error');
    }

    // STEP 6: Populate transaction using generated proof
    console.log('📝 [UNSHIELD] Step 6: Populating transaction with proof...');

    // PUBLIC INPUTS FINGERPRINTING - Populate Step
    const populateFP = {
      token: tokenAddress.toLowerCase(),
      recipients: canonRecipients([]),
      sendWithPublicWallet: !useRelayer,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      broadcasterAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString() || 'null'
    };

    console.log('🔍 [UNSHIELD] PUBINPUTS - Populate step:', { step: 'populate', ...populateFP });

    // Verify proof and populate parameters match
    if (JSON.stringify(proofFP) !== JSON.stringify(populateFP)) {
      console.error('❌ [UNSHIELD] Mismatch between proof and populate inputs!', {
        proofFP,
        populateFP
      });
      throw new Error('Mismatch: proof vs populate public inputs');
    }

    console.log('✅ [UNSHIELD] Public inputs match between proof and populate steps');

    // PROOF-LEVEL BREADCRUMBS: Log critical proof parameters for debugging
    console.log('🔍 [UNSHIELD] [proof] Proof parameters for debugging:', {
      txidVersion: 'V2_PoseidonMerkle',
      sendWithPublicWallet: !useRelayer, // expect false for relayer mode
      relayAdaptExpected: useRelayer ? '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9' : 'N/A',
      merkleRoot: proofResponse?.publicInputs?.merkleRoot?.toString() ?? '<n/a>',
      nullifiers: proofResponse?.nullifiers?.map(x => x.toString()) ?? [],
      recipientsFingerprint: canonRecipients([]),
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      relayerFeeAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString() || '0',
      proofGenerated: !!proofResponse,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing'
    });

    // CRITICAL: Use correct populate function based on transaction mode
    let populatedTransaction;

    console.log('🔧 [UNSHIELD] Using cross-contract calls for proper RelayAdapt forwarding...');

    try {
      populatedTransaction = await populateProvedCrossContractCalls(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        relayAdaptUnshieldERC20Amounts,
        [], // relayAdaptUnshieldNFTAmounts
        [], // relayAdaptShieldERC20Recipients
        [], // relayAdaptShieldNFTRecipients
        crossContractCalls, // Single transfer call (recipient only)
        broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
        !useRelayer, // sendWithPublicWallet
        overallBatchMinGasPrice,
        transactionGasDetails
      );
    } catch (sdkErr) {
      const causeMsg = sdkErr?.cause?.message || sdkErr?.message;
      console.error('❌ [UNSHIELD] populateProvedCrossContractCalls failed:', {
        message: sdkErr?.message,
        cause: sdkErr?.cause?.message,
      });
      // If SDK surfaced a specific mismatch, log it plainly for quick triage
      if (causeMsg?.startsWith('Mismatch:')) {
        console.error('❌ [UNSHIELD] SDK mismatch detail:', causeMsg);
      }
      throw sdkErr;
    }

    console.log('✅ [UNSHIELD] RelayAdapt transaction populated using cross-contract calls');

    console.log('✅ [UNSHIELD] Transaction populated:', {
      to: populatedTransaction.transaction.to,
      gasLimit: populatedTransaction.transaction.gasLimit?.toString(),
      hasData: !!populatedTransaction.transaction.data,
    });

    // STEP 7: Transaction submission
    console.log('📡 [UNSHIELD] Step 7: Submitting transaction...');

    let transactionHash;
    let usedRelayer = false;
    let privacyLevel = 'self-signed';

    if (useRelayer) {
      console.log('🚀 [GAS RELAYER] Attempting submission via transparent gas relayer...');

      try {
        // Check relayer health
        const relayerHealthy = await checkRelayerHealth();
        if (!relayerHealthy) {
          throw new Error('Gas relayer service is not available');
        }

        // Get the transaction from RAILGUN (same format as self-signing)
        const contractTransaction = populatedTransaction.transaction;

        if (!contractTransaction) {
          throw new Error('No transaction found in populated response');
        }

        console.log('🔧 [GAS RELAYER] Preparing transaction for relayer signing:', {
          to: contractTransaction.to,
          data: contractTransaction.data ? 'present' : 'missing',
          value: contractTransaction.value?.toString(),
          gasLimit: contractTransaction.gasLimit?.toString(),
          noFees: true,
          format: 'self-signing-compatible'
        });

        // CORRECTED: Preserve ALL RAILGUN fields with proper JSON serialization
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

        console.log('🔧 [GAS RELAYER] Transaction formatted for relayer:', {
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

        console.log('📤 [GAS RELAYER] Submitting to transparent relayer (no fees)...');

        // Calculate fee details for RelayAdapt mode
        const relayerFeeAmount = useRelayer && broadcasterFeeERC20AmountRecipient ?
          broadcasterFeeERC20AmountRecipient.amount.toString() : '0';

        // RAILGUN protocol fee is always applied (0.25%)
        const RAILGUN_FEE_BPS = 25n;
        const railgunProtocolFee = (BigInt(amount) * RAILGUN_FEE_BPS) / 10000n;
        const protocolFeeAmount = railgunProtocolFee.toString();

        const totalFeeAmount = BigInt(relayerFeeAmount) + BigInt(protocolFeeAmount);

        const feeDetails = {
          relayerFee: relayerFeeAmount,
          protocolFee: protocolFeeAmount,
          totalFee: totalFeeAmount.toString()
        };

        console.log('💰 [GAS RELAYER] Fee details for submission:', feeDetails);

        const relayerResult = await submitRelayedTransaction({
          chainId: chain.id,
          serializedTransaction,
          tokenAddress,
          amount,
          userAddress: walletAddress,
          feeDetails,
          gasEstimate: contractTransaction.gasLimit?.toString()
        });

        transactionHash = relayerResult.transactionHash;
        usedRelayer = true;
        privacyLevel = 'transparent-relayer';

        console.log('✅ [GAS RELAYER] Transaction submitted successfully!', {
          transactionHash,
          privacyLevel,
          noFees: true
        });

      } catch (gasRelayerError) {
        console.error('❌ [GAS RELAYER] Submission failed:', gasRelayerError.message);
        console.log('🔄 [GAS RELAYER] Falling back to self-signing...');

        // Fallback to self-signing with existing transaction
        transactionHash = await submitTransactionSelfSigned(populatedTransaction, walletProvider);
        usedRelayer = false;
        privacyLevel = 'self-signed';
      }
    } else {
      console.log('🔐 [UNSHIELD] Using self-signing mode');
      transactionHash = await submitTransactionSelfSigned(populatedTransaction, walletProvider);
    }

    return {
      transactionHash,
      usedRelayer,
      privacyLevel,
    };

  } else {
    // SELF-SIGNING MODE: Only SDK's unshield fee applies (relayer fee is 0)
    console.log('🔧 [UNSHIELD] Preparing self-signing mode (with SDK unshield fee)...');

    // Self-signing: no relayer fee. Unshield full user amount, recipient gets net of protocol fee
    unshieldInputAmount = userAmountGross;
    recipientBn = (unshieldInputAmount * (10000n - UNSHIELD_FEE_BPS)) / 10000n;

    console.log('💰 [UNSHIELD] Self-signing fee calculation:', {
      userAmountGross: userAmountGross.toString(),
      recipientBn: recipientBn.toString(),
      unshieldFee: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(),
      railgunFeePercent: '0.25%',
      noRelayerFee: true
    });

    // Hard guard: self-sign path must NOT provide a broadcaster fee
    if (broadcasterFeeERC20AmountRecipient !== null) {
      throw new Error('Internal error: broadcaster fee must be undefined for self-signing path');
    }

    const userRecipient = createERC20AmountRecipient(tokenAddress, recipientBn, recipientAddress);
    const erc20AmountRecipients = [userRecipient];

    console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
      userRecipient: { amount: recipientBn.toString(), to: recipientAddress },
      unshieldFee: { amount: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
      mode: 'self-signing-with-unshield-fee'
    });

    // STEP 4: Build final gas details using SDK estimation + live fee data (with correct params)
    console.log('📝 [UNSHIELD] Step 4: Building final gas details with correct proof parameters...');

    const networkName = getRailgunNetworkName(chain.id);

    // Use buildGasAndEstimate for populate/submit gas details
    const { gasDetails: transactionGasDetails, paddedGasEstimate, overallBatchMinGasPrice, accurateGasEstimate } = await buildGasAndEstimate({
      mode: 'self',
      chainId: chain.id,
      networkName,
      railgunWalletID,
      encryptionKey,
      relayAdaptUnshieldERC20Amounts: undefined,
      crossContractCalls: undefined,
      erc20AmountRecipients,
      feeTokenDetails: undefined,
      sendWithPublicWallet: true,
      walletProvider,
    });

    // Set variables to match working implementation
    const finalGasEstimate = paddedGasEstimate;
    const minGasForSDK = finalGasEstimate > MIN_GAS_LIMIT ? finalGasEstimate : MIN_GAS_LIMIT;

    // Set evmGasType for logging (matches working implementation)
    const evmGasType = getEVMGasTypeForTransaction(networkName, true);

    console.log('📝 [UNSHIELD] Step 5: Generating real unshield proof with accurate gas...');

    console.log('🔧 [UNSHIELD] Real proof mode:', {
      sendWithPublicWallet: true,
      hasBroadcasterFee: false,
      mode: 'Self-Signing',
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString()
    });

    // PUBLIC INPUTS FINGERPRINTING - Proof Step
    const canonRecipients = (xs) => JSON.stringify(xs.map(r => ({
      token: r.tokenAddress.toLowerCase(),
      amt: r.amount.toString(),
      to: r.recipientAddress.toLowerCase(),
    })));

    const proofFP = {
      token: tokenAddress.toLowerCase(),
      recipients: canonRecipients(erc20AmountRecipients),
      sendWithPublicWallet: true,
      hasBroadcasterFee: false,
      broadcasterAmount: 'null'
    };

    console.log('🔍 [UNSHIELD] PUBINPUTS - Proof step:', { step: 'proof', ...proofFP });

    console.log('📝 [UNSHIELD] Generating proof with recipients:', {
      userRecipients: erc20AmountRecipients.length,
      hasBroadcasterFee: false,
      mode: 'Self-Signing',
      sendWithPublicWallet: true
    });

    // Generate proof with correct type based on transaction mode
    let proofResponse;

    console.log('🔐 [UNSHIELD] Generating regular Unshield proof for self-signing mode...');

    const { generateUnshieldProof } = await import('@railgun-community/wallet');

    proofResponse = await generateUnshieldProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients, // User recipients (amount minus protocol fee)
      [], // nftAmountRecipients
      undefined, // No broadcaster fee for self-signing
      true, // sendWithPublicWallet
      undefined, // overallBatchMinGasPrice
      (progress, status) => {
        console.log(`📊 [UNSHIELD] Regular Unshield Proof Progress: ${progress.toFixed(2)}% | ${status}`);
      } // progressCallback
    );

    console.log('✅ [UNSHIELD] Regular Unshield proof generated for self-signing mode');

    console.log('✅ [UNSHIELD] Proof generation completed with gas padding:', {
      originalGasEstimate: accurateGasEstimate.toString(),
      paddedGasEstimate: finalGasEstimate.toString(),
      minGasForSDK: minGasForSDK.toString(),
      padding: '20%',
      evmGasType,
      hasProof: !!proofResponse,
      method: 'official-sdk-gas-estimation'
    });

    // Create proper gas details using official RAILGUN pattern
    console.log('💰 [UNSHIELD] Creating transaction gas details using SDK pattern...');

    let gasDetails;
    try {
      // Get current network gas prices
      const signer = await walletProvider();
      const provider = signer?.provider;

      let networkGasPrices = null;
      if (provider) {
        try {
          const feeData = await provider.getFeeData();
          console.log('💰 [UNSHIELD] Network gas prices:', {
            gasPrice: feeData.gasPrice?.toString(),
            maxFeePerGas: feeData.maxFeePerGas?.toString(),
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
          });

          // Use network prices if available and reasonable
          if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            // Ensure priority fee is not higher than max fee
            if (feeData.maxPriorityFeePerGas > feeData.maxFeePerGas) {
              feeData.maxPriorityFeePerGas = feeData.maxFeePerGas / 2n;
            }
            networkGasPrices = feeData;
          }
        } catch (feeError) {
          console.warn('⚠️ [UNSHIELD] Failed to get network gas prices:', feeError.message);
        }
      }

      // Create gas details following official SDK pattern with network-appropriate fallbacks
      let gasPriceFallback, maxFeeFallback, priorityFeeFallback;

      // Network-specific gas price fallbacks
      if (chain.id === 42161) { // Arbitrum
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei
        maxFeeFallback = BigInt('1000000000'); // 1 gwei
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei
      } else if (chain.id === 1) { // Ethereum
        gasPriceFallback = BigInt('3000000000'); // 3 gwei
        maxFeeFallback = BigInt('4000000000'); // 4 gwei
        priorityFeeFallback = BigInt('3000000000'); // 3 gwei
      } else if (chain.id === 56) { // BNB Chain - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else if (chain.id === 137) { // Polygon - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else { // Default for other networks
        gasPriceFallback = BigInt('5000000000'); // 5 gwei
        maxFeeFallback = BigInt('6000000000'); // 6 gwei
        priorityFeeFallback = BigInt('1000000000'); // 1 gwei
      }

      console.log('💰 [UNSHIELD] Using network-specific gas fallbacks:', {
        chainId: chain.id,
        gasPriceFallback: gasPriceFallback.toString(),
        maxFeeFallback: maxFeeFallback.toString(),
        priorityFeeFallback: priorityFeeFallback.toString(),
        accurateGasEstimate: accurateGasEstimate.toString()
      });

      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let finalGasPrice = networkGasPrices?.gasPrice || gasPriceFallback;
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            gasPrice: finalGasPrice,
          };
          break;
        case EVMGasType.Type2:
          let finalMaxFee = networkGasPrices?.maxFeePerGas || maxFeeFallback;
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            maxFeePerGas: finalMaxFee,
            maxPriorityFeePerGas: networkGasPrices?.maxPriorityFeePerGas || priorityFeeFallback,
          };
          break;
        default:
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }

      console.log('✅ [UNSHIELD] Gas details created:', {
        evmGasType,
        gasEstimate: gasDetails.gasEstimate.toString(),
        gasPrice: gasDetails.gasPrice?.toString(),
        maxFeePerGas: gasDetails.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: gasDetails.maxPriorityFeePerGas?.toString(),
        usingNetworkPrices: !!networkGasPrices
      });

    } catch (gasError) {
      console.error('❌ [UNSHIELD] Failed to create gas details:', gasError.message);

      // Create fallback gas details with network-appropriate values
      let gasPriceFallback, maxFeeFallback, priorityFeeFallback;

      if (chain.id === 42161) { // Arbitrum
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei
        maxFeeFallback = BigInt('1000000000'); // 1 gwei
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei
      } else if (chain.id === 1) { // Ethereum
        gasPriceFallback = BigInt('20000000000'); // 20 gwei
        maxFeeFallback = BigInt('25000000000'); // 25 gwei
        priorityFeeFallback = BigInt('2000000000'); // 2 gwei
      } else if (chain.id === 56) { // BNB Chain - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else if (chain.id === 137) { // Polygon - L2-like tiny fallbacks
        gasPriceFallback = BigInt('100000000'); // 0.1 gwei (same as Arbitrum)
        maxFeeFallback = BigInt('1000000000'); // 1 gwei (same as Arbitrum)
        priorityFeeFallback = BigInt('10000000'); // 0.01 gwei (same as Arbitrum)
      } else {
        gasPriceFallback = BigInt('5000000000'); // 5 gwei
        maxFeeFallback = BigInt('6000000000'); // 6 gwei
        priorityFeeFallback = BigInt('1000000000'); // 1 gwei
      }

      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let fallbackGasPrice = gasPriceFallback;
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            gasPrice: fallbackGasPrice,
          };
          break;
        case EVMGasType.Type2:
          let fallbackMaxFee = maxFeeFallback;
          gasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate, // Use padded estimate
            maxFeePerGas: fallbackMaxFee,
            maxPriorityFeePerGas: priorityFeeFallback,
          };
          break;
        default:
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }

      console.log('⚠️ [UNSHIELD] Using fallback gas details due to error');
    }

    // STEP 6: Populate transaction using generated proof
    console.log('📝 [UNSHIELD] Step 6: Populating transaction with proof...');

    // PUBLIC INPUTS FINGERPRINTING - Populate Step
    const populateFP = {
      token: tokenAddress.toLowerCase(),
      recipients: canonRecipients(erc20AmountRecipients),
      sendWithPublicWallet: true,
      hasBroadcasterFee: false,
      broadcasterAmount: 'null'
    };

    console.log('🔍 [UNSHIELD] PUBINPUTS - Populate step:', { step: 'populate', ...populateFP });

    // Verify proof and populate parameters match
    if (JSON.stringify(proofFP) !== JSON.stringify(populateFP)) {
      console.error('❌ [UNSHIELD] Mismatch between proof and populate inputs!', {
        proofFP,
        populateFP
      });
      throw new Error('Mismatch: proof vs populate public inputs');
    }

    console.log('✅ [UNSHIELD] Public inputs match between proof and populate steps');

    // PROOF-LEVEL BREADCRUMBS: Log critical proof parameters for debugging
    console.log('🔍 [UNSHIELD] [proof] Proof parameters for debugging:', {
      txidVersion: 'V2_PoseidonMerkle',
      sendWithPublicWallet: true, // expect false for relayer mode
      relayAdaptExpected: 'N/A',
      merkleRoot: proofResponse?.publicInputs?.merkleRoot?.toString() ?? '<n/a>',
      nullifiers: proofResponse?.nullifiers?.map(x => x.toString()) ?? [],
      recipientsFingerprint: canonRecipients(erc20AmountRecipients),
      hasBroadcasterFee: false,
      relayerFeeAmount: '0',
      proofGenerated: !!proofResponse,
      mode: 'Self-Signing'
    });

    // CRITICAL: Use correct populate function based on transaction mode
    let populatedTransaction;

    console.log('🔧 [UNSHIELD] Using populateProvedUnshield for self-signing mode...');

    const { populateProvedUnshield } = await import('@railgun-community/wallet');

    populatedTransaction = await populateProvedUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      erc20AmountRecipients, // User recipients (amount minus protocol fee)
      [], // nftAmountRecipients - empty for regular unshield
      undefined, // No broadcaster fee for self-signing
      true, // sendWithPublicWallet
      undefined, // overallBatchMinGasPrice - not needed for self-signing
      transactionGasDetails
    );

    console.log('✅ [UNSHIELD] Self-signing transaction populated using regular Unshield proof type');

    console.log('✅ [UNSHIELD] Transaction populated:', {
      to: populatedTransaction.transaction.to,
      gasLimit: populatedTransaction.transaction.gasLimit?.toString(),
      hasData: !!populatedTransaction.transaction.data,
    });

    // STEP 7: Transaction submission
    console.log('📡 [UNSHIELD] Step 7: Submitting transaction...');

    console.log('🔐 [UNSHIELD] Using self-signing mode');
    transactionHash = await submitTransactionSelfSigned(populatedTransaction, walletProvider);

    return {
      transactionHash,
      usedRelayer: false,
      privacyLevel: 'self-signed',
    };
  }
};
