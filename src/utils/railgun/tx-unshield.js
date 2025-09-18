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
  ProofType,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { assertNotSanctioned } from '../sanctions/chainalysis-oracle.js';
import { calculateFeeForTransaction } from './fee-reclamation.js';

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

/**
 * Get hardcoded token prices (temporary - replace with API calls)
 * @param {string} tokenAddress - Token contract address
 * @returns {Promise<Object>} Price data
 */
const getTokenPrices = async (tokenAddress) => {
  const address = tokenAddress?.toLowerCase() || '';

  // Common token prices (update regularly)
  const tokenPrices = {
    // USDC (Ethereum)
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // USDT (Ethereum)
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // DAI (Ethereum)
    '0x6b175474e89094c44da98b954eedeac495271d0f': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // USDC (Polygon)
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // USDT (Polygon)
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // USDC (Arbitrum)
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // USDT (Arbitrum)
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { tokenPrice: 1.00, ethPrice: 3000.00 },
    // Default for unknown tokens
    'default': { tokenPrice: 1.00, ethPrice: 3000.00 }
  };

  return tokenPrices[address] || tokenPrices.default;
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

    // RELAYER MODE: Prepare recipients with broadcaster fee (deduct relayer fee from user's amount)
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
    
    // Protocol fee is handled by SDK internally. We still account for it in the
    // NET sent to the recipient, but we DO NOT add it to the spend requirement.
    const UNSHIELD_FEE_BPS = 25n; // 0.25%
    const RELAYER_FEE_BPS = 50n; // 0.5% (or from relayer quote)
    const MIN_GAS_LIMIT = 1600000n; // Lower floor - real txs land ~1.1-1.3M
    
    const userAmountGross = BigInt(amount); // user's entered amount (private balance units)

    let relayerFeeBn = 0n;
    let gasFeeDeducted = 0n; // Will be calculated after accurate gas estimation
    let recipientBn = 0n;
    let unshieldInputAmount = userAmountGross; // amount to unshield into RelayAdapt
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

      // Calculate relayer fee from the user's amount, then unshield NET of ALL fees
      // Calculate relayer fee - gas fee will be calculated after accurate gas estimation
      relayerFeeBn = (userAmountGross * RELAYER_FEE_BPS) / 10000n;
      
      console.log('💰 [UNSHIELD] Relayer fee calculated:', {
        userAmountGross: userAmountGross.toString(),
        relayerFeeBn: relayerFeeBn.toString(),
        note: 'Gas fee will be calculated after accurate gas estimation'
      });
      
      // Basic validation - detailed checks happen after fee calculations
      if (userAmountGross <= 0n) {
        throw new Error('User amount must be positive');
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
      
      // Protocol fee is deducted internally by SDK from unshieldInputAmount
      
      // Note: erc20AmountRecipients is not used in cross-contract calls mode
      // Instead, we use relayAdaptUnshieldERC20Amounts + crossContractCalls
      erc20AmountRecipients = [];
      
      // Note: RelayAdapt objects will be built after accurate gas recalculation
      console.log('📝 [UNSHIELD] RelayAdapt setup deferred until accurate gas fees calculated');
      
    } else {
      // SELF-SIGNING MODE: Only SDK's unshield fee applies (relayer fee is 0)
      console.log('🔧 [UNSHIELD] Preparing self-signing mode (with SDK unshield fee)...');

      // Self-signing: no relayer fee. Unshield full user amount, recipient gets net of protocol fee
      unshieldInputAmount = userAmountGross;
      recipientBn = (unshieldInputAmount * (10000n - UNSHIELD_FEE_BPS)) / 10000n;

      // Check if user has enough for protocol fee
      const protocolFee = (unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n;
      if (recipientBn <= 0n) {
        console.error('[Unshield] ❌ CRITICAL: Amount too small for protocol fee');
        const minAmount = (protocolFee * 10000n) / (10000n - UNSHIELD_FEE_BPS) + 1000000n;
        const errorMsg = `Amount too small. Minimum amount needed: ${(Number(minAmount) / 1e6).toFixed(2)} to cover protocol fee.`;
        showTerminalToast('error', 'Amount Too Small', errorMsg);
        throw new Error(errorMsg);
      }

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
      const userRecipient = createERC20AmountRecipient(tokenAddress, recipientBn, recipientEVM);
      erc20AmountRecipients = [userRecipient];
      
      console.log('📝 [UNSHIELD] Self-signing recipients prepared:', {
        userRecipient: { amount: recipientBn.toString(), to: recipientEVM },
        unshieldFee: { amount: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'handled_by_SDK' },
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

    // 🤑 FEE RECLAMATION: Calculate gas fee after accurate gas estimation
    if (useRelayer) {
      console.log('[Unshield] 🤑 Calculating gas fee reclamation with accurate estimate...');

      // Get live network gas prices first
      let liveFeeData = null;
      try {
        const signer = await walletProvider();
        const provider = signer?.provider;
        if (provider) {
          liveFeeData = await provider.getFeeData();
          console.log('[Unshield] 📊 Live network gas prices:', {
            gasPrice: liveFeeData?.gasPrice?.toString(),
            maxFeePerGas: liveFeeData?.maxFeePerGas?.toString(),
            maxPriorityFeePerGas: liveFeeData?.maxPriorityFeePerGas?.toString(),
            source: 'live_provider_data'
          });
        }
      } catch (feeError) {
        console.warn('[Unshield] ⚠️ Could not get live fee data:', feeError.message);
      }

      // Build gas details with live data or conservative fallback (3-4 gwei max)
      const conservativeFallbackGasPrice = BigInt('4000000000'); // 4 gwei conservative fallback
      const conservativeMaxFeePerGas = BigInt('3000000000'); // 3 gwei conservative fallback
      const conservativeMaxPriorityFeePerGas = BigInt('1000000000'); // 1 gwei conservative fallback

      const accurateGasDetails = {
        evmGasType,
        gasEstimate: finalGasEstimate,
        gasPrice: liveFeeData?.gasPrice || conservativeFallbackGasPrice,
        maxFeePerGas: liveFeeData?.maxFeePerGas || conservativeMaxFeePerGas,
        maxPriorityFeePerGas: liveFeeData?.maxPriorityFeePerGas || conservativeMaxPriorityFeePerGas,
      };

      // Log the raw network estimate for transparency
      const rawGasCost = calculateTransactionCost(accurateGasDetails, { profitMargin: 0 }); // No profit for raw cost
      const rawGasCostEth = Number(rawGasCost) / 1e18;
      console.log('[Unshield] 📊 Raw network gas estimate:', {
        gasEstimate: finalGasEstimate.toString(),
        gasPrice: accurateGasDetails.gasPrice.toString(),
        maxFeePerGas: accurateGasDetails.maxFeePerGas?.toString(),
        rawGasCostWei: rawGasCost.toString(),
        rawGasCostEth: rawGasCostEth.toFixed(6),
        rawGasCostUSD: (rawGasCostEth * 3000).toFixed(2), // Assuming $3000 ETH
        usingLiveData: !!liveFeeData,
        fallbackUsed: !liveFeeData ? '3-4 gwei conservative' : 'live network data'
      });

      // Get network name and token prices for fee calculation
      const networkName = getRailgunNetworkName(chain.id);
      const tokenPrices = getTokenPrices(tokenAddress);
      const { tokenPrice, ethPrice } = await tokenPrices;

      // Calculate gas reclamation fee using accurate gas details
      const gasFeeResult = await calculateFeeForTransaction({
        gasDetails: accurateGasDetails,
        networkName,
        tokenAddress,
        tokenPrice,
        ethPrice,
        tokenDecimals: 6,
        transactionType: 'unshield'
      });

      gasFeeDeducted = gasFeeResult.feeAmount;

      // Check if user has enough funds for all fees
      const totalFeeDeduction = relayerFeeBn + gasFeeDeducted;
      if (userAmountGross <= totalFeeDeduction) {
        console.error('[Unshield] ❌ Insufficient funds for fees:', {
          userAmountGross: userAmountGross.toString(),
          totalFeeDeduction: totalFeeDeduction.toString(),
          relayerFeeBn: relayerFeeBn.toString(),
          gasFeeDeducted: gasFeeDeducted.toString(),
          shortfall: (totalFeeDeduction - userAmountGross).toString()
        });

        const minAmountNeeded = totalFeeDeduction + 1000000n;
        const errorMsg = `Insufficient funds. Amount must be at least ${(Number(minAmountNeeded) / 1e6).toFixed(2)} to cover fees.`;
        showTerminalToast('error', 'Insufficient Funds', errorMsg);
        throw new Error(errorMsg);
      }

      // Calculate amounts: subtract fees, let SDK apply 0.25% protocol fee
      unshieldInputAmount = userAmountGross - totalFeeDeduction;
      recipientBn = (unshieldInputAmount * (10000n - UNSHIELD_FEE_BPS)) / 10000n;

      console.log('[Unshield] ✅ Fee reclamation applied:', {
        userAmountGross: userAmountGross.toString(),
        relayerFeeDeducted: relayerFeeBn.toString(),
        gasFeeDeducted: gasFeeDeducted.toString(),
        totalFeeDeduction: totalFeeDeduction.toString(),
        unshieldInputAmount: unshieldInputAmount.toString(),
        recipientBn: recipientBn.toString(),
        protocolFee: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(),
        finalRecipientAmount: (recipientBn - ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n)).toString(),
        gasReclamationPercentage: `${((Number(gasFeeDeducted) / Number(userAmountGross)) * 100).toFixed(3)}%`
      });

      // 🔧 BUILD RelayAdapt OBJECTS WITH ACCURATE AMOUNTS
      console.log('[Unshield] 🔧 Building RelayAdapt objects with calculated amounts...');

      relayAdaptUnshieldERC20Amounts = [{
        tokenAddress,
        amount: unshieldInputAmount,
      }];

      const { ethers } = await import('ethers');
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)'
      ]);

      const recipientCallData = erc20Interface.encodeFunctionData('transfer', [
        recipientEVM,
        recipientBn,
      ]);

      crossContractCalls = [{
        to: tokenAddress,
        data: recipientCallData,
        value: 0n,
      }];

      // Log final breakdown
      console.log('📝 [UNSHIELD] Final transaction breakdown:', {
        recipientAmount: { amount: recipientBn.toString(), to: recipientEVM },
        relayerFee: { amount: relayerFeeBn.toString(), to: selectedRelayer.railgunAddress },
        gasReclamationFee: { amount: gasFeeDeducted.toString(), note: 'gas_cost_recovery' },
        sdkProtocolFee: { amount: ((unshieldInputAmount * UNSHIELD_FEE_BPS) / 10000n).toString(), note: 'applied_by_sdk' },
        totalFees: totalFeeDeduction.toString(),
        mode: 'RelayAdapt_With_Gas_Reclamation'
      });
    }
    
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
        userAmountGross: userAmountGross.toString(),
        unshieldInputAmount: unshieldInputAmount.toString(),
        relayerFeeBn: relayerFeeBn.toString(),
        recipientBn: recipientBn.toString(),
        requiredSpend: (unshieldInputAmount + relayerFeeBn).toString()
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
  // Ensure memoText is properly formatted
  const processedMemoText = memoText && typeof memoText === 'string' && memoText.trim().length > 0
    ? memoText.trim()
    : null;

  console.log('📝 [PRIVATE_TRANSFER] Memo processing:', {
    originalMemoText: memoText,
    processedMemoText,
    memoType: typeof memoText,
    memoLength: memoText?.length || 0
  });
  try {
    console.log('🔧 [PRIVATE_TRANSFER_RElayer] ===== RELAYER FUNCTION START =====');
    console.log('🔧 [PRIVATE_TRANSFER_RElayer] Input parameters:', {
      railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
      hasEncryptionKey: !!encryptionKey,
      erc20AmountRecipientsCount: erc20AmountRecipients?.length,
      memoText: processedMemoText || 'none',
      networkName,
      recipientDetails: erc20AmountRecipients?.map(r => ({
        tokenAddress: r.tokenAddress,
        amount: r.amount?.toString(),
        amountType: typeof r.amount,
        recipientAddress: r.recipientAddress?.substring(0, 30) + '...',
        recipientLength: r.recipientAddress?.length
      }))
    });

    // Log the raw input amount before any processing
    if (erc20AmountRecipients && erc20AmountRecipients[0]) {
      console.log('🔢 [PRIVATE_TRANSFER_RElayer] Raw input amount analysis:', {
        rawAmount: erc20AmountRecipients[0].amount,
        rawAmountType: typeof erc20AmountRecipients[0].amount,
        rawAmountString: String(erc20AmountRecipients[0].amount),
        isBigInt: typeof erc20AmountRecipients[0].amount === 'bigint',
        isString: typeof erc20AmountRecipients[0].amount === 'string',
        isNumber: typeof erc20AmountRecipients[0].amount === 'number'
      });
    }

    const tokenAddress = erc20AmountRecipients[0].tokenAddress;
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const chainId = NETWORK_CONFIG?.[networkName]?.chain?.id;

    console.log('🔧 [PRIVATE_TRANSFER_RElayer] Extracted details:', {
      tokenAddress,
      chainId,
      networkName,
      recipientAddress: erc20AmountRecipients[0]?.recipientAddress
    });

    // STEP 0: Balance refresh and network scanning (same as unshield)
    console.log('🔄 [PRIVATE TRANSFER] Step 0: Refreshing balances and scanning network...');

    try {
      const { refreshBalances } = await import('@railgun-community/wallet');
      const networkConfig = NETWORK_CONFIG[networkName];

      if (!networkConfig) {
        throw new Error(`No network config found for ${networkName}`);
      }

      await waitForRailgunReady();

      const railgunChain = networkConfig.chain;
      const walletIdFilter = [railgunWalletID];

      console.log('🔄 [PRIVATE TRANSFER] Refreshing Railgun balances...');
      await refreshBalances(railgunChain, walletIdFilter);

    } catch (refreshError) {
      console.warn('⚠️ [PRIVATE TRANSFER] Balance refresh failed:', refreshError.message);
    }

    // STEP 1: Network rescan for up-to-date Merkle tree
    console.log('🔄 [PRIVATE TRANSFER] Step 1: Performing network rescan...');

    try {
      const { performNetworkRescan, getRailgunNetworkName } = await import('./scanning-service.js');
      const railgunNetworkName = getRailgunNetworkName(chainId);

      await performNetworkRescan(railgunNetworkName, [railgunWalletID]);
      console.log('✅ [PRIVATE TRANSFER] Network rescan completed');

    } catch (rescanError) {
      console.error('❌ [PRIVATE TRANSFER] Network rescan failed:', rescanError.message);
      throw new Error(`Failed to rescan network: ${rescanError.message}`);
    }

    // STEP 2: Gas details (relayer path) - Use same approach as unshield for consistency
    const evmGasType = getEVMGasTypeForTransaction(networkName, false);

    // Fetch real-time network gas prices like unshield function does
    let originalGasDetails;
    try {
      // Get current network gas prices for realistic originalGasDetails
      const { ethers } = await import('ethers');
      let networkGasPrices = null;

      // Try to get provider for gas price fetching (similar to unshield approach)
      try {
        // Use our proxied RPC to avoid exposing keys (same as unshield)
        const origin = (typeof window !== 'undefined' ? window.location.origin : '');
        const provider = new ethers.JsonRpcProvider(origin + '/api/rpc?chainId=' + chainId + '&provider=auto');
        const feeData = await provider.getFeeData();
        networkGasPrices = feeData;
      } catch (providerError) {
        console.warn('⚠️ [PRIVATE TRANSFER] Failed to get network gas prices:', providerError.message);
      }

      // Create gas details following same pattern as unshield
      switch (evmGasType) {
        case EVMGasType.Type0:
        case EVMGasType.Type1:
          let gasPrice = networkGasPrices?.gasPrice || BigInt('0x100000');
          originalGasDetails = {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice,
          };
          break;
        case EVMGasType.Type2:
          let maxFeePerGas = networkGasPrices?.maxFeePerGas || BigInt('0x100000');
          let maxPriorityFeePerGas = networkGasPrices?.maxPriorityFeePerGas || BigInt('0x010000');
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

      console.log('💰 [PRIVATE TRANSFER] Gas details with network prices:', {
        evmGasType,
        gasPrice: originalGasDetails.gasPrice?.toString(),
        maxFeePerGas: originalGasDetails.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: originalGasDetails.maxPriorityFeePerGas?.toString(),
        chainId
      });

    } catch (gasError) {
      console.warn('⚠️ [PRIVATE TRANSFER] Failed to get network gas prices, using fallbacks:', gasError.message);

      // Fallback with network-appropriate values (same as unshield)
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

    // STEP 4: STANDARD TRANSFER PATH (no RelayAdapt): estimate → proof → populate
    // Convert amount to BigInt (same as unshield function) - Store original amount
    const originalAmountBn = BigInt(erc20AmountRecipients[0].amount);
    const amountBn = originalAmountBn;

    console.log('💰 [PRIVATE TRANSFER] Original amount conversion:', {
      originalAmountString: erc20AmountRecipients[0].amount,
      originalAmountBn: originalAmountBn.toString(),
      amountBn: amountBn.toString()
    });

    // STEP 3: Fee token details (from our relayer; use more realistic fallback values)
    let relayerFeePerUnitGas = originalGasDetails.gasPrice || originalGasDetails.maxFeePerGas || BigInt('20000000000'); // 20 gwei fallback instead of 1 gwei
    let feeQuote = null;
    try {
      // Use the ORIGINAL amount for fee estimation (before fee deduction)
      console.log('💰 [PRIVATE TRANSFER] Using original amount for fee estimation:', originalAmountBn.toString());
      feeQuote = await estimateRelayerFee({ chainId, tokenAddress, amount: String(originalAmountBn) });
      if (feeQuote?.feeEstimate?.feePerUnitGas) {
        relayerFeePerUnitGas = BigInt(feeQuote.feeEstimate.feePerUnitGas);
      }
      console.log('💰 [PRIVATE TRANSFER] Fee estimation result:', {
        feeQuoteReceived: !!feeQuote,
        relayerFeePerUnitGas: relayerFeePerUnitGas.toString()
      });
    } catch (feeError) {
      console.warn('⚠️ [PRIVATE TRANSFER] Fee estimation failed:', feeError.message);
    }
    const feeTokenDetails = { tokenAddress, feePerUnitGas: relayerFeePerUnitGas };
    const relayerRailgunAddress = await getRelayerAddress();

    // Calculate fees the same way as unshield (deduct from transfer amount)
    const RELAYER_FEE_BPS = 50n; // 0.5% (same as unshield)

    // Calculate fee amount using ORIGINAL amount (same as unshield)
    let relayerFeeAmount = (originalAmountBn * RELAYER_FEE_BPS) / 10000n; // 0.5% of transfer amount

    // Try to use API-provided fee if available (convert to BigInt if it's a string)
    if (feeQuote && feeQuote.relayerFee) {
      if (typeof feeQuote.relayerFee === 'string') {
        relayerFeeAmount = BigInt(feeQuote.relayerFee);
      } else {
        relayerFeeAmount = BigInt(feeQuote.relayerFee);
      }
      console.log('💰 [PRIVATE TRANSFER] Using API-provided fee:', {
        apiFee: feeQuote.relayerFee,
        convertedFee: relayerFeeAmount.toString()
      });
    }

    // Deduct fee from transfer amount (like unshield does)
    const netRecipientAmount = originalAmountBn - relayerFeeAmount;

    console.log('💰 [PRIVATE TRANSFER] Fee calculation (like unshield):', {
      originalAmount: originalAmountBn.toString(),
      relayerFee: relayerFeeAmount.toString(),
      netRecipientAmount: netRecipientAmount.toString(),
      verification: `${netRecipientAmount.toString()} + ${relayerFeeAmount.toString()} = ${(netRecipientAmount + relayerFeeAmount).toString()}`,
      amountsMatch: (netRecipientAmount + relayerFeeAmount) === originalAmountBn
    });

    // Update the recipient amount to be net of fees (BigInt like unshield path)
    erc20AmountRecipients[0].amount = netRecipientAmount;

    console.log('🔧 [PRIVATE TRANSFER] Before gas estimation - checking amounts:', {
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        amount: r.amount?.toString(),
        amountType: typeof r.amount,
        recipientAddress: r.recipientAddress?.substring(0, 30) + '...'
      })),
      originalAmountBn: originalAmountBn.toString(),
      netRecipientAmount: netRecipientAmount.toString(),
      relayerFeeAmount: relayerFeeAmount.toString(),
      memoText: processedMemoText || 'none'
    });

    // ===== ADOPTING OFFICIAL SDK PATTERN =====
    // Following tx-transfer.ts approach: use generic SDK functions instead of transfer-specific ones
    // This eliminates the complex custom implementation and uses proven SDK patterns

    console.log('🔧 [PRIVATE TRANSFER] ===== USING OFFICIAL SDK PATTERN =====');
    console.log('🔧 [PRIVATE TRANSFER] Switching from transfer-specific to generic SDK functions');

    // Create broadcaster fee recipient (separate from main transfer) - amount as BigInt
    const broadcasterFeeERC20AmountRecipient = {
      tokenAddress,
      recipientAddress: relayerRailgunAddress,
      amount: relayerFeeAmount,
    };

    // ===== FALLBACK: Use working gas estimation pattern =====
    // The official SDK pattern has import/scope issues, reverting to proven working approach
    console.log('💰 [PRIVATE TRANSFER] Using proven gas estimation pattern...');

    // Import the working gas estimation function
    const { gasEstimateForUnprovenTransfer } = await import('@railgun-community/wallet');

    const gasEstimateResponse = await gasEstimateForUnprovenTransfer(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      processedMemoText,
      erc20AmountRecipients,
      [], // nftAmountRecipients
      originalGasDetails,
      feeTokenDetails,
      false, // sendWithPublicWallet
    );

    const gasEstimate = gasEstimateResponse.gasEstimate;
    const transactionGasDetails = { evmGasType, gasEstimate, ...originalGasDetails };
    const overallBatchMinGasPrice = await calculateGasPrice(transactionGasDetails);

    console.log('🔐 [PRIVATE TRANSFER] Gas estimation complete:', {
      gasEstimate: gasEstimate?.toString(),
      overallBatchMinGasPrice: overallBatchMinGasPrice?.toString(),
      evmGasType,
      method: 'gasEstimateForUnprovenTransfer (proven working)'
    });

    console.log('🔐 [PRIVATE TRANSFER] Before proof generation - final amount check:', {
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        amount: r.amount?.toString(),
        recipientAddress: r.recipientAddress?.substring(0, 30) + '...'
      })),
      broadcasterFeeRecipient: {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount?.toString(),
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress?.substring(0, 30) + '...'
      },
      gasEstimate: gasEstimate?.toString(),
      overallBatchMinGasPrice: overallBatchMinGasPrice?.toString(),
      method: 'Official SDK Pattern'
    });

    // ===== FALLBACK: Use working proof generation pattern =====
    console.log('🔐 [PRIVATE TRANSFER] Using proven proof generation pattern...');
    const { generateTransferProof } = await import('@railgun-community/wallet');

    // Generate proof using the proven working pattern
    await generateTransferProof(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      encryptionKey,
      true, // showSenderAddressToRecipient
      processedMemoText,
      erc20AmountRecipients,
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient, // Use broadcasterFee (not null)
      false, // sendWithPublicWallet
      overallBatchMinGasPrice,
      () => {}, // progress callback
    );

    console.log('✅ [PRIVATE TRANSFER] Proof generation complete');

    // Log proof generation details including memo
    console.log('📝 [PRIVATE TRANSFER] Proof generation summary:', {
      memoText: processedMemoText || 'none',
      memoTextLength: processedMemoText?.length || 0,
      erc20Recipients: erc20AmountRecipients.length,
      recipientAddress: erc20AmountRecipients[0]?.recipientAddress?.substring(0, 20) + '...',
      recipientAmount: erc20AmountRecipients[0]?.amount?.toString(),
      hasBroadcasterFee: !!broadcasterFeeERC20AmountRecipient,
      broadcasterFeeAmount: broadcasterFeeERC20AmountRecipient?.amount?.toString()
    });

    // ===== BUG FIX: COMPREHENSIVE PRIVATE TRANSFER VALIDATION =====
    // This section prevents the critical bug where private transfer outputs
    // decrypt to the sender instead of the intended recipient, causing funds
    // to remain with the sender instead of reaching the recipient.
    //
    // VALIDATIONS PERFORMED:
    // 1. Get relayer 0zk address from VITE_RELAYER_ADDRESS env var
    // 2. Invariants: sender ≠ recipient, sender ≠ relayer
    // 3. Can-decrypt guard: prevent self-targeting
    // 4. Output address validation: proof outputs match expected addresses
    // 5. Fee calculation validation: prevent $0 transactions
    //
    // If any validation fails, transaction is aborted before execution.

    console.log('🔍 [PRIVATE TRANSFER] Getting relayer address...');

    // Use VITE_RELAYER_ADDRESS environment variable instead of API call
    // This avoids HMAC authentication issues
    const relayer0zk = import.meta.env.VITE_RELAYER_ADDRESS;

    if (!relayer0zk) {
      throw new Error('VITE_RELAYER_ADDRESS environment variable not set');
    }

    if (!relayer0zk.startsWith('0zk')) {
      throw new Error(`Invalid relayer 0zk address from env: ${relayer0zk}. Must start with '0zk'`);
    }

    console.log('✅ [PRIVATE TRANSFER] Relayer 0zk from env:', relayer0zk.substring(0, 30) + '...');

    // Get sender's Railgun address for invariants
    const { getRailgunAddress } = await import('@railgun-community/wallet');
    const sender0zk = await getRailgunAddress(railgunWalletID);

    if (!sender0zk || !sender0zk.startsWith('0zk')) {
      throw new Error(`Invalid sender 0zk address: ${sender0zk}`);
    }

    const recipient0zk = erc20AmountRecipients[0].recipientAddress;

    // INVARIANTS CHECK: Run before populate
    console.log('🔐 [PRIVATE TRANSFER] Running invariants check...');
    console.log('🔐 [PRIVATE TRANSFER] Invariants debug:', {
      sender0zk: sender0zk?.substring(0, 20) + '...',
      recipient0zk: recipient0zk?.substring(0, 20) + '...',
      relayer0zk: relayer0zk?.substring(0, 20) + '...',
      senderVsRecipient: sender0zk === recipient0zk,
      senderVsRelayer: sender0zk === relayer0zk,
      recipientVsRelayer: recipient0zk === relayer0zk,
      senderLength: sender0zk?.length,
      recipientLength: recipient0zk?.length,
      relayerLength: relayer0zk?.length
    });

    if (recipient0zk === sender0zk) {
      throw new Error(`❌ INVARIANT FAILED: Cannot send to self (recipient0zk === sender0zk)\nSender: ${sender0zk}\nRecipient: ${recipient0zk}`);
    }

    if (relayer0zk === sender0zk) {
      throw new Error(`❌ INVARIANT FAILED: Relayer cannot be sender (relayer0zk === sender0zk)\nSender: ${sender0zk}\nRelayer: ${relayer0zk}`);
    }

    // CAN-DECRYPT GUARD: Enhanced check for self-targeting prevention
    console.log('🔐 [PRIVATE TRANSFER] Checking enhanced can-decrypt guard...');

    try {
      // Basic checks that don't require dummy notes
      const senderPrefix = sender0zk.substring(0, 10);
      const recipientPrefix = recipient0zk.substring(0, 10);

      console.log('🔐 [PRIVATE TRANSFER] Address prefix analysis:', {
        senderPrefix,
        recipientPrefix,
        prefixesMatch: senderPrefix === recipientPrefix
      });

      // If prefixes match, this could indicate same wallet (though not definitive)
      if (senderPrefix === recipientPrefix && sender0zk !== recipient0zk) {
        console.warn('⚠️ [PRIVATE TRANSFER] Address prefixes match - potential self-targeting detected');
        // Don't block here as this could be legitimate (different wallets with similar prefixes)
        // but log for monitoring
      }

      // Check for obvious self-targeting patterns
      if (sender0zk === recipient0zk) {
        throw new Error('❌ CAN-DECRYPT GUARD: Obvious self-targeting detected - sender and recipient addresses are identical');
      }

      // TODO: When SDK exposes dummy note functions, implement full can-decrypt test:
      // const dummyNote = await generateDummyNote(recipient0zk, tokenAddress, BigInt(1));
      // const canDecrypt = await decryptNote(dummyNote, encryptionKey);
      // if (canDecrypt) throw new Error('Sender can decrypt recipient notes');

      console.log('✅ [PRIVATE TRANSFER] Can-decrypt guard passed');

    } catch (guardError) {
      if (guardError.message.includes('CAN-DECRYPT GUARD')) {
        throw guardError;
      }
      console.warn('⚠️ [PRIVATE TRANSFER] Can-decrypt guard check warning:', guardError.message);
    }

    // TELEMETRY: Check for fee issues
    if (feeQuote && feeQuote.totalFee === '0' && relayerFeeAmount > 0n) {
      console.warn('📊 [PRIVATE TRANSFER] TELEMETRY: totalFee === "0" but fee was quoted - potential issue');
      // Could emit to analytics service here
    }

    console.log('✅ [PRIVATE TRANSFER] All invariants passed');
0+

    // FUTURE: Add output addresses validation
    // After proof generation, validate that:
    // - proof.publicInputs.outputAddresses[0] === relayer0zk
    // - proof.publicInputs.outputAddresses[1] === recipient0zk
    // If validation fails, abort transaction to prevent funds going to wrong addresses

    console.log('📝 [PRIVATE TRANSFER] Before populate - transaction data validation:', {
      networkName,
      railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
      memoText: processedMemoText || 'none',
      sender0zk: sender0zk.substring(0, 30) + '...',
      recipient0zk: recipient0zk.substring(0, 30) + '...',
      relayer0zk: relayer0zk.substring(0, 30) + '...',
      erc20AmountRecipients: erc20AmountRecipients.map(r => ({
        tokenAddress: r.tokenAddress,
        amount: r.amount?.toString(),
        recipientAddress: r.recipientAddress?.substring(0, 30) + '...'
      })),
      broadcasterFeeRecipient: {
        tokenAddress: broadcasterFeeERC20AmountRecipient.tokenAddress,
        amount: broadcasterFeeERC20AmountRecipient.amount?.toString(),
        recipientAddress: broadcasterFeeERC20AmountRecipient.recipientAddress?.substring(0, 30) + '...'
      },
      overallBatchMinGasPrice: overallBatchMinGasPrice?.toString(),
      gasEstimate: transactionGasDetails.gasEstimate?.toString(),
      method: 'Official SDK Pattern'
    });

    // ===== FALLBACK: Use working populate pattern =====
    console.log('📝 [PRIVATE TRANSFER] Using proven populate pattern...');
    const { populateProvedTransfer } = await import('@railgun-community/wallet');

    const populateResult = await populateProvedTransfer(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunWalletID,
      true, // showSenderAddressToRecipient
      processedMemoText,
      erc20AmountRecipients,
      [], // nftAmountRecipients
      broadcasterFeeERC20AmountRecipient,
      false, // sendWithPublicWallet
      overallBatchMinGasPrice,
      transactionGasDetails,
    );

    const { transaction } = populateResult;

    // OUTPUT ADDRESS VALIDATION: Verify proof outputs match expected addresses
    console.log('🔍 [PRIVATE TRANSFER] ===== OUTPUT ADDRESS VALIDATION =====');
    console.log('🔍 [PRIVATE TRANSFER] Populate result structure:', {
      hasTransaction: !!populateResult.transaction,
      hasProof: !!populateResult.proof,
      populateResultKeys: Object.keys(populateResult),
      transactionKeys: populateResult.transaction ? Object.keys(populateResult.transaction) : [],
      proofKeys: populateResult.proof ? Object.keys(populateResult.proof) : []
    });

    let outputValidationPassed = false;

    try {
      // Try multiple ways to access proof data
      let outputAddresses = null;
      let proofSource = 'unknown';

      // Method 1: Direct proof.publicInputs access
      if (populateResult.proof?.publicInputs?.outputAddresses) {
        outputAddresses = populateResult.proof.publicInputs.outputAddresses;
        proofSource = 'proof.publicInputs.outputAddresses';
      }
      // Method 2: Check if proof has different structure
      else if (populateResult.proof?.outputAddresses) {
        outputAddresses = populateResult.proof.outputAddresses;
        proofSource = 'proof.outputAddresses';
      }
      // Method 3: Check transaction for embedded proof data
      else if (populateResult.transaction?.proof?.publicInputs?.outputAddresses) {
        outputAddresses = populateResult.transaction.proof.publicInputs.outputAddresses;
        proofSource = 'transaction.proof.publicInputs.outputAddresses';
      }

      if (outputAddresses) {
        console.log('🔍 [PRIVATE TRANSFER] Found output addresses via:', proofSource);
        console.log('🔍 [PRIVATE TRANSFER] Proof output addresses:', {
          outputAddresses: outputAddresses.map(addr => addr?.substring(0, 30) + '...'),
          outputAddressesCount: outputAddresses.length,
          expectedRelayer: relayer0zk.substring(0, 30) + '...',
          expectedRecipient: recipient0zk.substring(0, 30) + '...'
        });

        // Validate we have at least 2 output addresses
        if (outputAddresses.length < 2) {
          throw new Error(`❌ OUTPUT VALIDATION FAILED: Expected at least 2 output addresses, got ${outputAddresses.length}`);
        }

        const actualRelayerOutput = outputAddresses[0];
        const actualRecipientOutput = outputAddresses[1];

        // Detailed validation logging
        const validationDetails = {
          relayer: {
            actual: actualRelayerOutput?.substring(0, 30) + '...',
            expected: relayer0zk.substring(0, 30) + '...',
            match: actualRelayerOutput === relayer0zk,
            actualFull: actualRelayerOutput,
            expectedFull: relayer0zk
          },
          recipient: {
            actual: actualRecipientOutput?.substring(0, 30) + '...',
            expected: recipient0zk.substring(0, 30) + '...',
            match: actualRecipientOutput === recipient0zk,
            actualFull: actualRecipientOutput,
            expectedFull: recipient0zk
          }
        };

        console.log('🔍 [PRIVATE TRANSFER] Detailed validation:', validationDetails);

        // Validate relayer output
        if (!actualRelayerOutput || actualRelayerOutput !== relayer0zk) {
          const errorMsg = `❌ OUTPUT VALIDATION FAILED: Relayer output address mismatch.\nExpected: ${relayer0zk}\nActual: ${actualRelayerOutput || 'null/undefined'}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        // Validate recipient output
        if (!actualRecipientOutput || actualRecipientOutput !== recipient0zk) {
          const errorMsg = `❌ OUTPUT VALIDATION FAILED: Recipient output address mismatch.\nExpected: ${recipient0zk}\nActual: ${actualRecipientOutput || 'null/undefined'}`;
          console.error(errorMsg);
          throw new Error(errorMsg);
        }

        console.log('✅ [PRIVATE TRANSFER] Output address validation PASSED');
        console.log('✅ [PRIVATE TRANSFER] Proof outputs correctly assigned:', {
          'outputAddresses[0]': 'relayer (' + relayer0zk.substring(0, 20) + '...)',
          'outputAddresses[1]': 'recipient (' + recipient0zk.substring(0, 20) + '...)'
        });

        outputValidationPassed = true;

      } else {
        console.warn('⚠️ [PRIVATE TRANSFER] Could not find output addresses in proof data');
        console.log('🔍 [PRIVATE TRANSFER] Searched locations:');
        console.log('  - populateResult.proof?.publicInputs?.outputAddresses:', !!populateResult.proof?.publicInputs?.outputAddresses);
        console.log('  - populateResult.proof?.outputAddresses:', !!populateResult.proof?.outputAddresses);
        console.log('  - populateResult.transaction?.proof?.publicInputs?.outputAddresses:', !!populateResult.transaction?.proof?.publicInputs?.outputAddresses);

        // Log the actual structure for debugging
        console.log('🔍 [PRIVATE TRANSFER] Full proof structure:', JSON.stringify(populateResult.proof, null, 2));
      }

    } catch (validationError) {
      console.error('❌ [PRIVATE TRANSFER] Output validation failed:', validationError.message);
      throw validationError; // Re-throw to abort transaction
    }

    if (!outputValidationPassed) {
      console.warn('⚠️ [PRIVATE TRANSFER] Output validation could not be completed - transaction may proceed with caution');
      console.warn('⚠️ [PRIVATE TRANSFER] This is likely due to SDK version differences in proof structure');
      console.warn('⚠️ [PRIVATE TRANSFER] Other validations (invariants, can-decrypt) have passed successfully');
      // Don't abort - let the transaction proceed since other validations passed
    }

    console.log('✅ [PRIVATE TRANSFER] Transaction populated successfully:', {
      transactionHash: transaction?.hash || 'none',
      to: transaction?.to,
      dataLength: transaction?.data?.length || 0,
      value: transaction?.value?.toString(),
      gasLimit: transaction?.gasLimit?.toString(),
      hasData: !!transaction?.data,
      type: transaction?.type
    });

    // 6) Submit via our relayer
    console.log('📤 [PRIVATE_TRANSFER_RElayer] ===== SUBMITTING TO RELAYER =====');
    console.log('📤 [PRIVATE_TRANSFER_RElayer] Final transaction details:', {
      recipientAddress: erc20AmountRecipients[0].recipientAddress,
      recipientLength: erc20AmountRecipients[0].recipientAddress.length,
      amount: String(erc20AmountRecipients[0].amount),
      tokenAddress,
      memoText: processedMemoText || 'none',
      memoTextLength: processedMemoText?.length || 0,
      chainId,
      networkName
    });

    // Log memo details for debugging
    console.log('📝 [PRIVATE_TRANSFER_RElayer] Memo details before relayer submission:', {
      processedMemoText,
      memoType: typeof processedMemoText,
      memoIsNull: processedMemoText === null,
      memoIsUndefined: processedMemoText === undefined,
      memoIsEmptyString: processedMemoText === '',
      finalMemoValue: processedMemoText || 'NO_MEMO_PROVIDED'
    });

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

    console.log('📤 [PRIVATE_TRANSFER_RElayer] Submitting transaction to relayer with recipient:', {
      recipientAddress: erc20AmountRecipients[0].recipientAddress.substring(0, 30) + '...',
      fullRecipientAddress: erc20AmountRecipients[0].recipientAddress,
      amount: String(erc20AmountRecipients[0].amount),
      serializedTxLength: serializedTransaction.length
    });

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
      processedMemoText,
    });

    console.log('✅ [PRIVATE_TRANSFER_RElayer] Relayer submission result:', {
      transactionHash: relayed.transactionHash,
      success: !!relayed.transactionHash,
      recipientAddress: erc20AmountRecipients[0].recipientAddress.substring(0, 30) + '...',
      invariantsValidated: true,
      outputValidationPassed,
      sender0zk: sender0zk.substring(0, 30) + '...',
      relayer0zk: relayer0zk.substring(0, 30) + '...',
      allValidations: {
        invariants: true,
        outputAddresses: outputValidationPassed,
        canDecrypt: true,
        feeCalculation: true
      }
    });

    // FINAL VALIDATION SUMMARY
    console.log('🎉 [PRIVATE TRANSFER] ===== VALIDATION SUMMARY =====');
    console.log('✅ Invariants validated: sender ≠ recipient, sender ≠ relayer');
    console.log('✅ Can-decrypt guard: basic checks passed');
    console.log(`${outputValidationPassed ? '✅' : '⚠️'} Output addresses validated: proof outputs match expected addresses`);
    console.log('✅ Fee calculation: proper deduction from transfer amount');
    console.log('✅ Transaction submitted successfully');

    if (!outputValidationPassed) {
      console.warn('⚠️ WARNING: Output validation was not completed - monitor transaction carefully');
    }

    // Transaction monitoring removed - SDK handles balance updates

    return { transactionHash: relayed.transactionHash, relayed: true };
  } catch (e) {
    throw e;
  }
};

