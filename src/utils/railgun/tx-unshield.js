/**
 * RAILGUN Unshield Transactions - Clean Gas Relayer Pattern
 * - Single proof generation with correct recipients
 * - Gas relayer with public self-signing (stealth EOA)
 * - Clean fallback to user self-signing
 * - No Waku/broadcaster dependencies
 */

import React from 'react';
import { toast } from 'react-hot-toast';
import {
  populateProvedUnshield,
} from '@railgun-community/wallet';
import {
  gasEstimateForUnprovenTransfer,
  generateTransferProof,
  populateProvedTransfer,
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  getEVMGasTypeForTransaction,
  calculateGasPrice,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { assertNotSanctioned } from '../sanctions/chainalysis-oracle.js';

/**
 * Terminal-themed toast helper (no JSX; compatible with .js files)
 */
const showTerminalToast = (type, title, subtitle = '', opts = {}) => {
  // Allow calling with (type, title, opts) by detecting object in 3rd arg
  if (subtitle && typeof subtitle === 'object' && !Array.isArray(subtitle)) {
    opts = subtitle;
    subtitle = '';
  }
  const color = type === 'error' ? 'bg-red-400' : type === 'success' ? 'bg-emerald-400' : 'bg-yellow-400';
  
  // Create a unique ID for this toast
  const toastId = Date.now().toString();
  
  // Store the toast ID so we can dismiss it
  const id = toast.custom((t) => (
    React.createElement(
      'div',
      { className: `font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}` },
      React.createElement(
        'div',
        { className: 'rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl max-w-sm' },
        React.createElement(
          'div',
          { className: 'px-4 py-3 flex items-center gap-3' },
          [
            React.createElement('div', { key: 'dot', className: `h-3 w-3 rounded-full ${color}` }),
            React.createElement(
              'div',
              { key: 'text' },
              [
                React.createElement('div', { key: 'title', className: 'text-sm' }, title),
                subtitle ? React.createElement('div', { key: 'sub', className: 'text-xs text-green-400/80' }, subtitle) : null,
              ]
            ),
            React.createElement(
              'button',
              { 
                key: 'close', 
                type: 'button', 
                'aria-label': 'Dismiss', 
                onClick: (e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('[tx-unshield] Dismissing toast with ID:', toastId);
                  toast.dismiss(toastId);
                  // Force dismiss after short delay if first attempt doesn't work
                  setTimeout(() => toast.dismiss(toastId), 50);
                  setTimeout(() => toast.dismiss(), 100);
                }, 
                className: 'ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer' 
              },
              '×'
            )
          ]
        )
      )
    )
  ), { duration: type === 'error' ? 4000 : 2500, id: toastId, ...opts });
  
  return id;
};

// Gas Relayer Integration
import { 
  estimateRelayerFee, 
  submitRelayedTransaction, 
  shouldUseRelayer,
  checkRelayerHealth,
  getRelayerAddress,
} from './relayer-client.js';
import {
  gasEstimateForUnprovenUnshieldBaseToken,
  generateUnshieldBaseTokenProof,
  populateProvedUnshieldBaseToken,
} from '@railgun-community/wallet';

/**
 * Get selected relayer details for SDK integration
 */
const getSelectedRelayer = async (preferredFeeTokenAddress) => {
  // Fetch live RAILGUN address from relayer service
  try {
    // NOTE: recipient sanctions screening occurs after resolving recipient below
    const railgunAddress = await getRelayerAddress();
    return {
      railgunAddress, // MUST be '0zk…'
      feePerUnitGas: BigInt('1000000000'), // default 1 gwei; replace with quote when available
      // Prefer to pay fee in the same token we're unshielding
      feeToken: preferredFeeTokenAddress || "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    };
  } catch (e) {
    // Fall back to error; do not proceed with undefined/invalid address
    throw new Error(`Failed to retrieve relayer RAILGUN address: ${e.message}`);
  }
};

// Proof Generation
import { generateUnshieldProof } from './tx-proof-unshield.js';

/**
 * Resolve recipient input into a valid 0x address.
 * - Accepts an ENS name, 0x address, or Lexie ID
 * - Uses provided wallet provider (if available) to resolve ENS
 * - Resolves Lexie IDs to Railgun addresses via backend API
 */
const resolveRecipient = async (recipientInput, walletProvider) => {
  if (!recipientInput || typeof recipientInput !== 'string') return null;
  try {
    const { ethers } = await import('ethers');
    
    // Already a 0x address
    if (recipientInput.startsWith('0x') && ethers.isAddress(recipientInput)) {
      return recipientInput;
    }

    // Check if it's a Railgun address (0zk...)
    if (recipientInput.startsWith('0zk')) {
      console.log('🔎 [RESOLVE] Input is already a Railgun address:', recipientInput);
      return recipientInput;
    }

    const name = recipientInput.trim().toLowerCase();

    // Check if it's a Lexie ID (no @ prefix, alphanumeric)
    const lexieIdPattern = /^[a-zA-Z0-9_]{3,20}$/;
    if (lexieIdPattern.test(name)) {
      console.log('🔎 [RESOLVE] Attempting Lexie ID resolution:', name);
      try {
        // Call backend API to resolve Lexie ID to Railgun address
        const response = await fetch(`/api/wallet-metadata?action=lexie-resolve&lexieID=${encodeURIComponent(name)}`);
        const data = await response.json();
        
        if (data.success && data.walletAddress) {
          console.log('✅ [RESOLVE] Lexie ID resolved to Railgun address:', { 
            lexieID: name, 
            railgunAddress: data.walletAddress 
          });
          return data.walletAddress;
        } else {
          console.warn('⚠️ [RESOLVE] Lexie ID not found or not linked:', name);
          // Continue to ENS resolution
        }
      } catch (lexieError) {
        console.warn('⚠️ [RESOLVE] Lexie ID resolution failed:', lexieError.message);
        // Continue to ENS resolution
      }
    }

    // Try ENS resolution via connected provider first
    try {
      const signer = typeof walletProvider === 'function' ? await walletProvider() : undefined;
      const provider = signer?.provider;
      if (provider && !name.startsWith('0x')) {
        const resolved = await provider.resolveName(name);
        if (resolved && ethers.isAddress(resolved)) {
          console.log('🔎 [UNSHIELD] ENS resolved via connected provider:', { name, resolved });
          return resolved;
        }
      }
    } catch (e) {
      // continue to fallback
    }

    // Fallback: resolve ENS on Ethereum mainnet via proxied Alchemy or default provider
    try {
      let mainnetProvider;
      try {
        // Use our proxied RPC to avoid exposing keys
        const { JsonRpcProvider } = ethers;
        const origin = (typeof window !== 'undefined' ? window.location.origin : '');
        mainnetProvider = new JsonRpcProvider(origin + '/api/rpc?chainId=1&provider=auto');
      } catch (_) {
        mainnetProvider = ethers.getDefaultProvider('mainnet');
      }

      const resolved = await mainnetProvider.resolveName(name);
      if (resolved && ethers.isAddress(resolved)) {
        console.log('🔎 [UNSHIELD] ENS resolved via proxied mainnet provider:', { name, resolved });
        return resolved;
      }
    } catch (e2) {
      // fall through to return null
    }
  } catch (err) {
    // Silent fallthrough; caller will validate null
  }
  return null;
};

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

// Note management removed - SDK handles internally

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
  recipientAddress,
  // Backward-compat: support legacy param name
  toAddress,
  walletProvider,
  walletAddress,
  decimals,
}) => {
  console.log('🚀 [UNSHIELD] Starting unshield transaction...', {
    railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
    tokenAddress: tokenAddress?.substring(0, 10) + '...',
    amount,
    recipientParam: (recipientAddress ?? toAddress)?.substring?.(0, 10) + '...',
    chainId: chain.id,
    decimals,
  });

  // Track transient toasts to close them when the step completes
  let submittingToast = null;

  try {
    // Notify user that signing will be required
    const startToast = showTerminalToast('info', 'Preparing to remove funds from your vault', { duration: 4000 });
    // Validate required parameters (preliminary)
    if (!encryptionKey || !railgunWalletID || !amount || !walletAddress) {
      throw new Error('Missing required parameters');
    }

    // Resolve recipient once (ENS -> 0x or direct 0x)
    const recipientInput = recipientAddress ?? toAddress;
    const recipientEVM = await resolveRecipient(recipientInput, walletProvider);
    if (!recipientEVM) {
      throw new Error('Unshield requires a valid 0x recipient address');
    }
    const { ethers } = await import('ethers');
    if (!recipientEVM.startsWith('0x') || !ethers.isAddress(recipientEVM)) {
      throw new Error('Unshield requires a valid 0x recipient address');
    }

    // Sanctions screening on resolved recipient address (EOA)
    console.log('[Sanctions] Starting screening for resolved recipient (unshield):', {
      chainId: chain.id,
      resolved: recipientEVM?.slice?.(0, 12) + '...'
    });
    await assertNotSanctioned(chain.id, recipientEVM);
    console.log('[Sanctions] Screening passed for resolved recipient (unshield)');

    console.log('✅ [UNSHIELD] Resolved recipient:', { recipientEVM });
    try { toast.dismiss(startToast); } catch {}
    
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

    // STEP 3: SDK handles note selection internally

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

    // If unshielding base token (wETH unwrap): use base-token SDK path
    const isBaseToken = !tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000';
    if (isBaseToken) {
      console.log('🔧 [UNSHIELD] Base token flow: using SDK unshield base token');
      const networkName = getRailgunNetworkName(chain.id);

      // Prepare wrapped ERC20 amount object (tokenAddress must be the wrapped base token used privately)
      const wrappedERC20Amount = { tokenAddress, amount: BigInt(amount) };

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
        recipientEVM,
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
        recipientEVM,
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
        recipientEVM,
        railgunWalletID,
        wrappedERC20Amount,
        undefined,
        true,
        undefined,
        gasDetails,
      );

      // Submit using same path as self-signing (public wallet)
      const txHash = await submitTransactionSelfSigned(populateResponse, walletProvider);
      return { hash: txHash, method: 'base-token', privacy: 'public' };
    }

    // RELAYER MODE: Prepare recipients with broadcaster fee
    let erc20AmountRecipients;
    let broadcasterFeeERC20AmountRecipient = null;
    // Cross-contract (RelayAdapt) shared objects used across estimate → proof → populate
    let relayAdaptUnshieldERC20Amounts = undefined;
    let crossContractCalls = undefined;
    let relayAdaptShieldERC20Recipients = [];
    let relayAdaptShieldNFTRecipients = [];
    let relayAdaptUnshieldNFTAmounts = [];
    // Parity checksum across proof → populate
    let proofBundleString = null;
    
    // CRITICAL: SDK handles protocol fee automatically - don't subtract it manually
    const UNSHIELD_FEE_BPS = 25n; // 0.25%
    const RELAYER_FEE_BPS = 50n; // 0.5% (or from relayer quote)
    const MIN_GAS_LIMIT = 1600000n; // Lower floor - real txs land ~1.1-1.3M
    
    const unshieldIn = BigInt(amount); // what we unshield to RelayAdapt
    const afterFee = (unshieldIn * (10000n - UNSHIELD_FEE_BPS)) / 10000n; // spendable at RelayAdapt
    
    let relayerFeeBn = 0n;
    let recipientBn = afterFee;
    let feeTokenDetails = null;
    
    // SDK will validate balance internally
    
    if (useRelayer) {
      console.log('🔧 [UNSHIELD] Preparing RelayAdapt mode with cross-contract calls...');
      
      // CRITICAL: Select relayer once, reuse everywhere
      const selectedRelayer = await getSelectedRelayer(tokenAddress);
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
      
      // Relayer fee is paid PRIVATELY by the SDK to 0zk:
      relayerFeeBn = (afterFee * RELAYER_FEE_BPS) / 10000n;
      recipientBn = afterFee - relayerFeeBn; // <-- NET to recipient
      
      // Log: { unshieldIn, afterFee, relayerFeeBn, recipientBn } before calling the SDK
      console.log('💰 [UNSHIELD] Fee calculation before SDK calls:', {
        unshieldIn: unshieldIn.toString(),
        afterFee: afterFee.toString(),
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
      
      // Guard: Relayer must provide a valid 0zk address
      if (!selectedRelayer.railgunAddress?.startsWith('0zk')) {
        throw new Error('Invalid RAILGUN address for relayer');
      }

      // SDK handles relayer fee via RAILGUN's internal mechanism
      broadcasterFeeERC20AmountRecipient = {
        tokenAddress: selectedRelayer.feeToken,
        recipientAddress: selectedRelayer.railgunAddress, // RAILGUN address (0zk...)
        amount: relayerFeeBn,
      };
      
      // Create consistent objects for all SDK calls
      feeTokenDetails = {
        tokenAddress: selectedRelayer.feeToken,
        feePerUnitGas: selectedRelayer.feePerUnitGas,
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
        recipientAmount: { amount: recipientBn.toString(), to: recipientEVM },
        broadcasterFee: { amount: relayerFeeBn.toString(), to: selectedRelayer.railgunAddress },
        unshieldFee: { amount: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
        mode: 'RelayAdapt_CrossContractCalls_Official_Pattern'
      });

      // Hoist shared params for estimate -> proof -> populate
      relayAdaptUnshieldERC20Amounts = [{
        tokenAddress,
        amount: unshieldIn, // Gross into RelayAdapt; SDK deducts 0.25%
      }];

      const { ethers } = await import('ethers');
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)'
      ]);
      const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
        recipientEVM,
        afterFee, // Forward full after-fee amount; relayer fee is private output
      ]);
      crossContractCalls = [{
        to: tokenAddress,
        data: recipientCallData,
        value: 0n,
      }];
      
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
      
      // Hard guard: self-sign path must NOT provide a broadcaster fee
      if (broadcasterFeeERC20AmountRecipient !== null) {
        throw new Error('Internal error: broadcaster fee must be undefined for self-signing path');
      }
      const userRecipient = createERC20AmountRecipient(tokenAddress, recipientBn, recipientEVM);
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
        userRecipient: { amount: recipientBn.toString(), to: recipientEVM },
        unshieldFee: { amount: ((unshieldIn * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
        mode: 'self-signing-with-unshield-fee'
      });
    }

    // STEP 5: Official RAILGUN gas estimation using SDK
    console.log('📝 [UNSHIELD] Step 5: Running official RAILGUN gas estimation...');
    
    const networkName = getRailgunNetworkName(chain.id);
    const evmGasType = getEVMGasTypeForTransaction(networkName, sendWithPublicWallet);
    
    // Get current network gas prices for realistic originalGasDetails
    let originalGasDetails;
    try {
      const signer = await walletProvider();
      const provider = signer?.provider;
      let networkGasPrices = null;
      
      if (provider) {
        const feeData = await provider.getFeeData();
        networkGasPrices = feeData;
      }
      
      // Create original gas details based on network conditions
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let gasPrice = networkGasPrices?.gasPrice || BigInt('0x100000');
          // No special gas price floor for BNB - treat like other L2s
          originalGasDetails = {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice,
          };
          break;
        case EVMGasType.Type2:
          let maxFeePerGas = networkGasPrices?.maxFeePerGas || BigInt('0x100000');
          let maxPriorityFeePerGas = networkGasPrices?.maxPriorityFeePerGas || BigInt('0x010000');
          // No special gas price floor for BNB - treat like other L2s
          originalGasDetails = {
            evmGasType,
            originalGasEstimate: 0n,
            maxFeePerGas,
            maxPriorityFeePerGas,
          };
          break;
        default:
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }
      
      console.log('💰 [UNSHIELD] Original gas details with network prices:', {
        evmGasType,
        gasPrice: originalGasDetails.gasPrice?.toString(),
        maxFeePerGas: originalGasDetails.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas?.toString(),
        chainId: chain.id
      });
      
    } catch (gasError) {
      console.warn('⚠️ [UNSHIELD] Failed to get network gas prices, using fallbacks:', gasError.message);
      
      // Fallback to hardcoded values if network call fails
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
          throw new Error(`Unsupported EVM gas type: ${evmGasType}`);
      }
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
        // using hoisted relayAdaptUnshieldERC20Amounts
        
        // Assertion: after-fee spend matches available amount
        const totalSpend = recipientBn + relayerFeeBn;
        if (totalSpend !== afterFee) {
          throw new Error(`Spend mismatch: spend ${totalSpend.toString()} != afterFee ${afterFee.toString()}`);
        }
        
        // Create single cross-contract call: Forward NET amount to recipient
        // (SDK handles relayer fee payment internally via broadcasterFeeERC20AmountRecipient)
        // using hoisted crossContractCalls
        
        console.log('🔧 [UNSHIELD] Cross-contract call created:', {
          to: tokenAddress,
          recipientEVM: recipientEVM,
          afterFee: afterFee.toString(),
          callCount: crossContractCalls.length
        });
        
        console.log('🔧 [UNSHIELD] Gas estimation parameters:', {
          relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({ tokenAddress: a.tokenAddress, amount: a.amount.toString() })),
          crossContractCalls: crossContractCalls.length,
          feeTokenDetails: { tokenAddress: feeTokenDetails.tokenAddress, feePerUnitGas: feeTokenDetails.feePerUnitGas.toString() },
          sendWithPublicWallet,
          minGasLimit: minGasForSDK.toString()
        });
        
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
          minGasForSDK // Dynamic minimum based on estimate
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
      
      // Use network-appropriate conservative estimates instead of blanket high values
      if (chain.id === 56) { // BNB Chain
        accurateGasEstimate = useRelayer ? BigInt('1200000') : BigInt('800000'); // More reasonable for BNB
      } else if (chain.id === 42161) { // Arbitrum
        accurateGasEstimate = useRelayer ? BigInt('1200000') : BigInt('800000'); // Arbitrum estimates
      } else if (chain.id === 137) { // Polygon
        accurateGasEstimate = useRelayer ? BigInt('1200000') : BigInt('800000'); // Polygon estimates (similar to Arbitrum)
      } else { // Other chains
        accurateGasEstimate = useRelayer ? BigInt('2000000') : BigInt('1200000'); // Conservative fallback
      }
      
      console.log('📊 [UNSHIELD] Using network-specific fallback gas estimate:', {
        gasEstimate: accurateGasEstimate.toString(),
        reason: 'official-estimation-failed',
        mode: useRelayer ? 'relayer' : 'self-signing',
        chainId: chain.id
      });
    }
    
    // Add buffer to gas estimate (20% padding to match SDK usage)
    const finalGasEstimate = (accurateGasEstimate * 120n) / 100n;
    
    // Dynamic minimum for SDK calls - use padded estimate when greater
    const minGasForSDK = finalGasEstimate > MIN_GAS_LIMIT ? finalGasEstimate : MIN_GAS_LIMIT;
    
    // Derive overallBatchMinGasPrice from transaction gas details (per docs)
    const txGasForBatchPrice = {
      evmGasType,
      gasEstimate: accurateGasEstimate,
      gasPrice: originalGasDetails.gasPrice,
      maxFeePerGas: originalGasDetails.maxFeePerGas,
      maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas,
    };
    const OVERALL_BATCH_MIN_GAS_PRICE = await calculateGasPrice(txGasForBatchPrice);
    
    console.log('📝 [UNSHIELD] Step 5b: Generating real unshield proof with accurate gas...');
    
    console.log('🔧 [UNSHIELD] Real proof mode:', {
      sendWithPublicWallet,
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      mode: useRelayer ? 'RelayAdapt' : 'Self-Signing',
      overallBatchMinGasPrice: OVERALL_BATCH_MIN_GAS_PRICE.toString()
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
      
      // using hoisted relayAdaptUnshieldERC20Amounts and crossContractCalls from Step 4
      
      const proofBundle = {
        relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({ tokenAddress: a.tokenAddress, amount: a.amount.toString() })),
        relayAdaptUnshieldNFTAmounts,
        relayAdaptShieldERC20Recipients,
        relayAdaptShieldNFTRecipients,
        crossContractCalls: crossContractCalls.map(c => ({ to: c.to, data: String(c.data), value: c.value?.toString?.() ?? '0' })),
        broadcasterFeeERC20AmountRecipient: {
          tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
          recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
          amount: broadcasterFeeERC20AmountRecipient.amount.toString()
        },
        sendWithPublicWallet,
        overallBatchMinGasPrice: OVERALL_BATCH_MIN_GAS_PRICE.toString(),
        minGasLimit: MIN_GAS_LIMIT.toString()
      };
      proofBundleString = JSON.stringify(proofBundle);
      console.log('🔧 [UNSHIELD] Proof generation parameters:', proofBundle);
      
      proofResponse = await generateCrossContractCallsProof(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunWalletID,
        encryptionKey,
        relayAdaptUnshieldERC20Amounts,
        relayAdaptUnshieldNFTAmounts,
        relayAdaptShieldERC20Recipients,
        relayAdaptShieldNFTRecipients,
        crossContractCalls, // Single transfer call (recipient only)
        broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
        sendWithPublicWallet,
        OVERALL_BATCH_MIN_GAS_PRICE,
        minGasForSDK,
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
    
    console.log('✅ [UNSHIELD] Proof generation completed with gas padding:', {
      originalGasEstimate: accurateGasEstimate.toString(),
      paddedGasEstimate: finalGasEstimate.toString(),
      minGasForSDK: minGasForSDK.toString(),
      padding: '25%',
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
      
      // using hoisted relayAdaptUnshieldERC20Amounts and crossContractCalls from Step 4
      
      const populateBundle = {
        relayAdaptUnshieldERC20Amounts: relayAdaptUnshieldERC20Amounts.map(a => ({ tokenAddress: a.tokenAddress, amount: a.amount.toString() })),
        relayAdaptUnshieldNFTAmounts,
        relayAdaptShieldERC20Recipients,
        relayAdaptShieldNFTRecipients,
        crossContractCalls: crossContractCalls.map(c => ({ to: c.to, data: String(c.data), value: c.value?.toString?.() ?? '0' })),
        broadcasterFeeERC20AmountRecipient: {
          tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
          recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress,
          amount: broadcasterFeeERC20AmountRecipient.amount.toString()
        },
        sendWithPublicWallet,
        overallBatchMinGasPrice: OVERALL_BATCH_MIN_GAS_PRICE.toString(),
        minGasLimit: MIN_GAS_LIMIT.toString()
      };
      console.log('🔧 [UNSHIELD] Populate parameters:', populateBundle);
      const populateBundleString = JSON.stringify(populateBundle);
      if (!proofBundleString) {
        console.error('❌ [UNSHIELD] Missing proof bundle for parity check');
      } else if (proofBundleString !== populateBundleString) {
        console.error('❌ [UNSHIELD] Cross-contract parity mismatch between proof and populate', {
          proofBundle: JSON.parse(proofBundleString),
          populateBundle: JSON.parse(populateBundleString),
        });

        const deepDiff = (a, b, path = []) => {
          const diffs = [];
          const isObj = (v) => typeof v === 'object' && v !== null;
          if (!isObj(a) || !isObj(b)) {
            if (a !== b) diffs.push({ path: path.join('.'), proof: a, populate: b });
            return diffs;
          }
          const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
          for (const k of keys) {
            diffs.push(...deepDiff(a[k], b[k], [...path, k]));
          }
          return diffs;
        };

        try {
          const proofObj = JSON.parse(proofBundleString);
          const populateObj = JSON.parse(populateBundleString);
          const diffs = deepDiff(proofObj, populateObj);
          console.error('❌ [UNSHIELD] Parity differences:', diffs);
        } catch (e) {
          console.error('❌ [UNSHIELD] Failed to compute diff:', e?.message);
        }
        throw new Error('Mismatch: cross-contract proof vs populate params');
      }
      
      try {
        populatedTransaction = await populateProvedCrossContractCalls(
          TXIDVersion.V2_PoseidonMerkle,
          networkName,
          railgunWalletID,
          relayAdaptUnshieldERC20Amounts,
          relayAdaptUnshieldNFTAmounts,
          relayAdaptShieldERC20Recipients,
          relayAdaptShieldNFTRecipients,
          crossContractCalls, // Single transfer call (recipient only)
          broadcasterFeeERC20AmountRecipient, // Official SDK pattern for relayer fees
          sendWithPublicWallet,
          OVERALL_BATCH_MIN_GAS_PRICE,
          gasDetails
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
    submittingToast = showTerminalToast('info', 'Transaction confirmed. Balance will update automatically within a few seconds.', { duration: 24000 });
    
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

  } catch (error) {
    console.error('💥 [UNSHIELD] Transaction failed:', {
      error: error.message,
      stack: error.stack,
    });
    // Normalize user reject
    if ((error?.message || '').toLowerCase().includes('rejected') || error?.code === 4001) {
      showTerminalToast('error', 'Rejected by User');
      throw new Error('Rejected by User');
    }
    
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


// --- Private Transfer via Relayer (docs flow, our relayer submission) ---
export const privateTransferWithRelayer = async ({
  railgunWalletID,
  encryptionKey,
  erc20AmountRecipients, // [{ tokenAddress, amount (BigInt string), recipientAddress (0zk) }]
  memoText,
  networkName,
}) => {
  try {
    const tokenAddress = erc20AmountRecipients[0].tokenAddress;
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const chainId = NETWORK_CONFIG?.[networkName]?.chain?.id;

    // 1) Gas details (relayer path)
    const evmGasType = getEVMGasTypeForTransaction(networkName, false);
    const originalGasDetails = evmGasType === EVMGasType.Type2
      ? { evmGasType, originalGasEstimate: 0n, maxFeePerGas: BigInt('0x100000'), maxPriorityFeePerGas: BigInt('0x010000') }
      : { evmGasType, originalGasEstimate: 0n, gasPrice: BigInt('0x100000') };

    // 2) Fee token details (from our relayer; fallback values ok)
    let relayerFeePerUnitGas = BigInt('1000000000');
    let feeQuote = null;
    try {
      feeQuote = await estimateRelayerFee({ chainId, tokenAddress, amount: String(erc20AmountRecipients[0].amount) });
      if (feeQuote?.feeEstimate?.feePerUnitGas) relayerFeePerUnitGas = BigInt(feeQuote.feeEstimate.feePerUnitGas);
    } catch {}
    const feeTokenDetails = { tokenAddress, feePerUnitGas: relayerFeePerUnitGas };

    // 3) STANDARD TRANSFER PATH (no RelayAdapt): estimate → proof → populate
    const amountBn = BigInt(erc20AmountRecipients[0].amount);
    const relayerRailgunAddress = await getRelayerAddress();
    const relayerFeeAmount = feeQuote && (feeQuote.relayerFee || feeQuote.feeEstimate?.relayerFee)
      ? BigInt(feeQuote.relayerFee || feeQuote.feeEstimate.relayerFee)
      : (amountBn / 200n); // 0.5% fallback

    const { gasEstimate } = await gasEstimateForUnprovenTransfer(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      memoText,
      erc20AmountRecipients,
      [],
      originalGasDetails,
      feeTokenDetails,
      false,
    );
    const transactionGasDetails = { evmGasType, gasEstimate, ...originalGasDetails };

    const relayerFeeERC20AmountRecipient = {
      tokenAddress,
      recipientAddress: relayerRailgunAddress,
      amount: relayerFeeAmount,
    };
    const overallBatchMinGasPrice = await calculateGasPrice(transactionGasDetails);
    await generateTransferProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      true,
      memoText,
      erc20AmountRecipients,
      [],
      relayerFeeERC20AmountRecipient,
      false,
      overallBatchMinGasPrice,
      () => {},
    );

    const { transaction } = await populateProvedTransfer(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      true,
      memoText,
      erc20AmountRecipients,
      [],
      relayerFeeERC20AmountRecipient,
      false,
      overallBatchMinGasPrice,
      transactionGasDetails,
    );

    // 6) Submit via our relayer
    const serializedTransaction = '0x' + Buffer.from(JSON.stringify({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value || '0x0',
      gasLimit: transaction.gasLimit?.toString(),
      gasPrice: transaction.gasPrice?.toString(),
      maxFeePerGas: transaction.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas?.toString(),
      type: transaction.type,
    })).toString('hex');

    const relayed = await submitRelayedTransaction({
      chainId,
      serializedTransaction,
      tokenAddress,
      amount: String(erc20AmountRecipients[0].amount),
      userAddress: null,
      feeDetails: {
        relayerFee: relayerFeeAmount.toString(),
        protocolFee: '0',
        totalFee: relayerFeeAmount.toString(),
        chainId: String(chainId),
        tokenAddress,
        proofTimestamp: new Date().toISOString(),
      },
      gasEstimate: transactionGasDetails.gasEstimate?.toString?.(),
    });

    // Transaction monitoring removed - SDK handles balance updates

    return { transactionHash: relayed.transactionHash, relayed: true };
  } catch (e) {
    throw e;
  }
};

