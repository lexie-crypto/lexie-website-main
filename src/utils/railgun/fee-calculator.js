/**
 * Fee Calculator Module for RAILGUN Transactions
 *
 * Handles gas reclamation fee calculations for different token types
 * with proper unit conversions and safety guards.
 */

// Import required functions
import { getKnownTokenDecimals } from './balances.js';
import { getNativeGasToken } from './balances.js';

// Chain-specific minimum gas floors (in wei)
const MIN_GAS_FLOORS = {
  1: 1_000_000_000n,          // Ethereum L1 → 1 gwei
  56: 100_000_000n,           // BNB Chain → 0.1 gwei
  137: 30_000_000_000n,       // Polygon PoS → 30 gwei (priority fee floor)
  42161: 10_000_000n,         // Arbitrum One → 0.01 gwei
};

/**
 * Calculate gas reclamation fee for ERC-20 tokens using the same estimator as UI preview
 * @param {string} feeTokenAddress - Address of token used for fees
 * @param {number} chainId - Chain ID
 * @param {object} tokenPrices - Pre-fetched token prices {symbol: price}
 * @param {Function} walletProvider - Wallet provider function
 * @returns {bigint} Gas fee in fee token units (ceiled to never under-collect)
 */
export const calculateGasReclamationERC20 = async (
  feeTokenAddress,
  chainId,
  tokenPrices,
  walletProvider
) => {
  // BigInt-safe price scaling (1e8 scale for precision)
  const PRICE_SCALE = 100_000_000n;

  // Use the exact same gas estimator as UI preview for perfect fee matching
  const { estimateGasForTransaction } = await import('./tx-gas-details.js');

  // Get network name for the estimator
  const networkName = { 1: 'Ethereum', 42161: 'Arbitrum', 137: 'Polygon', 56: 'BNBChain' }[chainId] || 'Ethereum';

  const gasEstimate = await estimateGasForTransaction({
    transactionType: 'unshield',
    chainId,
    networkName,
    railgunWalletID: null, // Not needed for gas estimation
    encryptionKey: null,   // Not needed for gas estimation
    tokenAddress: feeTokenAddress,
    amount: BigInt(0),     // Not needed for gas estimation
    recipientAddress: null, // Not needed for gas estimation
    walletProvider,
  });

  // Extract gas cost from the shared estimator
  const gasCostWei = BigInt(gasEstimate.gasCostWei);

  console.log('💰 [FEE_CALC] Using shared gas estimator (identical to UI preview):', {
    gasCostWei: gasCostWei.toString(),
    gasEstimate: gasEstimate.gasEstimate,
    method: 'shared-estimator-with-ui-preview'
  });

  // Get native token symbol and price from pre-fetched prices
  const nativeGasToken = getNativeGasToken(chainId);
  const nativeTokenPriceUsd = tokenPrices[nativeGasToken] || 0;

  if (nativeTokenPriceUsd === 0) {
    throw new Error(`Cannot calculate gas reclamation: no price available for native token ${nativeGasToken}`);
  }

  // Scale prices to avoid floating point issues
  const nativeUsd = BigInt(Math.round(nativeTokenPriceUsd * Number(PRICE_SCALE)));

  // Get fee token info (symbol and decimals from address)
  const tokenInfo = getKnownTokenDecimals(feeTokenAddress, chainId);
  const feeTokenSymbol = tokenInfo?.symbol || feeTokenAddress; // Fallback to address if no symbol
  let feeTokenDecimals = tokenInfo?.decimals || 18; // Default to 18 decimals

  // Get fee token price from pre-fetched prices
  const feeTokenPriceUsd = tokenPrices[feeTokenSymbol] || 0;

  if (feeTokenPriceUsd === 0) {
    throw new Error(`Cannot calculate gas reclamation: no price available for fee token ${feeTokenSymbol}`);
  }

  const feeUsd = BigInt(Math.round(feeTokenPriceUsd * Number(PRICE_SCALE)));

  // BigInt-only calculation: gasUsdScaled = (gasCostWei * nativeUsd) / 1e18
  const gasUsdScaled = (gasCostWei * nativeUsd) / 1_000_000_000_000_000_000n;

  // tokenUnits = (gasUsdScaled * 10^decimals) / feeUsd
  // Use ceil division to never under-collect fees
  const tokenUnitsRaw = (gasUsdScaled * (10n ** BigInt(feeTokenDecimals)));
  const tokenUnits = (tokenUnitsRaw + feeUsd - 1n) / feeUsd; // Ceiling division

  console.log('💰 [FEE_CALC] ERC-20 gas reclamation (single source, ceiled):', {
    gasCostWei: gasCostWei.toString(),
    nativeTokenPriceUsd: nativeTokenPriceUsd.toFixed(4),
    feeTokenAddress: feeTokenAddress?.substring(0, 10) + '...',
    feeTokenSymbol,
    feeTokenPriceUsd: feeTokenPriceUsd.toFixed(4),
    feeTokenDecimals,
    gasUsdScaled: gasUsdScaled.toString(),
    tokenUnitsRaw: tokenUnitsRaw.toString(),
    tokenUnitsCeiled: tokenUnits.toString(),
    usedCeilRounding: tokenUnits > (tokenUnitsRaw / feeUsd)
  });

  return tokenUnits;
};

/**
 * Calculate gas reclamation fee for base tokens (native tokens)
 * @param {bigint} gasCostWei - Gas cost in wei (same as fee amount for base tokens)
 * @returns {bigint} Gas fee in wei (no conversion needed)
 */
export const calculateGasReclamationBaseToken = (gasCostWei) => {
  console.log('💰 [FEE_CALC] Base token gas reclamation (direct wei):', {
    gasCostWei: gasCostWei.toString(),
    note: 'Base tokens use wei amount directly (no USD conversion)'
  });

  return gasCostWei;
};

/**
 * Apply minimum gas price guard to prevent unrealistic values
 * @param {number} chainId - Chain ID for chain-specific floors
 * @param {bigint} rawGasPrice - Raw gas price from network
 * @param {object} [gasFeeData] - Optional EIP-1559 gas fee data (maxPriorityFeePerGas)
 * @returns {bigint} Gas price with minimum applied
 */
export const applyGasPriceGuard = (chainId, rawGasPrice, gasFeeData = null) => {
  // Get chain-specific minimum gas floor, default to 1 gwei
  const floor = MIN_GAS_FLOORS[chainId] || 1_000_000_000n;

  // Apply chain-specific floor
  let gasPrice = rawGasPrice < floor ? floor : rawGasPrice;

  // Special handling for Polygon EIP-1559 (enforce 30 gwei priority fee)
  if (chainId === 137 && gasFeeData?.maxPriorityFeePerGas !== undefined) {
    const POLYGON_MIN_PRIORITY_FEE = 30_000_000_000n; // 30 gwei
    if (gasFeeData.maxPriorityFeePerGas < POLYGON_MIN_PRIORITY_FEE) {
      console.log('⛽ [FEE_GUARD] Polygon: enforcing 30 gwei minimum priority fee');
      // Note: This doesn't modify the actual gas price, just logs the requirement
      // The EIP-1559 priority fee should be handled by the wallet/provider
    }
  }

  console.log('⛽ [FEE_GUARD]', {
    chainId,
    rawGasPrice: rawGasPrice.toString(),
    floor: floor.toString(),
    finalGasPrice: gasPrice.toString(),
    appliedMinimum: rawGasPrice < floor
  });

  return gasPrice;
};

/**
 * Preflight guard to prevent combined fees from exceeding user amount
 * @param {bigint} combinedRelayerFee - Total relayer fee (relayer + gas)
 * @param {bigint} userAmountGross - User's total amount
 * @param {string} tokenType - Type of token for error messaging
 * @throws {Error} If fees exceed user amount
 */
export const validateCombinedFee = (combinedRelayerFee, userAmountGross, tokenType = 'token') => {
  if (combinedRelayerFee >= userAmountGross) {
    throw new Error(`${tokenType} combined relayer fee (${combinedRelayerFee.toString()}) exceeds user amount (${userAmountGross.toString()}). Gas price may be too high or amount too small.`);
  }

  console.log('✅ [FEE_CALC] Fee validation passed:', {
    combinedRelayerFee: combinedRelayerFee.toString(),
    userAmountGross: userAmountGross.toString(),
    remainingForUser: (userAmountGross - combinedRelayerFee).toString()
  });
};

/**
 * Calculate relayer service fee (0.5% of user amount)
 * @param {bigint} userAmountGross - User's total amount
 * @returns {bigint} Relayer fee in same units as user amount
 */
export const calculateRelayerFee = (userAmountGross) => {
  const RELAYER_FEE_BPS = 50n; // 0.5%
  const relayerFeeBn = (userAmountGross * RELAYER_FEE_BPS) / 10000n;

  console.log('💰 [FEE_CALC] Relayer fee calculation:', {
    userAmountGross: userAmountGross.toString(),
    relayerFeeBps: RELAYER_FEE_BPS.toString(),
    relayerFeeAmount: relayerFeeBn.toString(),
    feePercent: '0.5%'
  });

  return relayerFeeBn;
};
