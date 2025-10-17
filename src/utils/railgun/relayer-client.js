/**
 * Gas Relayer Client - Frontend Integration
 * 
 * Integrates with existing Lexie frontend to submit transactions
 * through the gas relayer for anonymous EOA submission
 */

// Route through Next.js proxy to the gas relayer backend (for HMAC-protected POSTs)
const RELAYER_PROXY_URL = '/api/gas-relayer';

// Direct backend URL used for public GETs (health, address fallback)
let RELAYER_BACKEND_URL = 'https://relayer.lexiecrypto.com';
try {
  if (import.meta && import.meta.env && import.meta.env.VITE_RELAYER_BACKEND_URL) {
    RELAYER_BACKEND_URL = import.meta.env.VITE_RELAYER_BACKEND_URL;
  }
} catch (_e) {}
if (typeof window !== 'undefined' && window.VITE_RELAYER_BACKEND_URL) {
  RELAYER_BACKEND_URL = window.VITE_RELAYER_BACKEND_URL;
}

// Ensure backend URL uses https and has no trailing slash
function normalizeBackendUrl(url) {
  try {
    let u = url || '';
    if (!u) return 'https://relayer.lexiecrypto.com';
    if (u.startsWith('//')) u = 'https:' + u; // protocol-relative -> https
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u; // missing protocol -> https
    if (u.startsWith('http://')) u = 'https://' + u.slice(7); // upgrade to https
    return u.replace(/\/+$/, '');
  } catch {
    return 'https://relayer.lexiecrypto.com';
  }
}

RELAYER_BACKEND_URL = normalizeBackendUrl(RELAYER_BACKEND_URL);

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

    // Single-route proxy with endpoint query
    const feeUrl = `${RELAYER_PROXY_URL}?endpoint=estimate-fee`;
    console.log(`💰 [RELAYER] Calling fee estimation at: ${feeUrl}`);
    console.log(`💰 [RELAYER] Full URL: ${window.location.origin}${feeUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute for fee estimation
    
    try {
      const response = await fetch(feeUrl, {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
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
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('❌ [RELAYER] Fee estimation timed out after 1 minute');
        throw new Error('Fee estimation timed out after 1 minute. Please try again.');
      }
      console.error('❌ [RELAYER] Fee estimation failed:', error);
      throw new Error(`Failed to estimate relayer fees: ${error.message}`);
    }
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
  gasEstimate,
  memoText
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
      gasEstimate,
      memoText
    };

    // 1) Get presigned HMAC headers from proxy to avoid exposing secrets
    console.log('🔐 [RELAYER] Requesting presigned headers from proxy...');
    const presignController = new AbortController();
    const presignTimeout = setTimeout(() => presignController.abort(), 15000); // 15s
    let presign;
    try {
      const presignResp = await fetch(`${RELAYER_PROXY_URL}?endpoint=presign`, {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify({}),
        signal: presignController.signal
      });
      clearTimeout(presignTimeout);
      if (!presignResp.ok) {
        const errTxt = await presignResp.text();
        throw new Error(`Presign failed: ${errTxt.substring(0, 200)}...`);
      }
      presign = await presignResp.json();
      if (!presign?.headers?.['X-Lexie-Signature'] || !presign?.headers?.['X-Lexie-Timestamp']) {
        throw new Error('Presign response missing required headers');
      }
      console.log('🔐 [RELAYER] Presign headers acquired');
    } catch (e) {
      clearTimeout(presignTimeout);
      console.error('❌ [RELAYER] Presign step failed:', e);
      throw new Error(`Failed to obtain presigned headers: ${e.message}`);
    }

    // 2) Submit directly to Railway backend with HMAC headers (bypass proxy limits)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes timeout
    try {
      const directUrl = `${RELAYER_BACKEND_URL}/api/relay/submit`;
      console.log('🚀 [RELAYER] Submitting directly to backend:', directUrl);
      const response = await fetch(directUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Lexie-Signature': presign.headers['X-Lexie-Signature'],
          'X-Lexie-Timestamp': presign.headers['X-Lexie-Timestamp'],
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return await handleResponse(response);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Transaction submission timed out after 3 minutes. The transaction may still be processed.');
      }
      throw error;
    }
    
    async function handleResponse(response) {
      // Handle provider overload errors specially
      if (!response.ok) {
        let errorText;
        let errorJson;

        try {
          errorText = await response.text();
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = { error: errorText || 'Unknown error' };
        }

        // Check for provider overload errors that may still have generated a transaction hash
        const isProviderOverload = errorJson.error && (
          errorJson.error.includes('Pending acquire queue has reached its maximum size') ||
          errorJson.error.includes('ChainException') ||
          errorJson.code === -32005
        );

        if (isProviderOverload) {
          console.warn('⚠️ [RELAYER] Provider overload detected, checking for transaction hash...');

          // If we have a transaction hash despite the error, treat it as successful
          if (errorJson.transactionHash) {
            console.log('✅ [RELAYER] Transaction hash found despite provider overload - treating as success:', {
              transactionHash: errorJson.transactionHash,
              gasUsed: errorJson.gasUsed,
              totalFee: errorJson.totalFee
            });

            return {
              transactionHash: errorJson.transactionHash,
              gasUsed: errorJson.gasUsed,
              totalFee: errorJson.totalFee,
              providerOverload: true,
              retryable: true,
              code: -32005
            };
          }
        }

        throw new Error(`Transaction submission failed: ${errorJson.error}`);
      }

      const result = await response.json();

      console.log('✅ [RELAYER] Transaction submitted successfully:', {
        transactionHash: result.transactionHash,
        gasUsed: result.gasUsed,
        totalFee: result.totalFee
      });

      return result;
    }

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
    // Call backend directly (no proxy, no HMAC) to avoid CDN challenges
    const healthUrl = `${RELAYER_BACKEND_URL}/health`;
    console.log(`🏥 [RELAYER] Checking health at (direct): ${healthUrl}`);
    
    const response = await fetch(healthUrl, {
      headers: { 'Accept': 'application/json' }
    });
    
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
      url: `${RELAYER_BACKEND_URL}/health`,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

/**
 * Get relayer address from environment (since it's fixed)
 */
export async function getRelayerAddress() {
  // Prefer build-time configured address if provided
  let envAddress;
  try {
    // Vite-style env
    envAddress = import.meta && import.meta.env && import.meta.env.VITE_RELAYER_ADDRESS;
  } catch (_e) {
    // ignore
  }
  if (!envAddress && typeof process !== 'undefined' && process.env) {
    envAddress = process.env.VITE_RELAYER_ADDRESS;
  }
  if (!envAddress && typeof window !== 'undefined') {
    envAddress = window.VITE_RELAYER_ADDRESS;
  }
  if (envAddress) return envAddress;

  // Fallback to proxy API if not configured via env
  try {
    const response = await fetch(`${RELAYER_PROXY_URL}?endpoint=address`, {
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
    return data.railgunAddress;
  } catch (error) {
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
  supportedNetworks: [42161, 1, 56, 137], // Arbitrum, Ethereum, BNB Chain, Polygon
  
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
    1: {
      railgun: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // Ethereum - Official Railgun Protocol
      poi: '0xc480f68a3dcc3edd82134fab45c14a0fcf1da3cc'     // Ethereum - Official POI
    },
    42161: {
      railgun: '0x892E3471CF11b412eAC6AfcaC5A43201D1bD496d', // Arbitrum - Custom zero-delay deployment
      poi: '0x75b1aa53479Ad1F22078ec24Fbc151EB94dE47e8'     // Arbitrum - Custom zero-delay POI
    },
    56: {
      railgun: '0x590162bf4b50f6576a459b75309ee21d92178a10', // BNB Chain - Official Railgun Protocol
      poi: '0xc3f2c8f9d5f0705de706b1302b7a039e1e11ac88'     // BNB Chain - Official POI
    },
    137: {
      railgun: '0x19b620929f97b7b990801496c3b361ca5def8c71', // Polygon - Official Railgun Protocol
      poi: '0xc3f2c8f9d5f0705de706b1302b7a039e1e11ac88'     // Polygon - Official POI
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