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

  console.log(`🔐 [ACCESS-CODES-PROXY-${requestId}] ${req.method} request`, {
    method: req.method,
    url: req.url,
    query: req.query,
    hasBody: !!req.body,
    timestamp: Date.now()
  });

  // HMAC secret is required for authenticated requests
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    console.error(`❌ [ACCESS-CODES-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
    return res.status(500).json({
      success: false,
      error: 'Server authentication configuration error'
    });
  }

  // Set CORS headers
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://lexiecrypto.com',
    'https://app.lexiecrypto.com',
    'https://chatroom.lexiecrypto.com',
    'https://chatroom.lexiecrypto.com',
  ];
  const isOriginAllowed = origin && allowedOrigins.includes(origin);

  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Signature, X-Timestamp, x-lexie-signature, x-lexie-timestamp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [ACCESS-CODES-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET, POST, PUT, DELETE methods
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    console.log(`❌ [ACCESS-CODES-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { action } = req.query;
    const timestamp = Date.now().toString();
    let backendPath, backendUrl, headers;

    // Handle different access code actions
    if (req.method === 'POST' && action === 'verify-access-code') {
      console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] Verify access code`);

      const { code } = req.body;
      if (!code || typeof code !== 'string' || code.length === 0 || code.length > 15) {
        return res.status(400).json({
          success: false,
          error: 'Invalid access code format'
        });
      }

      backendPath = '/api/access-codes/verify';
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    } else if (req.method === 'POST' && action === 'create-access-code') {
      console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] Create access code`);

      const { code, createdBy, maxUses, expiresAt } = req.body;
      if (!code || typeof code !== 'string' || code.length < 3 || code.length > 15) {
        return res.status(400).json({
          success: false,
          error: 'Access code must be 3-15 characters'
        });
      }

      backendPath = '/api/access-codes/create';
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    } else if (req.method === 'GET' && action === 'list-access-codes') {
      console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] List access codes`);

      backendPath = '/api/access-codes/list';
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    } else if (req.method === 'DELETE' && action === 'deactivate-access-code') {
      console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] Deactivate access code`);

      const { codeId } = req.query;
      if (!codeId) {
        return res.status(400).json({
          success: false,
          error: 'Missing codeId parameter'
        });
      }

      backendPath = `/api/access-codes/deactivate/${codeId}`;
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    } else if (req.method === 'GET' && action === 'get-access-code-stats') {
      console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] Get access code stats`);

      backendPath = '/api/access-codes/stats';
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    } else {
      console.log(`❌ [ACCESS-CODES-PROXY-${requestId}] Unknown action: ${action}`);
      return res.status(400).json({
        success: false,
        error: 'Unknown action'
      });
    }

    // Generate HMAC signature
    const signature = generateHmacSignature(req.method, backendPath, timestamp, hmacSecret);

    headers = {
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Access-Codes-Proxy/1.0',
    };

    // Add Content-Type for requests with body
    if (req.method === 'POST' || req.method === 'PUT') {
      headers['Content-Type'] = 'application/json';
    }

    console.log(`🔐 [ACCESS-CODES-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: signature.substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [ACCESS-CODES-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

    // Make the backend request
    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    // Add body for POST/PUT requests
    if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const backendResponse = await fetch(backendUrl, fetchOptions);
    const result = await backendResponse.json();

    console.log(`✅ [ACCESS-CODES-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [ACCESS-CODES-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      action: req.query.action || 'unknown'
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Backend timeout - please try again' :
               error.message.includes('502') ? 'Backend service unavailable' :
               'Internal proxy error'
      });
    }
  }
}
