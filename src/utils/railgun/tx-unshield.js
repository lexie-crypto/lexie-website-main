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

    // STEP 4: Determine transaction method and calculate recipients
    console.log('🔧 [UNSHIELD] Step 4: Determining transaction method...');
    
    const willUseGasRelayer = shouldUseRelayer(chain.id, amount);
    console.log(`💰 [UNSHIELD] Transaction method: ${willUseGasRelayer ? 'Gas Relayer (Anonymous)' : 'Self-Signing (Direct)'}`);

    // Check zero-delay mode
    if (typeof window !== 'undefined' && window.__LEXIE_ZERO_DELAY_MODE__) {
      console.log('🚀 [UNSHIELD] Zero-Delay mode active - bypassing spendable balance checks');
    }

    // Calculate recipients based on transaction method
    let erc20AmountRecipients = [];
    let gasRelayerFeeDetails = null;
    
    if (willUseGasRelayer) {
      try {
        console.log('💰 [GAS RELAYER] Calculating 0.5% relayer fee...');
        
        const relayerFeePercentage = 0.005; // 0.5%
        const relayerFeeAmount = BigInt(Math.floor(Number(amount) * relayerFeePercentage));
        const userAmountAfterFee = BigInt(amount) - relayerFeeAmount;
        
        const relayerAddress = await getRelayerAddress();
        
        // Create recipients: user gets reduced amount, relayer gets fee
        const userRecipient = createERC20AmountRecipient(
          tokenAddress,
          userAmountAfterFee.toString(),
          toAddress
        );
        
        // Keep only the user recipient in erc20AmountRecipients
        // Relayer fee will be passed separately as broadcasterFeeERC20AmountRecipient
        erc20AmountRecipients = [userRecipient];
        
        gasRelayerFeeDetails = {
          relayerFee: relayerFeeAmount.toString(),
          protocolFee: '0',
          gasFee: '0',
          totalFee: relayerFeeAmount.toString(),
          relayerAddress: relayerAddress // Store for later use
        };
        
        console.log('💰 [GAS RELAYER] Fee calculation completed:', {
          originalAmount: amount,
          userAmount: userAmountAfterFee.toString(),
          relayerFee: relayerFeeAmount.toString(),
          relayerAddress: relayerAddress.slice(0, 10) + '...',
        });
        
      } catch (relayerError) {
        console.error('❌ [GAS RELAYER] Fee calculation failed:', relayerError.message);
        console.log('🔄 [GAS RELAYER] Falling back to self-signing...');
        willUseGasRelayer = false;
      }
    }
    
    if (!willUseGasRelayer) {
      // Self-signing: single recipient gets full amount
      const userRecipient = createERC20AmountRecipient(tokenAddress, amount, toAddress);
      erc20AmountRecipients = [userRecipient];
    }

    // STEP 5: Generate proof first (PROVEN TRANSACTION FLOW)
    console.log('📝 [UNSHIELD] Step 5: Generating unshield proof...');
    
    const networkName = getRailgunNetworkName(chain.id);
    const sendWithPublicWallet = true; // Always true for our pattern
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
    
    // IMPORTANT: Prepare the relayer fee recipient BEFORE proof generation
    let broadcasterFeeERC20AmountRecipient = null;
    if (willUseGasRelayer && gasRelayerFeeDetails) {
      // This is the RAILGUN SDK expected format for relayer fees
      broadcasterFeeERC20AmountRecipient = {
        tokenAddress: tokenAddress,
        amount: BigInt(gasRelayerFeeDetails.relayerFee),
        recipientAddress: gasRelayerFeeDetails.relayerAddress
      };
      console.log('💰 [UNSHIELD] Broadcaster fee recipient prepared:', {
        tokenAddress,
        amount: gasRelayerFeeDetails.relayerFee,
        recipientAddress: gasRelayerFeeDetails.relayerAddress.slice(0, 10) + '...',
      });
    }
    
    console.log('📝 [UNSHIELD] Generating proof with recipients:', {
      userRecipients: erc20AmountRecipients.length,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient
    });
    
    // Generate proof - pass ALL recipients at once
    const proofResponse = await generateUnshieldProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      erc20AmountRecipients, // User recipients only (already reduced amount if using relayer)
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient, // Pass relayer fee HERE, not inside the function
      sendWithPublicWallet,
      undefined, // overallBatchMinGasPrice
      (progress, status) => {
        console.log(`📊 [UNSHIELD] Proof Progress: ${progress.toFixed(2)}% | ${status}`);
      } // progressCallback
    );
    
    // Extract gas estimate from proof response
    const finalGasEstimate = proofResponse.gasEstimate || BigInt('250000'); // Fallback estimate
    console.log('✅ [UNSHIELD] Proof generation completed:', {
      gasEstimate: finalGasEstimate.toString(),
      evmGasType,
      hasProof: !!proofResponse,
    });

    // Create final gas details with real estimate
    let gasDetails;
    switch (evmGasType) {
      case EVMGasType.Type0:
      case EVMGasType.Type1:
        gasDetails = {
          evmGasType,
          gasEstimate: finalGasEstimate,
          gasPrice: originalGasDetails.gasPrice,
        };
        break;
      case EVMGasType.Type2:
        gasDetails = {
          evmGasType,
          gasEstimate: finalGasEstimate,
          maxFeePerGas: originalGasDetails.maxFeePerGas,
          maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
        };
        break;
    }

    // STEP 6: Populate transaction using generated proof
    console.log('📝 [UNSHIELD] Step 6: Populating transaction with proof...');
    
    const populatedTransaction = await populateProvedUnshield(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      erc20AmountRecipients, // Same user recipients as used in proof generation
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient, // Same broadcaster fee as used in proof generation
      sendWithPublicWallet,
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
    
    if (willUseGasRelayer && gasRelayerFeeDetails) {
      console.log('🚀 [GAS RELAYER] Attempting submission via gas relayer...');
      
      try {
        // Check relayer health
        const relayerHealthy = await checkRelayerHealth();
        if (!relayerHealthy) {
          throw new Error('Gas relayer service is not available');
        }
        
        // Serialize transaction for relayer
        // The populatedTransaction.transaction is already a ContractTransaction
        const contractTransaction = populatedTransaction.transaction;
        
        if (!contractTransaction) {
          throw new Error('No transaction found in populated response');
        }
        
        const { ethers } = await import('ethers');
        console.log('🔧 [GAS RELAYER] Serializing transaction:', {
          to: contractTransaction.to,
          data: contractTransaction.data ? 'present' : 'missing',
          value: contractTransaction.value?.toString(),
          gasLimit: contractTransaction.gasLimit?.toString(),
        });
        
        // Create properly serialized transaction
        // Convert BigInt values to strings for JSON serialization
        const transactionObject = {
          to: contractTransaction.to,
          data: contractTransaction.data,
          value: contractTransaction.value ? contractTransaction.value.toString() : '0x0',
          gasLimit: contractTransaction.gasLimit ? contractTransaction.gasLimit.toString() : undefined,
          type: contractTransaction.type
        };
        
        console.log('🔧 [GAS RELAYER] Transaction object before serialization:', {
          to: transactionObject.to,
          dataLength: transactionObject.data?.length,
          value: transactionObject.value,
          gasLimit: transactionObject.gasLimit,
          type: transactionObject.type
        });
        
        // For the relayer, we'll send the transaction object as a JSON string
        // but mark it as a "serialized transaction" that the relayer can parse
        const serializedTransaction = '0x' + Buffer.from(JSON.stringify(transactionObject)).toString('hex');
        
        console.log('📤 [GAS RELAYER] Submitting serialized transaction...');
        
        const relayerResult = await submitRelayedTransaction({
          chainId: chain.id,
          serializedTransaction,
          tokenAddress,
          amount,
          userAddress: walletAddress,
          feeDetails: gasRelayerFeeDetails,
          gasEstimate: contractTransaction.gasLimit?.toString() // Pass actual gas estimate
        });
        
        transactionHash = relayerResult.transactionHash;
        usedRelayer = true;
        privacyLevel = 'anonymous-eoa';
        
        console.log('✅ [GAS RELAYER] Transaction submitted successfully!', {
          transactionHash,
          privacyLevel,
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