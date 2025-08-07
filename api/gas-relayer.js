import crypto from 'crypto';

/**
 * Generate HMAC signature for gas relayer authentication
 */
function generateHmacSignature(method, path, timestamp, body, secret) {
  const payload = `${method}:${path}:${timestamp}:${body || ''}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🚀 [GAS-RELAYER-PROXY-${requestId}] ${req.method} request`, {
    method: req.method,
    path: req.url,
    origin: req.headers.origin,
    hasBody: !!req.body,
    timestamp: Date.now()
  });

  // Set CORS headers
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com', 
    'http://localhost:3000', 
    'http://localhost:5173'
  ];
  const isOriginAllowed = origin && allowedOrigins.some(allowed => 
    origin === allowed || origin.endsWith('.lexiecrypto.com')
  );
  
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Signature, X-Timestamp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [GAS-RELAYER-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET and POST methods
  if (!['GET', 'POST'].includes(req.method)) {
    console.log(`❌ [GAS-RELAYER-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`❌ [GAS-RELAYER-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    // Parse the URL to get the relayer endpoint
    const url = new URL(req.url, `http://${req.headers.host}`);
    const relayerPath = url.pathname.replace('/api/gas-relayer', '');
    
    let backendPath, backendUrl;
    
    if (relayerPath === '/health' || relayerPath === '') {
      // Health check endpoint
      backendPath = '/health';
      backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
      
    } else if (relayerPath === '/estimate-fee') {
      // Fee estimation endpoint  
      backendPath = '/api/relay/estimate-fee';
      backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
      
    } else if (relayerPath === '/submit') {
      // Transaction submission endpoint
      backendPath = '/api/relay/submit';
      backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
      
    } else {
      console.log(`❌ [GAS-RELAYER-PROXY-${requestId}] Unknown relayer endpoint: ${relayerPath}`);
      return res.status(404).json({
        success: false,
        error: 'Unknown relayer endpoint'
      });
    }

    const timestamp = Date.now().toString();
    const bodyString = req.method === 'POST' ? JSON.stringify(req.body) : '';
    const signature = generateHmacSignature(req.method, backendPath, timestamp, bodyString, hmacSecret);
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'Origin': 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Gas-Relayer-Proxy/1.0',
    };

    console.log(`🔐 [GAS-RELAYER-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: signature.substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [GAS-RELAYER-PROXY-${requestId}] Forwarding to relayer: ${backendUrl}`);

    // Make the relayer request
    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    // Add body for POST requests
    if (req.method === 'POST') {
      fetchOptions.body = bodyString;
    }

    const relayerResponse = await fetch(backendUrl, fetchOptions);
    const result = await relayerResponse.json();

    console.log(`✅ [GAS-RELAYER-PROXY-${requestId}] Gas relayer responded with status ${relayerResponse.status}`);

    // Forward the relayer response
    res.status(relayerResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [GAS-RELAYER-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      path: req.url
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Gas relayer timeout - please try again' :
               error.message.includes('502') ? 'Gas relayer service unavailable' :
               'Internal proxy error'
      });
    }
  }
}