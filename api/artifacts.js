import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);

  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'https://www.lexiecrypto.com',
    'https://relayer.lexiecrypto.com',
    'https://wallet.lexiecrypto.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://staging.lexiecrypto.com',
    'https://staging.chatroom.lexiecrypto.com',
    'https://staging.wallet.lexiecrypto.com',
    'https://staging.pay.lexiecrypto.com',
    'https://pay.lexiecrypto.com',
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Request-ID, X-Forwarded-For');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const artifactsPath = url.pathname.replace('/api/artifacts', '') || '/';
    const action = url.searchParams.get('action');

    console.log(`🔍 [ARTIFACTS-PROXY-${requestId}] Processing path`, {
      originalPath: url.pathname,
      artifactsPath,
      method: req.method,
      action
    });

    // Local ping endpoint (diagnostic) – does not forward to backend
    if (artifactsPath === '/ping') {
      return res.status(200).json({
        ok: true,
        role: 'artifacts-proxy',
        requestId,
        method: req.method,
        path: artifactsPath,
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent']
      });
    }

    // Build backend URL based on action or path
    let backendUrl;
    if (action) {
      // Action-based routing (query parameter)
      if (action === 'health') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/health`;
      } else if (action === 'get') {
        const key = url.searchParams.get('key');
        if (!key) {
          return res.status(400).json({ error: 'Missing key parameter for get action', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/get/${encodeURIComponent(key)}`;
      } else if (action === 'exists') {
        const key = url.searchParams.get('key');
        if (!key) {
          return res.status(400).json({ error: 'Missing key parameter for exists action', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/exists/${encodeURIComponent(key)}`;
      } else if (action === 'store') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/store`;
      } else if (action === 'batch') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/batch`;
      } else if (action === 'preload') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/preload`;
      } else if (action === 'sync-chunk') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/idb-sync/chunk`;
      } else if (action === 'sync-finalize') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/idb-sync/finalize`;
      } else if (action === 'sync-manifest') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/idb-sync/manifest`;
      } else {
        return res.status(400).json({ error: 'Unknown action', requestId });
      }
    } else {
      // Path-based routing (legacy support)
      if (artifactsPath === '/' || artifactsPath === '') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/health`;
      } else if (artifactsPath.startsWith('/get/')) {
        const key = artifactsPath.replace('/get/', '');
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/get/${encodeURIComponent(key)}`;
      } else if (artifactsPath.startsWith('/exists/')) {
        const key = artifactsPath.replace('/exists/', '');
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/exists/${encodeURIComponent(key)}`;
      } else if (artifactsPath === '/store') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/store`;
      } else if (artifactsPath === '/batch') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/batch`;
      } else if (artifactsPath === '/preload') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/preload`;
      } else {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata${artifactsPath}`;
      }
    }

    console.log(`🎯 [ARTIFACTS-PROXY-${requestId}] Target`, { backendUrl });

    // Extract targetPath from backendUrl for HMAC signature
    const backendUrlObj = new URL(backendUrl);
    const targetPath = backendUrlObj.pathname + backendUrlObj.search;

    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error('LEXIE_HMAC_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error', requestId });
    }

    const timestamp = Date.now().toString();
    // Match wallet-metadata format: method:path:timestamp (no body)
    const payload = `${req.method}:${targetPath}:${timestamp}`;
    const signature = 'sha256=' + crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, application/octet-stream',
      'X-Request-ID': requestId,
      'X-Lexie-Signature': signature,
      'X-Lexie-Timestamp': timestamp,
      'X-Forwarded-For':
        req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress,
      'User-Agent': 'Lexie-Artifacts-Proxy/1.0',
    };

    // Add Origin header if it was allowed
    if (allowedOrigins.includes(origin)) {
      headers['Origin'] = origin;
    }

    const response = await fetch(backendUrl, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(120000), // 2 minutes for large artifact operations
    });

    console.log(`📤 [ARTIFACTS-PROXY-${requestId}] Backend response`, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
    });

    const data = await response.text();

    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');

    try {
      res.json(JSON.parse(data));
    } catch (_e) {
      res.send(data);
    }
  } catch (error) {
    console.error(`[${requestId}] Artifacts proxy error:`, error);
    res.status(500).json({ error: 'Artifacts service error', requestId });
  }
}
