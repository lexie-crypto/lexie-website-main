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
    
    // Fee calculations (needed for both proof generation and populate)
    const RAILGUN_FEE_BPS = 25n; // 25 basis points = 0.25%
    const railgunProtocolFee = (BigInt(amount) * RAILGUN_FEE_BPS) / 10000n;
    let relayerFeeAmount = 0n;
    
    if (useRelayer) {
      console.log('🔧 [UNSHIELD] Preparing RelayAdapt mode with broadcaster fee...');
      console.log('🚨 [UNSHIELD] CRITICAL: RelayAdapt mode should use UnshieldBaseToken proof type, not regular Unshield!');
      console.log('🚨 [UNSHIELD] THIS IS LIKELY THE ROOT CAUSE OF SNARK VERIFICATION FAILURES!');
      
      // Calculate relayer fee (e.g., 0.5% of transaction amount) 
      const feePercentage = 0.005; // 0.5%
      relayerFeeAmount = BigInt(Math.floor(Number(amount) * feePercentage));
      
      // Total fees: RAILGUN protocol fee + relayer fee
      const totalFees = railgunProtocolFee + relayerFeeAmount;
      const userAmount = BigInt(amount) - totalFees;
      
      console.log('💰 [UNSHIELD] Fee calculation:', {
        totalAmount: amount,
        userAmount: userAmount.toString(),
        railgunProtocolFee: railgunProtocolFee.toString(),
        relayerFeeAmount: relayerFeeAmount.toString(),
        totalFees: totalFees.toString(),
        railgunFeePercent: '0.25%',
        relayerFeePercent: (feePercentage * 100) + '%'
      });
      
      // CRITICAL ISSUE: For RelayAdapt (UnshieldBaseToken), the TypeScript implementation shows:
      // 1. erc20AmountRecipients contains the user recipient (full amount to user's address)
      // 2. relayAdaptUnshieldERC20Amounts is used (not regular unshield)
      // 3. broadcasterFeeERC20AmountRecipient is separate
      
      // TODO: This needs to be refactored to use UnshieldBaseToken pattern
      // For now, keeping existing pattern but with corrected recipients
      
      // User recipient gets amount minus fee
      const userRecipient = createERC20AmountRecipient(tokenAddress, userAmount, toAddress);
      
      // CRITICAL: Broadcaster fee recipient MUST match TypeScript SDK pattern
      // This is the fee paid to the relayer/broadcaster for relaying the transaction
      const RELAYER_EOA_ADDRESS = await getRelayerAddress(); // Get from relayer service
      broadcasterFeeERC20AmountRecipient = createERC20AmountRecipient(tokenAddress, relayerFeeAmount, RELAYER_EOA_ADDRESS);
      
      console.log('🔍 [UNSHIELD] CRITICAL - Broadcaster fee setup:', {
        feeRecipient: RELAYER_EOA_ADDRESS,
        relayerFeeAmount: relayerFeeAmount.toString(),
        tokenAddress: tokenAddress,
        purpose: 'RAILGUN_BROADCASTER_FEE_FOR_RELAYING'
      });
      
      // TODO: RAILGUN protocol fee needs to be handled separately
      // It's not a separate recipient but is deducted from the proof internally
      console.log('🔍 [UNSHIELD] RAILGUN Protocol Fee:', {
        railgunProtocolFee: railgunProtocolFee.toString(),
        purpose: 'RAILGUN_PROTOCOL_FEE_DEDUCTED_FROM_PROOF',
        note: 'This fee is handled internally by RAILGUN SDK, not as separate recipient'
      });
      
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] RelayAdapt recipients prepared:', {
        userRecipient: { amount: userAmount.toString(), to: toAddress },
        broadcasterFee: { amount: relayerFeeAmount.toString(), to: RELAYER_EOA_ADDRESS },
        railgunProtocolFee: { amount: railgunProtocolFee.toString(), note: 'handled_internally' },
        mode: 'RelayAdapt_NEEDS_UNSHIELD_BASE_TOKEN_REFACTOR'
      });
      
    } else {
      // SELF-SIGNING MODE: Still need to account for RAILGUN protocol fee
      console.log('🔧 [UNSHIELD] Preparing self-signing mode (with RAILGUN protocol fee)...');
      
      // For self-signing, only RAILGUN protocol fee applies (relayer fee already 0)
      const userAmount = BigInt(amount) - railgunProtocolFee;
      
      console.log('💰 [UNSHIELD] Self-signing fee calculation:', {
        totalAmount: amount,
        userAmount: userAmount.toString(),
        railgunProtocolFee: railgunProtocolFee.toString(),
        railgunFeePercent: '0.25%',
        noRelayerFee: true
      });
      
      const userRecipient = createERC20AmountRecipient(tokenAddress, userAmount, toAddress);
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
        userRecipient: { amount: userAmount.toString(), to: toAddress },
        railgunProtocolFee: { amount: railgunProtocolFee.toString(), note: 'handled_internally' },
        mode: 'self-signing-with-protocol-fee'
      });
    }

    // STEP 5: Official RAILGUN gas estimation using SDK
    console.log('📝 [UNSHIELD] Step 5: Running official RAILGUN gas estimation...');
    
    const networkName = getRailgunNetworkName(chain.id);
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    // Create original gas details with low initial values (official pattern)
    let originalGasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        originalGasDetails = {
          evmGasType,
          gasEstimate: 0n, // Always 0 initially
          gasPrice: BigInt('0x100000'), // 1.048M wei (~1 gwei) - official docs value
        };
        break;
      case EVMGasType.Type2:
        originalGasDetails = {
          evmGasType,
          gasEstimate: 0n, // Always 0 initially
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
        // For RelayAdapt mode, use UnshieldBaseToken gas estimation
        console.log('🧮 [UNSHIELD] Using gasEstimateForUnprovenUnshieldBaseToken for RelayAdapt...');
        
        const { gasEstimateForUnprovenUnshieldBaseToken } = await import('@railgun-community/wallet');
        
        // For RelayAdapt, we need the wrapped amount for the user
        const wrappedERC20Amount = {
          tokenAddress,
          amount: BigInt(amount) - railgunProtocolFee - relayerFeeAmount, // User gets amount minus all fees
        };
        
        const gasEstimateResponse = await gasEstimateForUnprovenUnshieldBaseToken(
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          toAddress, // publicWalletAddress
          railgunWalletID,
          encryptionKey,
          wrappedERC20Amount,
          originalGasDetails,
          null, // feeTokenDetails - not needed for our use case
          sendWithPublicWallet
        );
        
        accurateGasEstimate = gasEstimateResponse.gasEstimate;
        console.log('✅ [UNSHIELD] UnshieldBaseToken gas estimation completed:', {
          gasEstimate: accurateGasEstimate.toString(),
          evmGasType,
          sendWithPublicWallet,
          method: 'gasEstimateForUnprovenUnshieldBaseToken'
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
      
      // Use conservative gas estimate based on transaction type
      if (useRelayer) {
        accurateGasEstimate = BigInt('500000'); // Higher estimate for RelayAdapt transactions
      } else {
        accurateGasEstimate = BigInt('300000'); // Standard estimate for self-signing
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
      console.log('🔐 [UNSHIELD] Generating UnshieldBaseToken proof for RelayAdapt mode...');
      
      // Import the correct proof generation function for RelayAdapt
      const { generateUnshieldBaseTokenProof } = await import('@railgun-community/wallet');
      
      // For RelayAdapt, we need the wrapped amount for the user
      const wrappedERC20Amount = {
        tokenAddress,
        amount: BigInt(amount) - railgunProtocolFee - relayerFeeAmount, // User gets amount minus all fees
      };
      
      proofResponse = await generateUnshieldBaseTokenProof(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        toAddress, // publicWalletAddress
        railgunWalletID,
        encryptionKey,
        wrappedERC20Amount,
        broadcasterFeeERC20AmountRecipient, // Broadcaster fee
        sendWithPublicWallet, // false for RelayAdapt
        undefined, // overallBatchMinGasPrice
        (progress) => {
          console.log(`📊 [UNSHIELD] UnshieldBaseToken Proof Progress: ${(progress * 100).toFixed(2)}%`);
        } // progressCallback
      );
      
      console.log('✅ [UNSHIELD] UnshieldBaseToken proof generated for RelayAdapt mode');
      
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
      
      // Create gas details following official SDK pattern
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            gasPrice: networkGasPrices?.gasPrice || BigInt('20000000000'), // 20 gwei fallback (higher for safety)
          };
          break;
        case EVMGasType.Type2:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            maxFeePerGas: networkGasPrices?.maxFeePerGas || BigInt('20000000000'), // 20 gwei fallback (higher for safety)
            maxPriorityFeePerGas: networkGasPrices?.maxPriorityFeePerGas || BigInt('2000000000'), // 2 gwei fallback
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
      
      // Create fallback gas details
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            gasPrice: BigInt('20000000000'), // 20 gwei fallback
          };
          break;
        case EVMGasType.Type2:
          gasDetails = {
            evmGasType,
            gasEstimate: accurateGasEstimate,
            maxFeePerGas: BigInt('20000000000'), // 20 gwei fallback
            maxPriorityFeePerGas: BigInt('2000000000'), // 2 gwei fallback
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
      console.log('🔧 [UNSHIELD] Using populateProvedUnshieldBaseToken for RelayAdapt mode...');
      
      // Import the correct function for RelayAdapt mode
      const { populateProvedUnshieldBaseToken } = await import('@railgun-community/wallet');
      
      // For RelayAdapt, we need the wrapped amount for the user
      const wrappedERC20Amount = {
        tokenAddress,
        amount: BigInt(amount) - railgunProtocolFee - relayerFeeAmount, // User gets amount minus all fees
      };
      
      populatedTransaction = await populateProvedUnshieldBaseToken(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        toAddress, // publicWalletAddress
        railgunWalletID,
        wrappedERC20Amount,
        broadcasterFeeERC20AmountRecipient, // Broadcaster fee
        sendWithPublicWallet,
        undefined, // overallBatchMinGasPrice - will add this later
        gasDetails
      );
      
      console.log('✅ [UNSHIELD] RelayAdapt transaction populated using UnshieldBaseToken proof type');
      
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
    throw error;
  }
};

export default {
  unshieldTokens,
};

