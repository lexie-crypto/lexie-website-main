/**
 * Gas Relayer Client - Frontend Integration
 * 
 * Integrates with existing Lexie frontend to submit transactions
 * through the gas relayer for anonymous EOA submission
 */

import crypto from 'crypto-js';

// Use Vercel proxy instead of direct relayer calls for security
const RELAYER_PROXY_URL = '/api/gas-relayer';
const HMAC_SECRET = process.env.LEXIE_HMAC_SECRET;

if (!HMAC_SECRET) {
  console.warn('⚠️ LEXIE_HMAC_SECRET not configured - relayer will be disabled');
}

/**
 * Generate HMAC signature for authenticated requests
 */
function generateHmacSignature(payload, timestamp, secret = HMAC_SECRET) {
  if (!secret) {
    throw new Error('HMAC secret not configured');
  }
  
  const message = `${timestamp}:${JSON.stringify(payload)}`;
  return crypto.HmacSHA256(message, secret).toString();
}

/**
 * Create authenticated request headers
 */
function createAuthHeaders(payload) {
  if (!HMAC_SECRET) {
    throw new Error('HMAC secret not configured - cannot authenticate relayer requests');
  }
  
  const timestamp = Date.now().toString();
  const signature = generateHmacSignature(payload, timestamp);
  
  return {
    'X-Timestamp': timestamp,
    'X-Signature': signature,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': window.location.origin
  };
}

/**
 * Estimate relayer fees for a transaction
 */
export async function estimateRelayerFee({
  chainId,
  tokenAddress,
  amount,
  gasEstimate
}) {
  try {
    console.log('🧮 [RELAYER] Estimating relayer fees:', {
      chainId,
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      amount,
      gasEstimate
    });

    const payload = {
      chainId,
      tokenAddress,
      amount,
      gasEstimate: gasEstimate?.toString()
    };

    const response = await fetch(`${RELAYER_PROXY_URL}/estimate-fee`, {
      method: 'POST',
      headers: createAuthHeaders(payload),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Fee estimation failed: ${error.error}`);
    }

    const result = await response.json();
    
    console.log('✅ [RELAYER] Fee estimated:', result.feeEstimate);
    return result.feeEstimate;

  } catch (error) {
    console.error('❌ [RELAYER] Fee estimation failed:', error);
    throw new Error(`Failed to estimate relayer fees: ${error.message}`);
  }
}

/**
 * Submit transaction through gas relayer
 */
export async function submitRelayedTransaction({
  chainId,
  unsignedTransaction,
  tokenAddress,
  amount,
  userAddress,
  feeDetails
}) {
  try {
    console.log('🚀 [RELAYER] Submitting transaction through gas relayer:', {
      chainId,
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      amount,
      userAddress: userAddress?.slice(0, 10) + '...'
    });

    const payload = {
      chainId,
      unsignedTransaction,
      tokenAddress,
      amount,
      userAddress,
      feeDetails
    };

    const response = await fetch(`${RELAYER_PROXY_URL}/submit`, {
      method: 'POST',
      headers: createAuthHeaders(payload),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Transaction submission failed: ${error.error}`);
    }

    const result = await response.json();
    
    console.log('✅ [RELAYER] Transaction submitted successfully:', {
      transactionHash: result.transactionHash,
      gasUsed: result.gasUsed,
      totalFee: result.totalFee
    });

    return result;

  } catch (error) {
    console.error('❌ [RELAYER] Transaction submission failed:', error);
    throw new Error(`Failed to submit relayed transaction: ${error.message}`);
  }
}

/**
 * Check relayer service health
 */
export async function checkRelayerHealth() {
  try {
    const response = await fetch(`${RELAYER_PROXY_URL}/health`);
    
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const result = await response.json();
    return result.status === 'healthy';

  } catch (error) {
    console.error('❌ [RELAYER] Health check failed:', error);
    return false;
  }
}

/**
 * Get relayer address from environment (since it's fixed)
 */
export async function getRelayerAddress() {
  // Return the configured relayer address directly
  const relayerAddress = process.env.REACT_APP_RELAYER_ADDRESS;
  
  if (!relayerAddress) {
    console.error('❌ [RELAYER] REACT_APP_RELAYER_ADDRESS not configured');
    throw new Error('Relayer address not configured');
  }
  
  return relayerAddress;
}

/**
 * Helper function to calculate total transaction amount including fees
 */
export function calculateTotalAmountWithFees(baseAmount, feeEstimate) {
  const baseAmountBigInt = BigInt(baseAmount);
  const totalFeeBigInt = BigInt(feeEstimate.totalFee);
  return (baseAmountBigInt + totalFeeBigInt).toString();
}

/**
 * Configuration object for frontend integration
 */
export const RelayerConfig = {
  url: RELAYER_PROXY_URL,
  enabled: process.env.REACT_APP_RELAYER_ENABLED === 'true' && !!HMAC_SECRET,
  supportedNetworks: [42161, 1], // Arbitrum, Ethereum
  
  // Fee structure
  fees: {
    relayerPercent: 0.5,    // 0.5%
    protocolPercent: 0.25,  // 0.25%
    gasDynamic: true        // Plus dynamic gas costs
  },
  
  // Rate limiting
  rateLimit: {
    maxRequestsPerMinute: 10,
    windowMs: 60000
  },
  
  // Contract addresses
  contracts: {
    42161: {
      railgun: '0x892E3471CF11b412eAC6AfcaC5A43201D1bD496d',
      poi: '0x75b1aa53479Ad1F22078ec24Fbc151EB94dE47e8'
    }
  }
};

/**
 * Check if relayer should be used for this transaction
 */
export function shouldUseRelayer(chainId, amount) {
  if (!RelayerConfig.enabled) {
    console.log('🔄 [RELAYER] Disabled via configuration');
    return false;
  }
  
  if (!RelayerConfig.supportedNetworks.includes(chainId)) {
    console.log('🔄 [RELAYER] Unsupported network:', chainId);
    return false;
  }
  
  // Add minimum amount threshold if needed
  const minAmount = BigInt(process.env.REACT_APP_RELAYER_MIN_AMOUNT || '0');
  if (BigInt(amount) < minAmount) {
    console.log('🔄 [RELAYER] Amount below minimum threshold');
    return false;
  }
  
  return true;
}

export default {
  estimateRelayerFee,
  submitRelayedTransaction,
  checkRelayerHealth,
  getRelayerAddress,
  calculateTotalAmountWithFees,
  shouldUseRelayer,
  RelayerConfig
};