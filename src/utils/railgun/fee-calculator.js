/**
 * Fee Calculator Module for RAILGUN Transactions
 *
 * Handles gas reclamation fee calculations for different token types
 * with proper unit conversions and safety guards.
 */

// Import required functions
import { getKnownTokenDecimals } from './balances.js';
import { getNativeGasToken } from './balances.js';

/**
 * Calculate gas reclamation fee for ERC-20 tokens
 * @param {bigint} gasCostWei - Gas cost in wei
 * @param {string} feeTokenAddress - Address of token used for fees
 * @param {number} chainId - Chain ID
 * @param {Function} fetchTokenPrices - Function to fetch token prices
 * @returns {bigint} Gas fee in fee token units
 */
export const calculateGasReclamationERC20 = async (
  gasCostWei,
  feeTokenAddress,
  chainId,
  fetchTokenPrices
) => {
  // BigInt-safe price scaling (1e8 scale for precision)
  const PRICE_SCALE = 100_000_000n;

  // Get native token symbol and price from CoinGecko (no hardcoded fallbacks)
  const nativeGasToken = getNativeGasToken(chainId);
  let nativeTokenPriceUsd = 0;
  try {
    const prices = await fetchTokenPrices([nativeGasToken]);
    nativeTokenPriceUsd = prices[nativeGasToken] || 0;
    if (nativeTokenPriceUsd === 0) {
      console.warn(`⚠️ [FEE_CALC] No price available for native token ${nativeGasToken}`);
    }
  } catch (priceError) {
    console.warn(`⚠️ [FEE_CALC] Failed to fetch native token price for ${nativeGasToken}:`, priceError.message);
  }

  if (nativeTokenPriceUsd === 0) {
    throw new Error(`Cannot calculate gas reclamation: no price available for native token ${nativeGasToken}`);
  }

  // Scale prices to avoid floating point issues
  const nativeUsd = BigInt(Math.round(nativeTokenPriceUsd * Number(PRICE_SCALE)));

  // Get fee token info (symbol and decimals from address)
  const tokenInfo = getKnownTokenDecimals(feeTokenAddress, chainId);
  const feeTokenSymbol = tokenInfo?.symbol || feeTokenAddress; // Fallback to address if no symbol
  let feeTokenDecimals = tokenInfo?.decimals || 18; // Default to 18 decimals

  // Get fee token price using symbol from CoinGecko (no hardcoded fallbacks)
  let feeTokenPriceUsd = 0;
  try {
    const prices = await fetchTokenPrices([feeTokenSymbol]);
    feeTokenPriceUsd = prices[feeTokenSymbol] || 0;
    if (feeTokenPriceUsd === 0) {
      console.warn(`⚠️ [FEE_CALC] No price available for fee token ${feeTokenSymbol}`);
    }
  } catch (priceError) {
    console.warn(`⚠️ [FEE_CALC] Failed to fetch fee token price for ${feeTokenSymbol}:`, priceError.message);
  }

  if (feeTokenPriceUsd === 0) {
    throw new Error(`Cannot calculate gas reclamation: no price available for fee token ${feeTokenSymbol}`);
  }

  const feeUsd = BigInt(Math.round(feeTokenPriceUsd * Number(PRICE_SCALE)));

  // BigInt-only calculation: gasUsdScaled = (gasCostWei * nativeUsd) / 1e18
  const gasUsdScaled = (gasCostWei * nativeUsd) / 1_000_000_000_000_000_000n;

  // tokenUnits = (gasUsdScaled * 10^decimals) / feeUsd
  const tokenUnits = (gasUsdScaled * (10n ** BigInt(feeTokenDecimals))) / feeUsd;

  console.log('💰 [FEE_CALC] ERC-20 gas reclamation (bigint-safe):', {
    gasCostWei: gasCostWei.toString(),
    nativeTokenPriceUsd: nativeTokenPriceUsd.toFixed(4),
    feeTokenAddress: feeTokenAddress?.substring(0, 10) + '...',
    feeTokenSymbol,
    feeTokenPriceUsd: feeTokenPriceUsd.toFixed(4),
    feeTokenDecimals,
    gasUsdScaled: gasUsdScaled.toString(),
    tokenUnits: tokenUnits.toString()
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
 * @param {bigint} rawGasPrice - Raw gas price from network
 * @returns {bigint} Gas price with minimum applied
 */
export const applyGasPriceGuard = (rawGasPrice) => {
  const MIN_GAS_PRICE_WEI = BigInt('1000000000'); // 1 gwei minimum
  const gasPrice = rawGasPrice < MIN_GAS_PRICE_WEI ? MIN_GAS_PRICE_WEI : rawGasPrice;

  console.log('⛽ [FEE_CALC] Gas price validation:', {
    rawGasPrice: rawGasPrice.toString(),
    minGasPrice: MIN_GAS_PRICE_WEI.toString(),
    finalGasPrice: gasPrice.toString(),
    appliedMinimum: rawGasPrice < MIN_GAS_PRICE_WEI
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
