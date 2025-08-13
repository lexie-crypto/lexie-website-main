/**
 * Gas Relayer Client - Frontend Integration
 * 
 * Integrates with existing Lexie frontend to submit transactions
 * through the gas relayer for anonymous EOA submission
 */

// Route through Next.js proxy to the gas relayer backend
const RELAYER_PROXY_URL = '/api/gas-relayer';

/**
 * Create simple headers for relayer requests (no HMAC needed)
 */
function createHeaders() {
  return {
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

    // Route through proxy flat path (no nested segments)
    const feeUrl = `${RELAYER_PROXY_URL}/estimate-fee`;
    console.log(`💰 [RELAYER] Calling fee estimation at: ${feeUrl}`);
    console.log(`💰 [RELAYER] Full URL: ${window.location.origin}${feeUrl}`);
    
    const response = await fetch(feeUrl, {
      method: 'POST',
      headers: createHeaders(),
      body: JSON.stringify(payload)
    });

    console.log(`💰 [RELAYER] Fee response status: ${response.status}`);
    console.log(`💰 [RELAYER] Fee response headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [RELAYER] Fee estimation failed - Status: ${response.status}, Response: ${errorText.substring(0, 200)}...`);
      
      // Try to parse as JSON, but fallback to text if it fails
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: errorText };
      }
      throw new Error(`Fee estimation failed: ${error.error || 'Unknown error'}`);
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
  serializedTransaction,
  tokenAddress,
  amount,
  userAddress,
  feeDetails,
  gasEstimate
}) {
  try {
    console.log('🚀 [RELAYER] Submitting serialized transaction through gas relayer:', {
      chainId,
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      amount,
      userAddress: userAddress?.slice(0, 10) + '...',
      serializedTxLength: serializedTransaction?.length
    });

    const payload = {
      chainId,
      serializedTransaction,
      tokenAddress,
      amount,
      userAddress,
      feeDetails,
      gasEstimate
    };

    // Route through proxy flat path (no nested segments)
    const response = await fetch(`${RELAYER_PROXY_URL}/submit`, {
      method: 'POST',
      headers: createHeaders(),
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
    const healthUrl = `${RELAYER_PROXY_URL}/health`;
    console.log(`🏥 [RELAYER] Checking health at: ${healthUrl}`);
    console.log(`🏥 [RELAYER] Full URL: ${window.location.origin}${healthUrl}`);
    
    const response = await fetch(healthUrl);
    
    console.log(`🏥 [RELAYER] Health response status: ${response.status}`);
    console.log(`🏥 [RELAYER] Health response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [RELAYER] Health check failed - Status: ${response.status}, Response: ${errorText.substring(0, 200)}...`);
      throw new Error(`Health check failed: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    const result = await response.json();
    console.log(`🏥 [RELAYER] Health check result:`, result);
    
    const isHealthy = result.status === 'healthy';
    if (isHealthy) {
      console.log('✅ [RELAYER] Gas relayer service is healthy and ready');
    } else {
      console.warn('⚠️ [RELAYER] Gas relayer responded but status is not healthy:', result.status);
    }
    
    return isHealthy;

  } catch (error) {
    console.error('❌ [RELAYER] Health check failed with error:', {
      message: error.message,
      url: `${RELAYER_PROXY_URL}/health`,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

/**
 * Get relayer address from environment (since it's fixed)
 */
export async function getRelayerAddress() {
  try {
    // Route through proxy flat path (no nested segments)
    const response = await fetch(`${RELAYER_PROXY_URL}/relayer/address`, {
      method: 'GET',
      headers: createHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get relayer address: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.railgunAddress) {
      throw new Error('No RAILGUN address returned from relayer');
    }

    console.log('📍 [RELAYER] Got RAILGUN address:', data.railgunAddress);
    return data.railgunAddress;
    
  } catch (error) {
    console.error('❌ [RELAYER] Failed to get relayer address:', error);
    throw new Error(`Could not get relayer RAILGUN address: ${error.message}`);
  }
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
  console.log('🚀 [RELAYER] Always attempting gas relayer first for anonymous transactions');
  console.log('🔍 [RELAYER] Transaction details:', {
    chainId,
    amount,
    supportedNetwork: RelayerConfig.supportedNetworks.includes(chainId),
    url: RelayerConfig.url
  });
  
  // Log warnings but don't prevent relayer attempt
  if (!RelayerConfig.supportedNetworks.includes(chainId)) {
    console.warn('⚠️ [RELAYER] Unsupported network - may fail:', chainId);
  }
  
  const minAmount = BigInt(process.env.REACT_APP_RELAYER_MIN_AMOUNT || '0');
  if (BigInt(amount) < minAmount) {
    console.warn('⚠️ [RELAYER] Amount below minimum threshold - may not be worth relayer fees');
  }
  
  // Always try the relayer - let it fail gracefully if needed
  console.log('✅ [RELAYER] Will attempt gas relayer submission');
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