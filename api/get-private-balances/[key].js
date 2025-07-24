/**
 * Vercel Serverless Function - Get Private Balances Proxy
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
 * Generate HMAC authentication headers for backend calls
 */
function generateBackendAuthHeaders(method = 'GET', path = '/api/get-private-balances') {
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    throw new Error('LEXIE_HMAC_SECRET environment variable is required for backend calls');
  }

  const timestamp = Date.now().toString();
  
  // Create the payload to sign: method:path:timestamp
  const payload = `${method}:${path}:${timestamp}`;
  
  // Compute signature
  const signature = 'sha256=' + crypto
    .createHmac('sha256', hmacSecret)
    .update(payload)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-lexie-timestamp': timestamp,
    'x-lexie-signature': signature
  };
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Only GET requests are supported.' 
    });
  }

  try {
    console.log('[GET-PRIVATE-BALANCES-PROXY] 🔄 Proxying request to lexie-be backend');

    // Extract key from URL parameters
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing key parameter' 
      });
    }

    // Proxy request to lexie-be backend
    const backendUrl = process.env.LEXIE_BACKEND_URL || 'https://api.lexiecrypto.com';
    const backendPath = `/api/get-private-balances/${key}`;
    const endpoint = `${backendUrl}${backendPath}`;
    
    const headers = generateBackendAuthHeaders('GET', backendPath);
    
    console.log(`[GET-PRIVATE-BALANCES-PROXY] 📡 Calling backend: ${endpoint}`);

    const backendResponse = await fetch(endpoint, {
      method: 'GET',
      headers,
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      console.error('[GET-PRIVATE-BALANCES-PROXY] ❌ Backend error:', result);
      return res.status(backendResponse.status).json(result);
    }

    console.log('[GET-PRIVATE-BALANCES-PROXY] ✅ Successfully proxied to backend');
    return res.status(200).json(result);

  } catch (error) {
    console.error('[GET-PRIVATE-BALANCES-PROXY] ❌ Proxy error:', error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
} 