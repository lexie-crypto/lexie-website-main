/**
 * Admin API Proxy for Lexie Website
 * Handles admin dashboard requests with HMAC authentication
 *
 * Routes handled:
 * - GET /admin/history/resolve?q=<identifier>
 * - GET /admin/history/:walletId?page=&pageSize=
 * - GET /admin/history/:walletId/export.csv
 */

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

  console.log(`🔒 [ADMIN-PROXY-${requestId}] ${req.method} request`, {
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
    'https://staging.lexiecrypto.com',
    'https://staging.chatroom.lexiecrypto.com',
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

  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Lexie-Timestamp, X-Lexie-Signature, X-Lexie-Role');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [ADMIN-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow GET and POST methods
  if (!['GET', 'POST'].includes(req.method)) {
    console.log(`❌ [ADMIN-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`❌ [ADMIN-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    const timestamp = Date.now().toString();
    let backendPath, backendUrl, headers;

    // Determine backend path based on URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/').filter(p => p);

    if (req.method === 'GET') {
      if (pathParts.includes('resolve')) {
        // GET /admin/history/resolve?q=<identifier>
        const q = req.query.q;
        if (!q) {
          console.log(`❌ [ADMIN-PROXY-${requestId}] Missing query parameter for resolve`);
          return res.status(400).json({
            success: false,
            error: 'Missing query parameter'
          });
        }

        backendPath = `/admin/history/resolve?q=${encodeURIComponent(q)}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`🔍 [ADMIN-PROXY-${requestId}] GET resolve for query: ${q.slice(0, 20)}...`);

      } else if (pathParts.includes('export.csv')) {
        // GET /admin/history/:walletId/export.csv
        const walletId = pathParts[pathParts.length - 2]; // Extract walletId from path
        if (!walletId) {
          console.log(`❌ [ADMIN-PROXY-${requestId}] Missing walletId for export`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletId parameter'
          });
        }

        backendPath = `/admin/history/${walletId}/export.csv`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`📊 [ADMIN-PROXY-${requestId}] GET export CSV for wallet: ${walletId.slice(0, 8)}...`);

      } else {
        // GET /admin/history/:walletId?page=&pageSize=
        const walletId = pathParts[pathParts.length - 1]; // Extract walletId from path
        if (!walletId) {
          console.log(`❌ [ADMIN-PROXY-${requestId}] Missing walletId for history`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletId parameter'
          });
        }

        const page = req.query.page || '1';
        const pageSize = req.query.pageSize || '50';
        backendPath = `/admin/history/${walletId}?page=${page}&pageSize=${pageSize}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`📊 [ADMIN-PROXY-${requestId}] GET history for wallet: ${walletId.slice(0, 8)}... (page: ${page}, size: ${pageSize})`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);

      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'X-Lexie-Role': req.headers['x-lexie-role'] || 'admin', // Forward admin role
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Admin-Proxy/1.0',
      };

    } else if (req.method === 'POST') {
      // POST endpoints for admin (if any in future)
      backendPath = `/admin${url.pathname}`;
      backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'X-Lexie-Role': req.headers['x-lexie-role'] || 'admin',
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Admin-Proxy/1.0',
      };
    }

    console.log(`🔐 [ADMIN-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: headers['X-Lexie-Signature'].substring(0, 20) + '...',
      path: backendPath,
      role: headers['X-Lexie-Role']
    });

    console.log(`📡 [ADMIN-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

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

    // Handle CSV export (binary response)
    if (backendPath.includes('export.csv')) {
      const contentType = backendResponse.headers.get('content-type');
      if (contentType && contentType.includes('text/csv')) {
        const csvData = await backendResponse.text();
        console.log(`✅ [ADMIN-PROXY-${requestId}] CSV export successful (${csvData.length} chars)`);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-history.csv"`);
        return res.status(backendResponse.status).send(csvData);
      }
    }

    // Handle JSON responses
    const result = await backendResponse.json();

    console.log(`✅ [ADMIN-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [ADMIN-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      path: req.url
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Backend timeout - please try again' :
               error.message.includes('SyntaxError') ? 'Backend returned invalid response' :
               'Internal proxy error'
      });
    }
  }
}
