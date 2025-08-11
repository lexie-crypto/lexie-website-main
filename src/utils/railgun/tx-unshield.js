/**
 * RAILGUN Unshield Transactions - Clean Gas Relayer Pattern
 * - Single proof generation with correct recipients
 * - Gas relayer with public self-signing (stealth EOA)
 * - Clean fallback to user self-signing
 * - No Waku/broadcaster dependencies
 */

import {
  populateProvedUnshield,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  getEVMGasTypeForTransaction,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';

// Gas Relayer Integration
import { 
  estimateRelayerFee, 
  submitRelayedTransaction, 
  shouldUseRelayer,
  checkRelayerHealth,
  getRelayerAddress,
} from './relayer-client.js';

// Proof Generation
import { generateUnshieldProof } from './tx-proof-unshield.js';

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
 * Emergency hardcoded token decimals for critical tokens
 */
const getKnownTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return null;
  
  const address = tokenAddress.toLowerCase();
  const knownTokens = {
    // Ethereum
    1: {
      '0xdac17f958d2ee523a2206206994597c13d831ec7': { decimals: 6, symbol: 'USDT' },
      '0xa0b86a33e6416a86f2016c97db4ad0a23a5b7b73': { decimals: 6, symbol: 'USDC' },
      '0x6b175474e89094c44da98b954eedeac495271d0f': { decimals: 18, symbol: 'DAI' },
    },
    // Arbitrum
    42161: {
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { decimals: 6, symbol: 'USDT' },
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { decimals: 6, symbol: 'USDC' },
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { decimals: 18, symbol: 'DAI' },
    },
  };
  
  const chainTokens = knownTokens[chainId];
  if (!chainTokens) return null;
  
  return chainTokens[address] || null;
};

/**
 * Get unspent notes for unshield operation using Redis/Graph data
 */
const getUnspentNotesForUnshield = async (walletAddress, railgunWalletID, tokenAddress, requiredAmount) => {
  try {
    console.log('📝 [UNSHIELD] Getting unspent notes from Redis...', {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      requiredAmount,
    });

    const response = await fetch(`/api/wallet-metadata?action=unspent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        walletId: railgunWalletID,
        tokenAddress,
        requiredAmount
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to get unspent notes: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Note retrieval failed: ${result.error}`);
    }

    const unspentNotes = result.notes || [];
    console.log('✅ [UNSHIELD] Retrieved unspent notes:', {
      noteCount: unspentNotes.length,
      totalValue: unspentNotes.reduce((sum, note) => sum + BigInt(note.value), BigInt(0)).toString(),
    });
    
    return unspentNotes;
  } catch (error) {
    console.error('❌ [UNSHIELD] Failed to get unspent notes:', error.message);
    throw new Error(`Cannot get unspent notes: ${error.message}`);
  }
};

/**
 * Create ERC20AmountRecipient object for unshield
 */
const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  const amountString = String(amount);
  
  if (!amount || amountString === '' || amountString === 'undefined' || amountString === 'null') {
    throw new Error(`Invalid amount for ERC20AmountRecipient: "${amount}"`);
  }
  
  let amountBigInt;
  try {
    amountBigInt = BigInt(amountString);
  } catch (error) {
    throw new Error(`Cannot convert amount "${amountString}" to BigInt: ${error.message}`);
  }
  
  return {
    tokenAddress: tokenAddress || undefined,
    amount: amountBigInt,
    recipientAddress: recipientAddress,
  };
};

/**
 * Submit transaction via self-signing
 */
const submitTransactionSelfSigned = async (populatedTransaction, walletProvider) => {
  try {
    const walletSigner = await walletProvider();
    
    // Format transaction for self-signing
    const txForSending = {
      ...populatedTransaction.transaction,
      gasLimit: populatedTransaction.transaction.gasLimit ? '0x' + populatedTransaction.transaction.gasLimit.toString(16) : undefined,
      gasPrice: populatedTransaction.transaction.gasPrice ? '0x' + populatedTransaction.transaction.gasPrice.toString(16) : undefined,
      maxFeePerGas: populatedTransaction.transaction.maxFeePerGas ? '0x' + populatedTransaction.transaction.maxFeePerGas.toString(16) : undefined,
      maxPriorityFeePerGas: populatedTransaction.transaction.maxPriorityFeePerGas ? '0x' + populatedTransaction.transaction.maxPriorityFeePerGas.toString(16) : undefined,
      value: populatedTransaction.transaction.value ? '0x' + populatedTransaction.transaction.value.toString(16) : '0x0',
    };

    // EIP-1559 compatibility
    if (!txForSending.gasPrice && txForSending.maxFeePerGas) {
      txForSending.gasPrice = txForSending.maxFeePerGas;
    }
    
    // Clean up undefined values
    Object.keys(txForSending).forEach(key => {
      if (txForSending[key] === undefined) {
        delete txForSending[key];
      }
    });
    
    console.log('🔄 [UNSHIELD] Self-signing transaction...', {
      to: txForSending.to,
      gasLimit: txForSending.gasLimit,
      hasData: !!txForSending.data,
    });
    
    // Validate required fields
    if (!txForSending.to || !txForSending.data || !txForSending.gasLimit) {
      throw new Error('Transaction missing required fields');
    }
    
    const txResponse = await walletSigner.sendTransaction(txForSending);
    const finalTxHash = txResponse.hash || txResponse;
    
    console.log('✅ [UNSHIELD] Self-signed transaction sent:', finalTxHash);
    return finalTxHash;
    
  } catch (error) {
    console.error('❌ [UNSHIELD] Self-signing failed:', error.message);
    throw new Error(`Self-signing failed: ${error.message}`);
  }
};

/**
 * Main unshield function with clean gas relayer pattern
 */
export const unshieldTokens = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  toAddress,
  walletProvider,
  walletAddress,
  decimals,
}) => {
  console.log('🚀 [UNSHIELD] Starting unshield transaction...', {
    railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
    tokenAddress: tokenAddress?.substring(0, 10) + '...',
    amount,
    toAddress: toAddress?.substring(0, 10) + '...',
    chainId: chain.id,
    decimals,
  });

  try {
    // Validate required parameters
    if (!encryptionKey || !railgunWalletID || !amount || !toAddress || !walletAddress) {
      throw new Error('Missing required parameters');
    }
    
    if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.length < 10) {
      throw new Error(`Invalid tokenAddress: "${tokenAddress}"`);
    }

    // STEP 1: Balance refresh and network scanning
    console.log('🔄 [UNSHIELD] Step 1: Refreshing balances and scanning network...');
    
    try {
      const { refreshBalances } = await import('@railgun-community/wallet');
      const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
      
      await waitForRailgunReady();
      
      const networkName = getRailgunNetworkName(chain.id);
      const networkConfig = NETWORK_CONFIG[networkName];
      
      if (!networkConfig) {
        throw new Error(`No network config found for ${networkName}`);
      }
      
      const railgunChain = networkConfig.chain;
      const walletIdFilter = [railgunWalletID];
      
      console.log('🔄 [UNSHIELD] Refreshing Railgun balances...');
      await refreshBalances(railgunChain, walletIdFilter);
      
    } catch (refreshError) {
      console.warn('⚠️ [UNSHIELD] Balance refresh failed:', refreshError.message);
    }

    // STEP 2: Network rescan for up-to-date Merkle tree
    console.log('🔄 [UNSHIELD] Step 2: Performing network rescan...');
    
    try {
      const { performNetworkRescan, getRailgunNetworkName } = await import('./scanning-service.js');
      const networkName = getRailgunNetworkName(chain.id);
      
      await performNetworkRescan(networkName, [railgunWalletID]);
      console.log('✅ [UNSHIELD] Network rescan completed');
      
    } catch (rescanError) {
      console.error('❌ [UNSHIELD] Network rescan failed:', rescanError.message);
      throw new Error(`Failed to rescan network: ${rescanError.message}`);
    }

    // STEP 3: Get unspent notes
    console.log('📝 [UNSHIELD] Step 3: Getting unspent notes...');
    
    const unspentNotes = await getUnspentNotesForUnshield(walletAddress, railgunWalletID, tokenAddress, amount);
    
    if (unspentNotes.length === 0) {
      throw new Error('No unspent notes available for this token');
    }

    const totalAvailable = unspentNotes.reduce((sum, note) => sum + BigInt(note.value), BigInt(0));
    const requiredAmount = BigInt(amount);
    
    if (totalAvailable < requiredAmount) {
      throw new Error(`Insufficient unspent notes. Available: ${totalAvailable.toString()}, Required: ${requiredAmount.toString()}`);
    }

    console.log('✅ [UNSHIELD] Note validation passed:', {
      availableNotes: unspentNotes.length,
      totalValue: totalAvailable.toString(),
    });

    // STEP 4: Determine transaction method and prepare recipients
    console.log('🔧 [UNSHIELD] Step 4: Determining transaction method...');
    
    const useRelayer = shouldUseRelayer(chain.id, amount);
    const sendWithPublicWallet = !useRelayer; // false when relaying, true when self-signing
    
    console.log(`💰 [UNSHIELD] Transaction method: ${useRelayer ? 'RelayAdapt Mode (with broadcaster fee)' : 'Self-Signing (Direct)'}`);
    console.log(`🔧 [UNSHIELD] sendWithPublicWallet: ${sendWithPublicWallet}`);

    // Check zero-delay mode
    if (typeof window !== 'undefined' && window.__LEXIE_ZERO_DELAY_MODE__) {
      console.log('🚀 [UNSHIELD] Zero-Delay mode active - bypassing spendable balance checks');
    }

    // RELAYER MODE: Prepare recipients with broadcaster fee
    let erc20AmountRecipients;
    let broadcasterFeeERC20AmountRecipient = null;
    
    if (useRelayer) {
      console.log('🔧 [UNSHIELD] Preparing RelayAdapt mode with broadcaster fee...');
      
      // Calculate relayer fee (e.g., 0.5% of transaction amount)
      const feePercentage = 0.005; // 0.5%
      const feeAmount = BigInt(Math.floor(Number(amount) * feePercentage));
      const userAmount = BigInt(amount) - feeAmount;
      
      console.log('💰 [UNSHIELD] Fee calculation:', {
        totalAmount: amount,
        userAmount: userAmount.toString(),
        feeAmount: feeAmount.toString(),
        feePercentage: (feePercentage * 100) + '%'
      });
      
      // User recipient gets amount minus fee
      const userRecipient = createERC20AmountRecipient(tokenAddress, userAmount, toAddress);
      
      // Broadcaster fee recipient (relayer EOA)
      const RELAYER_EOA_ADDRESS = await getRelayerAddress(); // Get from relayer service
      broadcasterFeeERC20AmountRecipient = createERC20AmountRecipient(tokenAddress, feeAmount, RELAYER_EOA_ADDRESS);
      
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] RelayAdapt recipients prepared:', {
        userRecipient: { amount: userAmount.toString(), to: toAddress },
        broadcasterFee: { amount: feeAmount.toString(), to: RELAYER_EOA_ADDRESS },
        mode: 'RelayAdapt'
      });
      
    } else {
      // SELF-SIGNING MODE: No fees, user gets full amount
      console.log('🔧 [UNSHIELD] Preparing self-signing mode (no fees)...');
      
      const userRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
        userRecipient: { amount: amount, to: toAddress },
        mode: 'self-signing'
      });
    }

    // STEP 5: Dummy proof dry-run for accurate gas estimation
    console.log('📝 [UNSHIELD] Step 5a: Running dummy proof for gas estimation...');
    
    const networkName = getRailgunNetworkName(chain.id);
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    // Create gas details structure for proof generation
    let originalGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        originalGasDetails = {
          evmGasType,
          gasEstimate: 0n,
          gasPrice: BigInt('0x100000'),
        };
        break;
      case EVMGasType.Type2:
        originalGasDetails = {
          evmGasType,
          gasEstimate: 0n,
          maxFeePerGas: BigInt('0x100000'),
          maxPriorityFeePerGas: BigInt('0x010000'),
        };
        break;
      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }
    
    // Create dummy recipients for gas estimation matching real transaction mode
    const dummyRecipients = [...erc20AmountRecipients];
    const dummyBroadcasterFee = useRelayer ? broadcasterFeeERC20AmountRecipient : null;
    
    console.log('🧮 [UNSHIELD] Running dummy proof for accurate gas estimation...');
    
    try {
      // Generate dummy proof to get accurate gas estimate
      const dummyProof = await generateUnshieldProof(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        dummyRecipients,
        [], // nftAmountRecipients
        dummyBroadcasterFee, // Match real transaction broadcaster fee setup
        sendWithPublicWallet,
        undefined, // overallBatchMinGasPrice
        (progress, status) => {
          console.log(`📊 [UNSHIELD] Dummy Proof Progress: ${progress.toFixed(2)}% | ${status}`);
        } // progressCallback
      );
      
      var accurateGasEstimate = dummyProof.gasEstimate || BigInt('300000'); // Fallback estimate
      console.log('✅ [UNSHIELD] Dummy proof completed, gas estimate:', accurateGasEstimate.toString());
      
    } catch (dummyError) {
      console.warn('⚠️ [UNSHIELD] Dummy proof failed, using fallback gas estimate:', dummyError.message);
      var accurateGasEstimate = BigInt('300000'); // Fallback if dummy proof fails
    }
    
    console.log('📝 [UNSHIELD] Step 5b: Generating real unshield proof with accurate gas...');
    
    console.log('🔧 [UNSHIELD] Real proof mode:', {
      sendWithPublicWallet,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing'
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
      sendWithPublicWallet,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      broadcasterAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString() || 'null'
    };

    console.log('🔍 [UNSHIELD] PUBINPUTS - Proof step:', { step: 'proof', ...proofFP });
    
    console.log('📝 [UNSHIELD] Generating proof with recipients:', {
      userRecipients: erc20AmountRecipients.length,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing',
      sendWithPublicWallet
    });
    
    // Generate proof with correct mode and broadcaster fee
    const proofResponse = await generateUnshieldProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients,
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient, // null for self-signing, fee object for RelayAdapt
      sendWithPublicWallet, // false for RelayAdapt, true for self-signing
      undefined, // overallBatchMinGasPrice
      (progress, status) => {
        console.log(`📊 [UNSHIELD] Real Proof Progress: ${progress.toFixed(2)}% | ${status}`);
      } // progressCallback
    );
    
    // Use the accurate gas estimate from dummy proof
    const finalGasEstimate = accurateGasEstimate;
    console.log('✅ [UNSHIELD] Proof generation completed:', {
      gasEstimate: finalGasEstimate.toString(),
      evmGasType,
      hasProof: !!proofResponse,
    });

    // Get REAL gas prices from network for the actual transaction
    console.log('💰 [UNSHIELD] Getting real gas prices from network...');
    let realGasDetails;
    
    try {
      // Get current network gas prices
      const signer = await walletProvider();
      console.log('💰 [UNSHIELD] Signer created, checking provider...');
      
      if (!signer || !signer.provider) {
        throw new Error('No provider available from signer');
      }
      
      const provider = signer.provider;
      console.log('💰 [UNSHIELD] Getting fee data from provider...');
      const feeData = await provider.getFeeData();
      
      console.log('💰 [UNSHIELD] Network gas prices:', {
        gasPrice: feeData.gasPrice?.toString(),
        maxFeePerGas: feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
        hasValidData: !!(feeData.maxFeePerGas && feeData.maxPriorityFeePerGas)
      });
      
      // Validate that we got reasonable gas prices
      if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas) {
        throw new Error('Invalid fee data received from provider');
      }
      
      // Ensure priority fee is not higher than max fee
      if (feeData.maxPriorityFeePerGas > feeData.maxFeePerGas) {
        console.warn('⚠️ [UNSHIELD] Priority fee higher than max fee, adjusting...');
        feeData.maxPriorityFeePerGas = feeData.maxFeePerGas / 2n; // Set to half of max fee
      }
      
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          realGasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate,
            gasPrice: feeData.gasPrice || BigInt('100000000'), // 0.1 gwei fallback for Arbitrum
          };
          break;
        case EVMGasType.Type2:
          realGasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate,
            maxFeePerGas: feeData.maxFeePerGas || BigInt('200000000'), // 0.2 gwei for Arbitrum
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt('100000000'), // 0.1 gwei for Arbitrum
          };
          break;
      }
      
    } catch (gasError) {
      console.warn('⚠️ [UNSHIELD] Failed to get network gas prices, using fallback:', gasError.message);
      // Fallback to higher values than dummy
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          realGasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate,
            gasPrice: BigInt('100000000'), // 0.1 gwei for Arbitrum
          };
          break;
        case EVMGasType.Type2:
          realGasDetails = {
            evmGasType,
            gasEstimate: finalGasEstimate,
            maxFeePerGas: BigInt('200000000'), // 0.2 gwei for Arbitrum
            maxPriorityFeePerGas: BigInt('100000000'), // 0.1 gwei for Arbitrum
          };
          break;
      }
    }
    
    const gasDetails = realGasDetails;

    // STEP 6: Populate transaction using generated proof
    console.log('📝 [UNSHIELD] Step 6: Populating transaction with proof...');
    
    // PUBLIC INPUTS FINGERPRINTING - Populate Step
    const populateFP = {
      token: tokenAddress.toLowerCase(),
      recipients: canonRecipients(erc20AmountRecipients),
      sendWithPublicWallet,
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
      sendWithPublicWallet, // expect false for relayer mode
      relayAdaptExpected: useRelayer ? '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9' : 'N/A',
      merkleRoot: proofResponse?.publicInputs?.merkleRoot?.toString() ?? '<n/a>',
      nullifiers: proofResponse?.nullifiers?.map(x => x.toString()) ?? [],
      recipientsFingerprint: canonRecipients(erc20AmountRecipients),
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      relayerFeeAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString() || '0',
      proofGenerated: !!proofResponse,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing'
    });
    
    const populatedTransaction = await populateProvedUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      erc20AmountRecipients, // Same user recipients as used in proof generation
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient, // null - no broadcaster fee
      sendWithPublicWallet, // true - self-signing format
      undefined, // overallBatchMinGasPrice (not needed)
      gasDetails
    );

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
        const feeDetails = useRelayer && broadcasterFeeERC20AmountRecipient ? {
          relayerFee: broadcasterFeeERC20AmountRecipient.amount.toString(),
          protocolFee: '0',
          totalFee: broadcasterFeeERC20AmountRecipient.amount.toString()
        } : { relayerFee: '0', protocolFee: '0', totalFee: '0' };
        
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

    console.log('🎉 [UNSHIELD] Transaction completed successfully!', {
      transactionHash,
      usedRelayer,
      privacyLevel,
    });

    // STEP 8: Start transaction monitoring
    if (transactionHash && typeof transactionHash === 'string' && transactionHash.startsWith('0x')) {
      console.log('🔍 [UNSHIELD] Starting transaction monitoring...');
      
      try {
        const { monitorTransactionInGraph } = await import('./transactionMonitor.js');
        
        // Get token decimals and symbol
        let tokenDecimals = decimals || 18;
        let tokenSymbol = 'Unknown';
        
        if (decimals !== undefined && decimals !== null) {
          tokenDecimals = decimals;
          console.log('✅ [UNSHIELD] Using decimals from UI:', tokenDecimals);
        } else {
          const knownToken = getKnownTokenDecimals(tokenAddress, chain.id);
          if (knownToken) {
            tokenDecimals = knownToken.decimals;
            tokenSymbol = knownToken.symbol;
            console.log('🔧 [UNSHIELD] Using known token info:', { tokenDecimals, tokenSymbol });
          }
        }

        // Start monitoring (non-blocking)
        monitorTransactionInGraph({
          txHash: transactionHash,
          chainId: chain.id,
          transactionType: 'unshield',
          transactionDetails: {
            amount,
            tokenAddress,
            tokenSymbol,
            toAddress,
            walletAddress,
            walletId: railgunWalletID,
            decimals: tokenDecimals,
          },
          listener: (event) => {
            console.log(`🎉 [UNSHIELD] Transaction ${transactionHash} confirmed!`);
          }
        }).catch(monitorError => {
          console.warn('⚠️ [UNSHIELD] Transaction monitoring failed:', monitorError.message);
        });
        
      } catch (importError) {
        console.warn('⚠️ [UNSHIELD] Could not start transaction monitoring:', importError.message);
      }
    }

    return {
      transactionHash,
      usedRelayer,
      privacyLevel,
    };

  } catch (error) {
    console.error('💥 [UNSHIELD] Transaction failed:', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

export default {
  unshieldTokens,
};

