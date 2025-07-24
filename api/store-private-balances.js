/**
 * Vercel Serverless Function - Store Private Balances Proxy
 * Proxies requests to lexie-be backend with HMAC authentication
 */

import crypto from 'crypto';

// Configure body parser for proper request handling
export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Generate HMAC authentication headers for backend calls (matching old working code pattern)
 */
function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function generateBackendAuthHeaders(method, path) {
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    throw new Error('LEXIE_HMAC_SECRET environment variable is required for backend calls');
  }

  const timestamp = Date.now().toString();
  const signature = generateHmacSignature(method, path, timestamp, hmacSecret);

  return {
    'Content-Type': 'application/json',
    'X-Lexie-Timestamp': timestamp,
    'X-Lexie-Signature': signature
  };
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Only POST requests are supported.' 
    });
  }

  try {
    console.log('[STORE-PRIVATE-BALANCES-PROXY] 🔄 Proxying request to lexie-be backend');

    // Validate request body
    if (!req.body) {
      return res.status(400).json({ 
        success: false,
        error: 'No request body received' 
      });
    }

    const { walletId, chainId, balances } = req.body;

    // Basic validation
    if (!walletId || !chainId || !Array.isArray(balances)) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: walletId, chainId, balances' 
      });
    }

    // Proxy request to lexie-be backend
    const backendUrl = process.env.LEXIE_BACKEND_URL || 'https://api.lexiecrypto.com';
    const apiPath = '/api/store-private-balances'; // Exact path that backend will receive
    const endpoint = `${backendUrl}${apiPath}`;
    
    const headers = generateBackendAuthHeaders('POST', apiPath);
    
    console.log(`[STORE-PRIVATE-BALANCES-PROXY] 🔐 HMAC Debug:`, {
      method: 'POST',
      path: apiPath,
      timestamp: headers['X-Lexie-Timestamp'],
      signature: headers['X-Lexie-Signature'],
      payload: `POST:${apiPath}:${headers['X-Lexie-Timestamp']}`,
      hasSecret: !!process.env.LEXIE_HMAC_SECRET,
      secretLength: process.env.LEXIE_HMAC_SECRET?.length || 0
    });
    
    console.log(`[STORE-PRIVATE-BALANCES-PROXY] 📡 Calling backend: ${endpoint}`);

    const backendResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ walletId, chainId, balances }),
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      console.error('[STORE-PRIVATE-BALANCES-PROXY] ❌ Backend error:', result);
      return res.status(backendResponse.status).json(result);
    }

    console.log('[STORE-PRIVATE-BALANCES-PROXY] ✅ Successfully proxied to backend');
    return res.status(200).json(result);

  } catch (error) {
    console.error('[STORE-PRIVATE-BALANCES-PROXY] ❌ Proxy error:', error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
} 