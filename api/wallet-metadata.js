import crypto from 'crypto';

/**
 * Generate HMAC signature for backend authentication
 */
function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// No longer needed - using standardized HMAC format for both services

/**
 * Handle gas relayer requests
 */
async function handleGasRelayerRequest(req, res, requestId, hmacSecret) {
  console.log(`🚀 [GAS-RELAYER-${requestId}] ${req.method} request via wallet-metadata proxy`);
  
  // Parse the URL to get the relayer endpoint
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relayerPath = url.pathname.replace('/api/wallet-metadata/gas-relayer', '').replace('/api/gas-relayer', '');
  
  console.log(`🔍 [GAS-RELAYER-${requestId}] URL parsing:`, {
    originalUrl: req.url,
    parsedPathname: url.pathname,
    relayerPath,
    host: req.headers.host
  });
  
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
    console.log(`❌ [GAS-RELAYER-${requestId}] Unknown relayer endpoint: ${relayerPath}`);
    return res.status(404).json({
      success: false,
      error: 'Unknown relayer endpoint'
    });
  }

  const timestamp = Date.now().toString();
  const bodyString = req.method === 'POST' ? JSON.stringify(req.body) : '';
  const signature = generateGasRelayerHmacSignature(req.method, backendPath, timestamp, bodyString, hmacSecret);
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'Origin': 'https://app.lexiecrypto.com',
    'User-Agent': 'Lexie-Gas-Relayer-Proxy/1.0',
  };

  console.log(`🔐 [GAS-RELAYER-${requestId}] Generated HMAC headers`, {
    method: req.method,
    timestamp,
    signature: signature.substring(0, 20) + '...',
    path: backendPath
  });

  console.log(`📡 [GAS-RELAYER-${requestId}] Forwarding to relayer: ${backendUrl}`);

  try {
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
    const responseBody = await relayerResponse.text(); // Read as text first

    console.log(`✅ [GAS-RELAYER-${requestId}] Gas relayer responded with status ${relayerResponse.status}`);
    console.log(`✅ [GAS-RELAYER-${requestId}] Response body (first 200 chars): ${responseBody.substring(0, 200)}...`);

    // Attempt to parse as JSON, fallback to text
    try {
      const jsonResult = JSON.parse(responseBody);
      res.status(relayerResponse.status).json(jsonResult);
    } catch (jsonError) {
      console.error(`❌ [GAS-RELAYER-${requestId}] Failed to parse response as JSON:`, jsonError.message);
      res.status(relayerResponse.status).send(responseBody); // Send raw text if not JSON
    }

  } catch (error) {
    console.error(`❌ [GAS-RELAYER-${requestId}] Error:`, {
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

export const config = {
  api: {
    bodyParser: true, // Enable body parsing for JSON
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🔄 [WALLET-METADATA-PROXY-${requestId}] ${req.method} request`, {
    method: req.method,
    query: req.query,
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
    'http://localhost:3001',
    'http://localhost:5173'
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) || 
    (origin && origin.endsWith('.lexiecrypto.com')));
  
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Signature, X-Timestamp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [WALLET-METADATA-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET and POST methods
  if (!['GET', 'POST'].includes(req.method)) {
    console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`❌ [WALLET-METADATA-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    let backendPath, backendUrl, headers;
    const timestamp = Date.now().toString();

      // Check if this is a gas relayer request
  const url = new URL(req.url, `http://${req.headers.host}`);
  const isGasRelayerRequest = url.pathname.includes('/gas-relayer');
  
  if (isGasRelayerRequest) {
    // Handle gas relayer routing
    return await handleGasRelayerRequest(req, res, requestId, hmacSecret);
  }

  // Detect request type based on query parameters
  const { 
    walletAddress, 
    action, 
    walletId,
    tokenAddress,
    requiredAmount 
  } = req.query;

    if (req.method === 'GET') {
      if (action === 'balances') {
        // Handle GET: wallet balances with notes
        if (!walletAddress || !walletId) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing walletAddress or walletId for balances`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletAddress or walletId parameters'
          });
        }

        backendPath = `/api/wallet-notes/balances?walletAddress=${encodeURIComponent(walletAddress)}&walletId=${encodeURIComponent(walletId)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        
        console.log(`📊 [WALLET-METADATA-PROXY-${requestId}] GET balances for wallet ${walletAddress?.slice(0, 8)}...`);

      } else {
        // Handle GET: retrieve wallet metadata (original functionality)
        if (!walletAddress) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing walletAddress parameter for GET`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletAddress parameter'
          });
        }

        backendPath = `/api/get-wallet-metadata/${walletAddress}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET request for wallet ${walletAddress?.slice(0, 8)}...`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

    } else if (req.method === 'POST') {
      // Detect POST endpoint based on action parameter or body content
      if (action === 'unspent') {
        // Handle POST: get unspent notes for token
        backendPath = '/api/wallet-notes/unspent';
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] POST unspent notes request`);

      } else if (action === 'capture-shield') {
        // Handle POST: capture shield note
        backendPath = '/api/wallet-notes/capture-shield';
        console.log(`🛡️ [WALLET-METADATA-PROXY-${requestId}] POST capture shield note`);

      } else if (action === 'capture-change') {
        // Handle POST: capture change note
        backendPath = '/api/wallet-notes/capture-change';
        console.log(`🔄 [WALLET-METADATA-PROXY-${requestId}] POST capture change note`);

      } else if (action === 'mark-spent') {
        // Handle POST: mark note as spent
        backendPath = '/api/wallet-notes/mark-spent';
        console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] POST mark note as spent`);

      } else if (action === 'process-unshield') {
        // Handle POST: atomic unshield operation (mark spent + capture change)
        backendPath = '/api/wallet-notes/process-unshield';
        console.log(`⚛️ [WALLET-METADATA-PROXY-${requestId}] POST atomic unshield operation`);

      } else {
        // Handle POST: store wallet metadata (original functionality)
        backendPath = '/api/store-wallet-metadata';
        console.log(`💾 [WALLET-METADATA-PROXY-${requestId}] POST store wallet metadata`);
      }

      backendUrl = `https://api.lexiecrypto.com${backendPath}`;
      
      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };
    }

    console.log(`🔐 [WALLET-METADATA-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: headers['X-Lexie-Signature'].substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [WALLET-METADATA-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

    // Make the backend request
    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    // Add body for POST requests
    if (req.method === 'POST') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const backendResponse = await fetch(backendUrl, fetchOptions);
    const result = await backendResponse.json();

    console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [WALLET-METADATA-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      action: req.query.action || 'metadata',
      walletAddress: req.query.walletAddress?.slice(0, 8) + '...' || 'N/A'
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