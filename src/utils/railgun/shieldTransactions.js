/**
 * RAILGUN Shield Transactions - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/tx-shield.ts
 * Converted to JavaScript with custom enhancements for Lexie Wallet
 */

import { getAddress, isAddress, keccak256, Contract } from 'ethers';
import React from 'react';
import { toast } from 'react-hot-toast';
import {
  gasEstimateForShield,
  populateShield,
  getShieldPrivateKeySignatureMessage,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  getEVMGasTypeForTransaction,
} from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import {
  gasEstimateForShieldBaseToken,
  populateShieldBaseToken,
} from '@railgun-community/wallet';
import { calculateGasPrice } from '@railgun-community/shared-models';
import { createShieldGasDetails, getTxFeeParams } from './tx-gas-details.js';
import { estimateGasWithBroadcasterFee } from './tx-gas-broadcaster-fee-estimator.js';
import { assertNotSanctioned } from '../sanctions/chainalysis-oracle.js';

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

// Wrapped base token per chain (minimal set)
const WRAPPED_BASE_TOKEN_BY_CHAIN = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (Ethereum)
  42161: '0x82af49447D8a07e3bd95BD0d56f35241523fBab1', // WETH (Arbitrum)
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC (Polygon)
  56: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB (BSC)
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Terminal-themed toast helper
 */
const showTerminalToast = (type, title, subtitle = '', opts = {}) => {
  const color = type === 'error' ? 'bg-red-400' : type === 'success' ? 'bg-emerald-400' : 'bg-yellow-400';
  return toast.custom((t) => (
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
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }, 
                className: 'ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer' 
              },
              '×'
            )
          ]
        )
      )
    )
  ), { duration: type === 'error' ? 4000 : 2500, ...opts });
};

/**
 * Check and ensure token approval for RAILGUN contract
 * @param {string} tokenAddress - Token contract address
 * @param {string} ownerAddress - Token owner address
 * @param {string} amount - Amount to approve
 * @param {Signer} walletProvider - Ethers signer (not provider)
 * @param {Object} transaction - Transaction object to get RAILGUN contract address
 * @returns {bigint} The effective amount that was approved (clamped to balance)
 */
const ensureTokenApproval = async (tokenAddress, ownerAddress, amount, walletProvider, transaction) => {
  if (!tokenAddress) {
    return true; // Native token (ETH) doesn't need allowance
  }

  try {
    // Get the RAILGUN contract address from the transaction
    const railgunContractAddress = transaction.to;
    if (!railgunContractAddress) {
      throw new Error('Could not determine RAILGUN contract address from transaction');
    }

    console.log('[ShieldTransactions] Checking token approval for RAILGUN contract:', {
      token: tokenAddress,
      owner: ownerAddress,
      spender: railgunContractAddress,
      amount: amount
    });

    // Simple ERC20 ABI for balance and allowance
    const erc20Abi = [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];

    // Use the signer directly (no re-wrapping needed)
    const signer = walletProvider; // This is now a signer, not a provider
    const tokenContract = new Contract(tokenAddress, erc20Abi, signer);
    
    // Check balance first
    const balance = await tokenContract.balanceOf(ownerAddress);
    const rawAmountBigInt = BigInt(amount);

    // Clamp approval request to never exceed balance
    const amountForApproval = rawAmountBigInt > balance ? balance : rawAmountBigInt;

    console.log('[ShieldTransactions] Token balance check:', {
      balance: balance.toString(),
      requested: rawAmountBigInt.toString(),
      clamped: amountForApproval.toString(),
      wasClamped: amountForApproval < rawAmountBigInt
    });

    // Use clamped amount for approval
    const amountBigInt = amountForApproval;
    
    // Check current allowance
    const currentAllowance = await tokenContract.allowance(ownerAddress, railgunContractAddress);
    
    console.log('[ShieldTransactions] Current allowance:', {
      current: currentAllowance.toString(),
      required: amountBigInt.toString(),
      needsApproval: currentAllowance < amountBigInt
    });
    
    // If allowance is insufficient, request approval
    if (currentAllowance < amountBigInt) {
      console.log('[ShieldTransactions] Requesting token approval...');
      const toastId = showTerminalToast('info', 'Approval required', 'Please approve token spend to add funds to your vault', { duration: 5000 });

      const approveTx = await tokenContract.approve(railgunContractAddress, amountBigInt);
      console.log('[ShieldTransactions] Approval transaction sent:', approveTx.hash);
      
      // Wait for approval confirmation
      const receipt = await approveTx.wait();
      console.log('[ShieldTransactions] Approval confirmed:', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });
      try { toast.dismiss(toastId); } catch {}
      showTerminalToast('success', 'Approval confirmed', 'Continue in your wallet to complete');

      return amountBigInt; // Return the effective approved amount
    }

    console.log('[ShieldTransactions] Token already approved, no action needed');
    return amountBigInt; // Return the effective approved amount
    
  } catch (error) {
    console.error('[ShieldTransactions] Token approval failed:', error);
    if (error.code === 4001 || error.code === 5000 || /reject/i.test(error?.message || '')) {
      showTerminalToast('error', 'Rejected by User');
      throw new Error('Rejected by User');
    }
    showTerminalToast('error', 'Approval failed', 'Please try again');
    throw new Error(`Approval failed: ${error.message}`);
  }
};

/**
 * Validate and checksum an Ethereum address
 */
const validateAddress = (address, paramName) => {
  if (!address || typeof address !== 'string') {
    throw new Error(`${paramName} must be a valid address string`);
  }
  if (!isAddress(address)) {
    throw new Error(`Invalid ${paramName}: ${address}`);
  }
  return getAddress(address);
};

/**
 * Generate shield private key from wallet signature
 * This is the key custom functionality to keep from the original implementation
 */
const generateShieldPrivateKey = async (fromAddress, walletSigner) => {
  try {
    if (!walletSigner) {
      throw new Error('Wallet signer required for shield private key generation');
    }

    console.log('[ShieldTransactions] Requesting shield signature from wallet...');
    const toastId = showTerminalToast('info', 'Sign to add funds to your vault', 'Approve the signature in your wallet', { duration: 6000 });
    const message = getShieldPrivateKeySignatureMessage();
    // Use signer.signMessage instead of provider.request
    const signature = await walletSigner.signMessage(message);

    console.log('[ShieldTransactions] Shield signature received');
    try { toast.dismiss(toastId); } catch {}
    showTerminalToast('success', 'Signature received');
    return keccak256(signature);
  } catch (error) {
    console.error('[ShieldTransactions] Failed to generate shield private key:', error);
    if (error.code === 4001 || error.code === 5000 || /reject/i.test(error?.message || '')) {
      showTerminalToast('error', 'Rejected by User');
      throw new Error('Rejected by User');
    }
    showTerminalToast('error', 'Signature failed', 'Please try again');
    throw new Error(`Failed to generate shield private key: ${error.message}`);
  }
};

/**
 * Create ERC20AmountRecipient object - simplified from original
 */
const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  // Process token address (null/zero address becomes undefined for native tokens)
  let processedTokenAddress;
  if (tokenAddress === null || tokenAddress === '0x0000000000000000000000000000000000000000') {
    processedTokenAddress = undefined; // Native token
  } else if (tokenAddress) {
    processedTokenAddress = validateAddress(tokenAddress, 'tokenAddress');
  } else {
    processedTokenAddress = undefined;
  }

  return {
    tokenAddress: processedTokenAddress,
    amount: BigInt(amount),
    recipientAddress: recipientAddress,
  };
};

/**
 * Enhanced gas estimation with broadcaster fee support
 */
const estimateShieldGasWithFees = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress,
  selectedBroadcaster = null
) => {
  // Create the gas estimation function
  const gasEstimateFunction = async (...params) => {
    return await gasEstimateForShield(...params);
  };

  // Prepare gas estimation parameters
  const gasEstimateParams = [
    txidVersion,
    networkName,
    shieldPrivateKey,
    erc20AmountRecipients,
    nftAmountRecipients,
    fromWalletAddress,
  ];

  // Use comprehensive gas estimation with broadcaster fee support
  return await estimateGasWithBroadcasterFee(
    networkName,
    gasEstimateFunction,
    gasEstimateParams,
    selectedBroadcaster,
    'shield'
  );
};

/**
 * Comprehensive gas estimation for shield transaction with broadcaster fee support
 */
export const estimateShieldGas = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress,
  selectedBroadcaster = null
) => {
  try {
    return await estimateShieldGasWithFees(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromWalletAddress,
      selectedBroadcaster
    );
  } catch (error) {
    throw new Error(`Shield gas estimation failed: ${error.message}`);
  }
};

/**
 * Build gas details for base token shield using dummy transaction approach
 * @param {Object} params - Parameters
 * @returns {Object} Gas details and estimates
 */
export const buildBaseTokenShieldGasAndEstimate = async ({
  chainId,
  networkName,
  railgunAddress,
  shieldPrivateKey,
  amount,
  tokenAddress,
  walletProvider,
}) => {
  try {
    const signer = walletProvider; // walletProvider is a Signer object, not a function
    const provider = signer.provider;

    const evmGasType = getEVMGasTypeForTransaction(networkName, true); // Always true for shield
    const originalFeeParams = await getTxFeeParams(provider, evmGasType, chainId);

    // Create originalGasDetails for SDK estimate
    const originalGasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            originalGasEstimate: 0n,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas
          }
        : {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice: originalFeeParams.gasPrice
          };

    // SDK dummy estimate for base token (the "dry run")
    console.log('[ShieldTransactions] Running dummy base token shield gas estimation...');
    const { gasEstimate } = await gasEstimateForShieldBaseToken(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      railgunAddress,
      shieldPrivateKey,
      { tokenAddress, amount: BigInt(amount) },
      await signer.getAddress() // fromAddress
    );

    console.log('[ShieldTransactions] Base token dummy gas estimate result:', {
      gasEstimate: gasEstimate.toString(),
      evmGasType,
      networkName
    });

    // Pad estimate for headroom (same padding reused for populate + submit)
    const paddedGasEstimate = (gasEstimate * 120n) / 100n;

    // Compute batch min gas price (SDK helper)
    const overallBatchMinGasPrice = await calculateGasPrice({
      evmGasType,
      gasEstimate,
      gasPrice: originalFeeParams.gasPrice,
      maxFeePerGas: originalFeeParams.maxFeePerGas,
      maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
    });

    // Final gasDetails to pass into populate()
    const gasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
          }
        : {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            gasPrice: originalFeeParams.gasPrice,
          };

    console.log('[ShieldTransactions] Using SDK dummy estimate for base token + live fee data', {
      chainId,
      evmGasType,
      gasEstimate: gasEstimate.toString(),
      paddedGasEstimate: paddedGasEstimate.toString(),
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      ...gasDetails,
    });

    return {
      gasDetails,
      paddedGasEstimate,
      overallBatchMinGasPrice,
      accurateGasEstimate: gasEstimate
    };

  } catch (error) {
    console.error('[ShieldTransactions] Failed to build base token shield gas and estimate:', error);
    throw new Error(`Failed to build base token shield gas and estimate: ${error.message}`);
  }
};

/**
 * Build gas details for shield using dummy transaction approach
 * One true source of gas: estimate → pad → reuse for populate + submit
 * @param {Object} params - Parameters
 * @returns {Object} Gas details and estimates
 */
export const buildShieldGasAndEstimate = async ({
  chainId,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  fromWalletAddress,
  walletProvider,
}) => {
  try {
    const signer = walletProvider; // walletProvider is a Signer object, not a function
    const provider = signer.provider;

    const evmGasType = getEVMGasTypeForTransaction(networkName, true); // Always true for shield
    const originalFeeParams = await getTxFeeParams(provider, evmGasType, chainId);

    // Create originalGasDetails for SDK estimate
    const originalGasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            originalGasEstimate: 0n,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas
          }
        : {
            evmGasType,
            originalGasEstimate: 0n,
            gasPrice: originalFeeParams.gasPrice
          };

    // SDK dummy estimate (the "dry run")
    console.log('[ShieldTransactions] Running dummy shield gas estimation...');
    const gasEstimateResponse = await gasEstimateForShield(
      TXIDVersion.V2_PoseidonMerkle,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromWalletAddress
    );

    const gasEstimate = gasEstimateResponse.gasEstimate || gasEstimateResponse;
    console.log('[ShieldTransactions] Dummy gas estimate result:', {
      gasEstimate: gasEstimate.toString(),
      evmGasType,
      networkName
    });

    // Pad estimate for headroom (same padding reused for populate + submit)
    const paddedGasEstimate = (gasEstimate * 120n) / 100n;

    // Compute batch min gas price (SDK helper)
    const overallBatchMinGasPrice = await calculateGasPrice({
      evmGasType,
      gasEstimate,
      gasPrice: originalFeeParams.gasPrice,
      maxFeePerGas: originalFeeParams.maxFeePerGas,
      maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
    });

    // Final gasDetails to pass into populate()
    const gasDetails =
      evmGasType === EVMGasType.Type2
        ? {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            maxFeePerGas: originalFeeParams.maxFeePerGas,
            maxPriorityFeePerGas: originalFeeParams.maxPriorityFeePerGas,
          }
        : {
            evmGasType,
            gasEstimate: paddedGasEstimate,
            gasPrice: originalFeeParams.gasPrice,
          };

    console.log('[ShieldTransactions] Using SDK dummy estimate + live fee data', {
      chainId,
      evmGasType,
      gasEstimate: gasEstimate.toString(),
      paddedGasEstimate: paddedGasEstimate.toString(),
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
      ...gasDetails,
    });

    return {
      gasDetails,
      paddedGasEstimate,
      overallBatchMinGasPrice,
      accurateGasEstimate: gasEstimate
    };

  } catch (error) {
    console.error('[ShieldTransactions] Failed to build shield gas and estimate:', error);
    throw new Error(`Failed to build shield gas and estimate: ${error.message}`);
  }
};

/**
 * Populate shield transaction - Official SDK pattern
 */
export const createShieldTransaction = async (
  txidVersion,
  networkName,
  shieldPrivateKey,
  erc20AmountRecipients,
  nftAmountRecipients,
  gasDetails
) => {
  try {
    const result = await populateShield(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      gasDetails
    );

    return {
      transaction: result.transaction,
      preTransactionPOIsPerTxidLeafPerList: result.preTransactionPOIsPerTxidLeafPerList || {},
    };
  } catch (error) {
    throw new Error(`Shield transaction creation failed: ${error.message}`);
  }
};

/**
 * Complete shield operation - Clean, focused API
 * @param {string} tokenAddress - Token contract address
 * @param {string} amount - Amount to shield (in token units)
 * @param {Object} chain - Chain configuration with id
 * @param {string} fromAddress - User's wallet address
 * @param {string} railgunAddress - Railgun privacy address
 * @param {Signer} walletProvider - Ethers signer (not provider) - avoids re-wrapping
 */
export const shieldTokens = async ({
  tokenAddress,
  amount,
  chain,
  fromAddress,
  railgunAddress,
  walletProvider
}) => {
  try {
    // Sanctions screen the user's EOA before proceeding
    console.log('[Sanctions] Starting screening for user EOA (shield):', {
      chainId: chain.id,
      address: fromAddress?.slice?.(0, 10) + '...'
    });
    await assertNotSanctioned(chain.id, fromAddress);
    console.log('[Sanctions] Screening passed for user EOA (shield)');
    // Enhanced validation with better error handling
    console.log('[ShieldTransactions] Input validation:', {
      amount: amount,
      amountType: typeof amount,
      tokenAddress,
      fromAddress: fromAddress?.slice(0, 8) + '...',
      railgunAddress: railgunAddress?.slice(0, 10) + '...',
    });

    // Convert amount to string if it's a number
    if (typeof amount === 'number') {
      amount = amount.toString();
    }
    
    if (!amount || typeof amount !== 'string' || amount.trim() === '') {
      throw new Error(`Invalid amount: received ${typeof amount} "${amount}", expected non-empty string`);
    }
    if (!chain?.id) {
      throw new Error(`Invalid chain: received ${JSON.stringify(chain)}, expected object with id property`);
    }
    if (!railgunAddress || typeof railgunAddress !== 'string' || !railgunAddress.startsWith('0zk')) {
      throw new Error(`Invalid Railgun address: received ${typeof railgunAddress} "${railgunAddress}", expected string starting with "0zk"`);
    }
    if (!fromAddress || typeof fromAddress !== 'string') {
      throw new Error(`Invalid fromAddress: received ${typeof fromAddress} "${fromAddress}", expected non-empty string`);
    }
    if (!walletProvider) {
      throw new Error('Wallet provider is required for shield operations');
    }

    // Validate addresses
    fromAddress = validateAddress(fromAddress, 'fromAddress');

    // Wait for Railgun readiness
    await waitForRailgunReady();

    // Base token branch (wrap-and-shield via Relay Adapt)
    const isBaseToken = !tokenAddress || tokenAddress === ZERO_ADDRESS;
    if (isBaseToken) {
      const networkName = getRailgunNetworkName(chain.id);
      const wrappedAddress = WRAPPED_BASE_TOKEN_BY_CHAIN[chain.id];
      if (!wrappedAddress) {
        throw new Error(`Unsupported chain for base token shielding: ${chain.id}`);
      }

      // Generate shield private key
      console.log('[ShieldTransactions] Requesting shield signature from wallet...');
      const toastId = showTerminalToast('info', 'Sign to add funds to your vault', 'Approve the signature in your wallet', { duration: 6000 });
      const shieldMessage = getShieldPrivateKeySignatureMessage();
      const signer = walletProvider; // walletProvider is a Signer object, not a function
      const signature = await signer.signMessage(shieldMessage);

      console.log('[ShieldTransactions] Shield signature received');
      try { toast.dismiss(toastId); } catch {}
      showTerminalToast('success', 'Signature received');
      const shieldPrivateKey = keccak256(signature);

      // Use dummy transaction gas estimation approach for base token
      console.log('[ShieldTransactions] Building base token gas details using dummy transaction approach...');
      const { gasDetails, paddedGasEstimate, overallBatchMinGasPrice, accurateGasEstimate } = await buildBaseTokenShieldGasAndEstimate({
        chainId: chain.id,
        networkName,
        railgunAddress,
        shieldPrivateKey,
        amount,
        tokenAddress: wrappedAddress,
        walletProvider,
      });

      // Build transaction via SDK
      const { transaction } = await populateShieldBaseToken(
        TXIDVersion.V2_PoseidonMerkle,
        networkName,
        railgunAddress,
        shieldPrivateKey,
        { tokenAddress: wrappedAddress, amount: BigInt(amount) },
        gasDetails,
      );

      transaction.from = fromAddress;

      // Return transaction for the caller to send (consistent with ERC20 flow)
      console.log('[ShieldTransactions] Base token shield transaction prepared');
      return {
        gasEstimate: accurateGasEstimate, // Return accurate estimate, not padded
        gasDetails,
        transaction,
        shieldPrivateKey,
        paddedGasEstimate,
        overallBatchMinGasPrice,
      };
    }

    // Get network configuration
    const networkName = getRailgunNetworkName(chain.id);
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    console.log('[ShieldTransactions] Starting shield operation:', {
      tokenAddress,
      amount,
      networkName,
      fromAddress: `${fromAddress.slice(0, 8)}...`,
      railgunAddress: `${railgunAddress.slice(0, 10)}...`,
    });

    // Generate shield private key
    const shieldPrivateKey = await generateShieldPrivateKey(fromAddress, walletProvider);

    // Create recipients
    const erc20AmountRecipient = createERC20AmountRecipient(tokenAddress, amount, railgunAddress);
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // Always empty for ERC20 shield

    // First, create a dummy transaction to get the RAILGUN contract address
    console.log('[ShieldTransactions] Creating initial transaction to determine RAILGUN contract...');
    const dummyGasDetails = createShieldGasDetails(networkName, BigInt(300000));
    const { transaction: dummyTx } = await createShieldTransaction(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      dummyGasDetails
    );

    // Now ensure token approval using the contract address from the transaction
    console.log('[ShieldTransactions] Ensuring token approval...');
    const approvedAmount = await ensureTokenApproval(tokenAddress, fromAddress, amount, walletProvider, dummyTx);

    // After approval, re-read balance and allowance to compute effective amount
    const requestedBigInt = BigInt(amount);
    let effectiveAmount = requestedBigInt;

    if (tokenAddress) {
      // For ERC20 tokens, check balance and allowance
      const erc20Abi = [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function balanceOf(address account) view returns (uint256)'
      ];
      const signer = walletProvider;
      const tokenContract = new Contract(tokenAddress, erc20Abi, signer);
      const railgunContractAddress = dummyTx.to;

      const finalBalance = await tokenContract.balanceOf(fromAddress);
      const finalAllowance = await tokenContract.allowance(fromAddress, railgunContractAddress);

      // Compute effective amount: min(requested, balance, allowance)
      effectiveAmount = requestedBigInt < finalBalance && requestedBigInt < finalAllowance
        ? requestedBigInt
        : finalBalance < finalAllowance ? finalBalance : finalAllowance;

      console.log('[ShieldTransactions] Effective amount calculation:', {
        requested: requestedBigInt.toString(),
        balance: finalBalance.toString(),
        allowance: finalAllowance.toString(),
        effectiveAmount: effectiveAmount.toString()
      });
    } else {
      // For native tokens, just use the requested amount (balance check happens elsewhere)
      console.log('[ShieldTransactions] Effective amount for native token:', {
        requested: requestedBigInt.toString(),
        effectiveAmount: effectiveAmount.toString()
      });
    }

    // Update erc20AmountRecipients with effective amount
    erc20AmountRecipients[0].amount = effectiveAmount;

    // Use dummy transaction gas estimation approach with effective amount
    console.log('[ShieldTransactions] Building gas details using dummy transaction approach...');
    const { gasDetails, paddedGasEstimate, overallBatchMinGasPrice, accurateGasEstimate } = await buildShieldGasAndEstimate({
      chainId: chain.id,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      fromWalletAddress: fromAddress,
      walletProvider,
    });

    const gasEstimate = accurateGasEstimate; // For compatibility with existing code
    
    const broadcasterFeeInfo = null; // No broadcaster for shield
    const iterations = 1; // Dummy transaction estimation

    console.log('[ShieldTransactions] Dummy transaction gas estimation completed:', {
      accurateGasEstimate: accurateGasEstimate.toString(),
      paddedGasEstimate: paddedGasEstimate.toString(),
      evmGasType: gasDetails.evmGasType,
      iterations,
      hasBroadcasterFee: !!broadcasterFeeInfo,
      overallBatchMinGasPrice: overallBatchMinGasPrice.toString(),
    });

    // Create final transaction with proper gas
    console.log('[ShieldTransactions] Creating final transaction...');
    const { transaction } = await createShieldTransaction(
      txidVersion,
      networkName,
      shieldPrivateKey,
      erc20AmountRecipients,
      nftAmountRecipients,
      gasDetails
    );

    // Set from address
    transaction.from = fromAddress;

    console.log('[ShieldTransactions] Shield operation completed successfully');
    return {
      gasEstimate: accurateGasEstimate, // Return the accurate estimate, not padded
      gasDetails,
      transaction,
      shieldPrivateKey,
      broadcasterFeeInfo,
      gasEstimationIterations: iterations,
      paddedGasEstimate,
      overallBatchMinGasPrice,
    };

  } catch (error) {
    console.error('[ShieldTransactions] Shield operation failed:', error);
    throw new Error(`Shield operation failed: ${error.message}`);
  }
};

export default {
  shieldTokens,
  estimateShieldGas,
  createShieldTransaction,
  buildShieldGasAndEstimate,
  buildBaseTokenShieldGasAndEstimate,
}; 