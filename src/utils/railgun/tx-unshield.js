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

/**
 * Get selected relayer details for SDK integration
 */
const getSelectedRelayer = async () => {
  // TODO: Get from actual relayer service
  return {
    railgunAddress: "0zk1q8hqg5sa7v0a0adn6e9pqyj3z0pdp2g3m4ndu74qt9rc2648u72fptdr7j6fe3253lauu1erv2t7tvsk4m0t9sqv94mr0k4tksrxep2n38xdd2akc75qjyrenxn", // RAILGUN address
    feePerUnitGas: BigInt('1000000000'), // 1 gwei
  };
};

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
    
    // CRITICAL: SDK handles protocol fee automatically - don't subtract it manually
    const UNSHIELD_FEE_BPS = 25n; // 25 basis points = 0.25% (handled by SDK)
    const RELAYER_FEE_BPS = 50n; // 50 basis points = 0.5%
    const MIN_GAS_LIMIT = 2400000n; // Consistent gas limit for cross-contract calls
    
    const unshieldIn = BigInt(amount); // What we pass to RelayAdapt
    // SDK automatically deducts 0.25% protocol fee, leaving afterFee available
    const afterFee = (unshieldIn * (10000n - UNSHIELD_FEE_BPS)) / 10000n;
    
    let relayerFeeBn = 0n;
    let recipientBn = afterFee;
    
    if (useRelayer) {
      console.log('🔧 [UNSHIELD] Preparing RelayAdapt mode with cross-contract calls...');
      
      // Calculate relayer fee from after-fee amount (pure BigInt)
      relayerFeeBn = (afterFee * RELAYER_FEE_BPS) / 10000n;
      recipientBn = afterFee - relayerFeeBn;
      
      console.log('💰 [UNSHIELD] SDK-compatible fee calculation:', {
        unshieldIn: unshieldIn.toString(),
        afterFee: afterFee.toString(), // Available after SDK's 0.25% deduction
        relayerFeeBn: relayerFeeBn.toString(),
        recipientBn: recipientBn.toString(),
        verification: `${recipientBn.toString()} + ${relayerFeeBn.toString()} = ${(recipientBn + relayerFeeBn).toString()}`
      });
      // Assertions (before proof/populate)
      if (recipientBn <= 0n) {
        throw new Error(`Recipient amount must be > 0. Got: ${recipientBn.toString()}`);
      }
      if (recipientBn + relayerFeeBn !== afterFee) {
        throw new Error(`Math error: recipient (${recipientBn.toString()}) + relayer fee (${relayerFeeBn.toString()}) != afterFee (${afterFee.toString()})`);
      }
      
      // CRITICAL ISSUE: For RelayAdapt (UnshieldBaseToken), the TypeScript implementation shows:
      // 1. erc20AmountRecipients contains the user recipient (full amount to user's address)
      // 2. relayAdaptUnshieldERC20Amounts is used (not regular unshield)
      // 3. broadcasterFeeERC20AmountRecipient is separate
      
      // TODO: This needs to be refactored to use UnshieldBaseToken pattern
      // For now, keeping existing pattern but with corrected recipients
      
      // For RelayAdapt: use official SDK pattern with feeTokenDetails + relayerFeeTokenAmountRecipient
      const selectedRelayer = await getSelectedRelayer(); // Get from relayer service
      
      // SDK handles relayer fee via RAILGUN's internal mechanism
      broadcasterFeeERC20AmountRecipient = {
        tokenAddress,
        recipientAddress: selectedRelayer.railgunAddress, // RAILGUN address, not EOA
        amount: relayerFeeBn,
      };
      
      console.log('🔍 [UNSHIELD] CRITICAL - Broadcaster fee setup:', {
        feeRecipient: selectedRelayer.railgunAddress,
        relayerFeeBn: relayerFeeBn.toString(),
        tokenAddress: tokenAddress,
        purpose: 'RAILGUN_BROADCASTER_FEE_VIA_SDK'
      });
      
      // RAILGUN protocol fee is deducted by SDK automatically
      console.log('🔍 [UNSHIELD] RAILGUN Protocol Fee:', {
        unshieldFee: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(),
        purpose: 'RAILGUN_PROTOCOL_FEE_DEDUCTED_BY_SDK',
        note: 'This fee is handled internally by RAILGUN SDK, not as separate recipient'
      });
      
      // Note: erc20AmountRecipients is not used in cross-contract calls mode
      // Instead, we use relayAdaptUnshieldERC20Amounts + crossContractCalls
      erc20AmountRecipients = [];
      
      console.log('📝 [UNSHIELD] RelayAdapt recipients prepared:', {
        recipientAmount: { amount: recipientBn.toString(), to: toAddress },
        broadcasterFee: { amount: relayerFeeBn.toString(), to: selectedRelayer.railgunAddress },
        unshieldFee: { amount: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
        mode: 'RelayAdapt_CrossContractCalls_Official_Pattern'
      });
      
    } else {
      // SELF-SIGNING MODE: Only SDK's unshield fee applies (relayer fee is 0)
      console.log('🔧 [UNSHIELD] Preparing self-signing mode (with SDK unshield fee)...');
      
      console.log('💰 [UNSHIELD] Self-signing fee calculation:', {
        unshieldIn: unshieldIn.toString(),
        afterFee: afterFee.toString(), // Same as recipientBn for self-signing
        unshieldFee: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(),
        railgunFeePercent: '0.25%',
        noRelayerFee: true
      });
      
      const userRecipient = createERC20AmountRecipient(tokenAddress, recipientBn, toAddress);
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
        userRecipient: { amount: recipientBn.toString(), to: toAddress },
        unshieldFee: { amount: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
        mode: 'self-signing-with-unshield-fee'
      });
    }

    // STEP 5: Official RAILGUN gas estimation using SDK
    console.log('📝 [UNSHIELD] Step 5: Running official RAILGUN gas estimation...');
    
    const networkName = getRailgunNetworkName(chain.id);
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    // Create original gas details with EXACT official docs pattern
    let originalGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n, // CRITICAL: Must be originalGasEstimate, not gasEstimate
          gasPrice: BigInt('0x100000'), // 1.048M wei (~1 gwei) - official docs value
        };
        break;
      case EVMGasType.Type2:
        originalGasDetails = {
          evmGasType,
          originalGasEstimate: 0n, // CRITICAL: Must be originalGasEstimate, not gasEstimate
          maxFeePerGas: BigInt('0x100000'), // 1.048M wei (~1 gwei) - official docs value
          maxPriorityFeePerGas: BigInt('0x010000'), // 65K wei (~0.065 gwei) - official docs value
        };
        break;
      default:
        throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
    }
    
    console.log('🧮 [UNSHIELD] Attempting official gas estimation with correct method...');
    
    var accurateGasEstimate;
    try {
      if (useRelayer) {
        // For RelayAdapt mode, use cross-contract calls gas estimation
        console.log('🧮 [UNSHIELD] Using gasEstimateForUnprovenCrossContractCalls for RelayAdapt...');
        
        const { gasEstimateForUnprovenCrossContractCalls } = await import('@railgun-community/wallet');
        
        // CRITICAL: RelayAdapt unshields the input amount, SDK deducts 0.25%
        // RelayAdapt unshield amounts - input amount to SDK
        const relayAdaptUnshieldERC20Amounts = [{
          tokenAddress,
          amount: unshieldIn, // Amount passed to SDK (before SDK's 0.25% deduction)
        }];
        
        // Assertion: after-fee spend matches available amount
        const totalSpend = recipientBn + relayerFeeBn;
        if (totalSpend !== afterFee) {
          throw new Error(`Spend mismatch: spend ${totalSpend.toString()} != afterFee ${afterFee.toString()}`);
        }
        
        // Create feeTokenDetails for official SDK pattern
        const feeTokenDetails = {
          tokenAddress,
          feePerUnitGas: selectedRelayer.feePerUnitGas, // From relayer service
        };
        
        // Create single cross-contract call: Only forward afterFee amount to recipient
        // (SDK handles relayer fee payment internally via broadcasterFeeERC20AmountRecipient)
        const { ethers } = await import('ethers');
        const erc20Interface = new ethers.Interface([
          'function transfer(address to, uint256 amount) returns (bool)'
        ]);
        
        // Single call: Forward afterFee amount FROM RelayAdapt to final recipient
        const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
          toAddress, // Final recipient
          afterFee // Forward FULL afterFee amount (SDK deducts relayer fee separately)
        ]);
        
        const crossContractCalls = [{
          to: tokenAddress, // USDC contract  
          data: recipientCallData,
          value: '0x0',
          requireSuccess: true, // Revert if recipient transfer fails
        }];
        
        const minGasLimit = MIN_GAS_LIMIT; // Consistent with proof generation
        const gasEstimateResponse = await gasEstimateForUnprovenCrossContractCalls(
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          railgunWalletID,
          encryptionKey,
          relayAdaptUnshieldERC20Amounts, // Unshield to RelayAdapt
          [], // nftAmounts
          [], // shieldERC20Recipients
          [], // shieldNFTRecipients
          crossContractCalls, // Single transfer call (recipient only)
          originalGasDetails,
          feeTokenDetails, // Official SDK pattern for relayer fees
          sendWithPublicWallet,
          minGasLimit
        );
        
        accurateGasEstimate = gasEstimateResponse.gasEstimate;
        console.log('✅ [UNSHIELD] Cross-contract calls gas estimation completed:', {
          gasEstimate: accurateGasEstimate.toString(),
          evmGasType,
          sendWithPublicWallet,
          method: 'gasEstimateForUnprovenCrossContractCalls'
        });
        
      } else {
        // For self-signing mode, use regular Unshield gas estimation
        console.log('🧮 [UNSHIELD] Using gasEstimateForUnprovenUnshield for self-signing...');
        
        const { gasEstimateForUnprovenUnshield } = await import('@railgun-community/wallet');
        
        const gasEstimateResponse = await gasEstimateForUnprovenUnshield(
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          railgunWalletID,
          encryptionKey,
          erc20AmountRecipients,
          [], // nftAmountRecipients
          originalGasDetails,
          null, // feeTokenDetails - not needed for our use case
          sendWithPublicWallet
        );
        
        accurateGasEstimate = gasEstimateResponse.gasEstimate;
        console.log('✅ [UNSHIELD] Regular Unshield gas estimation completed:', {
          gasEstimate: accurateGasEstimate.toString(),
          evmGasType,
          sendWithPublicWallet,
          method: 'gasEstimateForUnprovenUnshield'
        });
      }
      
    } catch (gasError) {
      console.warn('⚠️ [UNSHIELD] Official gas estimation failed, using conservative fallback:', gasError.message);
      
      // Use very high conservative gas estimates for complex SNARK verification
      if (useRelayer) {
        accurateGasEstimate = BigInt('2000000'); // Very high for RelayAdapt SNARK verification (2M gas)
      } else {
        accurateGasEstimate = BigInt('1200000'); // High for self-signing SNARK verification (1.2M gas)
      }
      
      console.log('📊 [UNSHIELD] Using fallback gas estimate:', {
        gasEstimate: accurateGasEstimate.toString(),
        reason: 'official-estimation-failed',
        mode: useRelayer ? 'relayer' : 'self-signing'
      });
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
    
    // Generate proof with correct type based on transaction mode
    let proofResponse;
    
    if (useRelayer) {
      console.log('🔐 [UNSHIELD] Generating cross-contract calls proof for RelayAdapt mode...');
      
      // Import the cross-contract calls proof generation function
      const { generateCrossContractCallsProof } = await import('@railgun-community/wallet');
      
      // CRITICAL: RelayAdapt unshields the input amount, SDK deducts 0.25%
      // RelayAdapt unshield amounts - input amount to SDK
      const relayAdaptUnshieldERC20Amounts = [{
        tokenAddress,
        amount: unshieldIn, // Amount passed to SDK (before SDK's 0.25% deduction)
      }];
      
      // Create single cross-contract call: Only forward afterFee amount to recipient
      // (SDK handles relayer fee payment internally via broadcasterFeeERC20AmountRecipient)
      const { ethers } = await import('ethers');
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)'
      ]);
      
      // Single call: Forward afterFee amount FROM RelayAdapt to final recipient
      const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
        toAddress, // Final recipient
        afterFee // Forward FULL afterFee amount (SDK deducts relayer fee separately)
      ]);
      
      const crossContractCalls = [{
        to: tokenAddress, // USDC contract  
        data: recipientCallData,
        value: '0x0',
        requireSuccess: true, // Revert if recipient transfer fails
      }];
      
      proofResponse = await generateCrossContractCallsProof(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        relayAdaptUnshieldERC20Amounts, // Unshield to RelayAdapt
        [], // nftAmounts
        [], // shieldERC20Recipients
        [], // shieldNFTRecipients
        crossContractCalls, // Single transfer call (recipient only)
        broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
        sendWithPublicWallet, // false for RelayAdapt
        BigInt('1000000000'), // overallBatchMinGasPrice
        MIN_GAS_LIMIT, // minGasLimit for cross-contract calls (matches estimation)
        (progress) => {
          console.log(`📊 [UNSHIELD] Cross-contract calls Proof Progress: ${(progress * 100).toFixed(2)}%`);
        } // progressCallback
      );
      
      console.log('✅ [UNSHIELD] Cross-contract calls proof generated for RelayAdapt mode');
      
    } else {
      console.log('🔐 [UNSHIELD] Generating regular Unshield proof for self-signing mode...');
      
      // For self-signing, use regular unshield proof
      proofResponse = await generateUnshieldProof(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        erc20AmountRecipients, // User recipients (amount minus protocol fee)
        [], // nftAmountRecipients
        undefined, // No broadcaster fee for self-signing
        sendWithPublicWallet, // true for self-signing
        undefined, // overallBatchMinGasPrice
        (progress, status) => {
          console.log(`📊 [UNSHIELD] Regular Unshield Proof Progress: ${progress.toFixed(2)}% | ${status}`);
        } // progressCallback
      );
      
      console.log('✅ [UNSHIELD] Regular Unshield proof generated for self-signing mode');
    }
    
    // Use the accurate gas estimate from official SDK
    const finalGasEstimate = accurateGasEstimate;
    console.log('✅ [UNSHIELD] Proof generation completed:', {
      gasEstimate: finalGasEstimate.toString(),
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
        gasPriceFallback = BigInt('20000000000'); // 20 gwei
        maxFeeFallback = BigInt('25000000000'); // 25 gwei
        priorityFeeFallback = BigInt('2000000000'); // 2 gwei
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
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            gasPrice: networkGasPrices?.gasPrice || gasPriceFallback,
          };
          break;
        case EVMGasType.Type2:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            maxFeePerGas: networkGasPrices?.maxFeePerGas || maxFeeFallback,
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
      } else {
        gasPriceFallback = BigInt('5000000000'); // 5 gwei
        maxFeeFallback = BigInt('6000000000'); // 6 gwei
        priorityFeeFallback = BigInt('1000000000'); // 1 gwei
      }
      
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            gasPrice: gasPriceFallback,
          };
          break;
        case EVMGasType.Type2:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            maxFeePerGas: maxFeeFallback,
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
    
    // CRITICAL: Use correct populate function based on transaction mode
    let populatedTransaction;
    
    if (useRelayer) {
      console.log('🔧 [UNSHIELD] Using cross-contract calls for proper RelayAdapt forwarding...');
      
      // Import the cross-contract calls function
      const { populateProvedCrossContractCalls } = await import('@railgun-community/wallet');
      
      console.log('💰 [UNSHIELD] RelayAdapt SDK-compatible calculation:', {
        unshieldIn: unshieldIn.toString(),
        afterFee: afterFee.toString(), // Available after SDK's 0.25% deduction
        relayerFeeBn: relayerFeeBn.toString(),
        recipientBn: recipientBn.toString(),
        verification: `${recipientBn.toString()} + ${relayerFeeBn.toString()} = ${(recipientBn + relayerFeeBn).toString()}`
      });
      
      // RelayAdapt unshield amounts - input amount to SDK
      const relayAdaptUnshieldERC20Amounts = [{
        tokenAddress,
        amount: unshieldIn, // Amount passed to SDK (before SDK's 0.25% deduction)
      }];
      
      // Invariant: after-fee spend matches available amount
      const totalSpend = recipientBn + relayerFeeBn;
      if (totalSpend !== afterFee) {
        throw new Error(`Spend mismatch: spend ${totalSpend.toString()} != afterFee ${afterFee.toString()}`);
      }
      
      // Create single cross-contract call: Only forward afterFee amount to recipient
      // (SDK handles relayer fee payment internally via broadcasterFeeERC20AmountRecipient)
      const { ethers } = await import('ethers');
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)'
      ]);
      
      // Single call: Forward afterFee amount FROM RelayAdapt to final recipient
      const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
        toAddress, // Final recipient
        afterFee // Forward FULL afterFee amount (SDK deducts relayer fee separately)
      ]);
      
      const crossContractCalls = [{
        to: tokenAddress, // USDC contract  
        data: recipientCallData,
        value: '0x0',
        requireSuccess: true, // Revert if recipient transfer fails
      }];
      
      console.log('🔧 [UNSHIELD] Cross-contract transfer call created:', {
        to: tokenAddress,
        recipientCall: { recipient: toAddress, amount: afterFee.toString() },
        relayerFeeViaSDK: { recipient: broadcasterFeeERC20AmountRecipient.recipientAddress, amount: relayerFeeBn.toString() },
        unshieldIn: unshieldIn.toString(),
        afterFee: afterFee.toString(),
        totalCalls: crossContractCalls.length,
        pattern: 'Official_SDK_Pattern',
        requireSuccess: true
      });
      
      populatedTransaction = await populateProvedCrossContractCalls(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        relayAdaptUnshieldERC20Amounts, // Unshield to RelayAdapt
        [], // nftAmounts
        [], // shieldERC20Recipients 
        [], // shieldNFTRecipients
        crossContractCalls, // Single transfer call (recipient only)
        broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
        sendWithPublicWallet,
        BigInt('1000000000'), // overallBatchMinGasPrice
        gasDetails
      );
      
      console.log('✅ [UNSHIELD] RelayAdapt transaction populated using cross-contract calls');
      
    } else {
      console.log('🔧 [UNSHIELD] Using populateProvedUnshield for self-signing mode...');
      
      // For self-signing, use regular unshield
      populatedTransaction = await populateProvedUnshield(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        erc20AmountRecipients, // User recipients (amount minus protocol fee)
        [], // nftAmountRecipients - empty for regular unshield
        undefined, // No broadcaster fee for self-signing
        sendWithPublicWallet, // true for self-signing
        undefined, // overallBatchMinGasPrice - not needed for self-signing
        gasDetails
      );
      
      console.log('✅ [UNSHIELD] Self-signing transaction populated using regular Unshield proof type');
    }

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
    
    // Decode CallError for better debugging
    try {
      if (error.data && typeof error.data === 'string') {
        const errorData = error.data;
        
        // Check for standard Error(string) revert (0x08c379a0)
        if (errorData.startsWith('0x08c379a0')) {
          const { ethers } = await import('ethers');
          try {
            const decodedError = ethers.AbiCoder.defaultAbiCoder().decode(
              ['string'],
              '0x' + errorData.slice(10) // Remove 0x08c379a0
            );
            console.error('🔍 [UNSHIELD] Decoded revert reason:', decodedError[0]);
            
            // Check for specific ERC20 errors
            if (decodedError[0].includes('transfer amount exceeds balance')) {
              console.error('⚠️ [UNSHIELD] RelayAdapt balance insufficient - check amount calculation!');
              console.error('💡 [UNSHIELD] Verify: unshieldAmount == transferAmount (no overshoot)');
            }
            if (decodedError[0].includes('insufficient allowance')) {
              console.error('⚠️ [UNSHIELD] ERC20 allowance issue - check token approval');
            }
          } catch (decodeError) {
            console.error('🔍 [UNSHIELD] Failed to decode error:', decodeError);
          }
        } else {
          console.error('🔍 [UNSHIELD] Raw error data:', errorData);
        }
      }
    } catch (decodeError) {
      console.error('🔍 [UNSHIELD] Error decoding failed:', decodeError);
    }
    
    throw error;
  }
};

export default {
  unshieldTokens,
};

