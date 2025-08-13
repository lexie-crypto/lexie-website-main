/**
 * Gas Relayer Proxy - Direct calls without HMAC
 * Simple proxy to gas relayer backend with proper CORS
 */

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🚀 [GAS-RELAYER-${requestId}] ${req.method} request`, {
    method: req.method,
    url: req.url,
    origin: req.headers.origin,
    hasBody: !!req.body,
    timestamp: Date.now()
  });

  // Set CORS headers
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'https://lexiecrypto.com/wallet',
    'http://localhost:3000', 
    'http://localhost:5173'
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) || 
    (origin && origin.endsWith('.lexiecrypto.com')));
  
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [GAS-RELAYER-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET and POST methods
  if (!['GET', 'POST'].includes(req.method)) {
    console.log(`❌ [GAS-RELAYER-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Parse the URL to get the relayer endpoint
    const url = new URL(req.url, `http://${req.headers.host}`);
    const relayerPath = url.pathname.replace('/api/gas-relayer', '');
    
    console.log(`🔍 [GAS-RELAYER-${requestId}] URL parsing:`, {
      originalUrl: req.url,
      parsedPathname: url.pathname,
      relayerPath,
      host: req.headers.host
    });
    
    let backendUrl;
    
    if (relayerPath === '/health' || relayerPath === '') {
      // Health check endpoint
      backendUrl = `https://relayer.lexiecrypto.com/health`;
      
    } else if (relayerPath === '/estimate-fee') {
      // Fee estimation endpoint  
      backendUrl = `https://relayer.lexiecrypto.com/api/relay/estimate-fee`;
      
    } else if (relayerPath === '/submit') {
      // Transaction submission endpoint
      backendUrl = `https://relayer.lexiecrypto.com/api/relay/submit`;
      
    } else if (relayerPath === '/relayer/address') {
      // Relayer Railgun/EOA addresses endpoint
      backendUrl = `https://relayer.lexiecrypto.com/api/relayer/address`;
      
    } else {
      console.log(`❌ [GAS-RELAYER-${requestId}] Unknown relayer endpoint: ${relayerPath}`);
      return res.status(404).json({
        success: false,
        error: 'Unknown relayer endpoint'
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Gas-Relayer-Proxy/1.0',
    };

    console.log(`📡 [GAS-RELAYER-${requestId}] Forwarding to relayer: ${backendUrl}`);

    // Make the relayer request
    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    // Add body for POST requests
    if (req.method === 'POST') {
      fetchOptions.body = JSON.stringify(req.body);
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