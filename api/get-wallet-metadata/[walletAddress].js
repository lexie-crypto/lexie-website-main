import crypto from 'crypto';

/**
 * Generate HMAC signature for backend authentication
 */
function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export const config = {
  api: {
    bodyParser: true, // Enable body parsing
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📤 [WALLET-PROXY-${requestId}] ${req.method} request to get-wallet-metadata`, {
    method: req.method,
    query: req.query,
    origin: req.headers.origin,
    timestamp: Date.now()
  });

  // Set CORS headers
  const origin = req.headers.origin;
  const allowedOrigins = ['https://lexiecrypto.com', 'http://localhost:3000', 'http://localhost:3001'];
  const isOriginAllowed = origin && allowedOrigins.includes(origin);
  
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [WALLET-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET method
  if (req.method !== 'GET') {
    console.log(`❌ [WALLET-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Extract wallet address from query parameters
    const { walletAddress } = req.query;
    
    if (!walletAddress) {
      console.log(`❌ [WALLET-PROXY-${requestId}] Missing walletAddress parameter`);
      return res.status(400).json({
        success: false,
        error: 'Missing walletAddress parameter'
      });
    }

    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`❌ [WALLET-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    // Generate HMAC signature for backend authentication
    const timestamp = Date.now().toString();
    const backendPath = `/api/get-wallet-metadata/${walletAddress}`;
    const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);

    // Prepare headers for backend request
    const headers = {
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': 'https://lexiecrypto.com',
      'User-Agent': 'Lexie-Proxy/1.0',
    };

    console.log(`🔐 [WALLET-PROXY-${requestId}] Generated HMAC headers for backend`, {
      timestamp,
      signature: signature.substring(0, 20) + '...',
      path: backendPath
    });

    // Forward request to backend
    const backendUrl = `https://api.lexiecrypto.com${backendPath}`;
    
    console.log(`📡 [WALLET-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

    const backendResponse = await fetch(backendUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000),
    });

    const result = await backendResponse.json();

    console.log(`✅ [WALLET-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [WALLET-PROXY-${requestId}] Error:`, {
      error: error.message,
      stack: error.stack,
      walletAddress: req.query.walletAddress?.slice(0, 8) + '...'
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Backend timeout - please try again' :
               'Internal proxy error'
      });
    }
  }
} 