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
    bodyParser: true, // Enable body parsing for JSON
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🚀 [WALLET-PROXY-${requestId}] ${req.method} request to store-wallet-metadata`, {
    method: req.method,
    origin: req.headers.origin,
    hasBody: !!req.body,
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [WALLET-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow POST method
  if (req.method !== 'POST') {
    console.log(`❌ [WALLET-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
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
    const backendPath = '/api/store-wallet-metadata';
    const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

    // Prepare headers for backend request
    const headers = {
      'Content-Type': 'application/json',
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
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000),
    });

    const result = await backendResponse.json();

    console.log(`✅ [WALLET-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [WALLET-PROXY-${requestId}] Error:`, {
      error: error.message,
      stack: error.stack
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