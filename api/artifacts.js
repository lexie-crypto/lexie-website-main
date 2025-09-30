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
    'https://staging.app.lexiecrypto.com',
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

    // Parse action and parameters from action string (format: "action&param1=value1&param2=value2")
    // Action is URL encoded, so decode it first
    const decodedAction = decodeURIComponent(action);
    let parsedAction = decodedAction;
    let actionParams = {};


    if (decodedAction && decodedAction.includes('&')) {
      const parts = decodedAction.split('&');
      parsedAction = parts[0];

      for (let i = 1; i < parts.length; i++) {
        const [key, value] = parts[i].split('=');
        if (key && value) {
          actionParams[key] = value;
        }
      }
    }

    // Build backend URL based on action or path
    let backendUrl;
    if (parsedAction) {
      // Action-based routing (query parameter)
      if (parsedAction === 'health') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/health`;
      } else if (parsedAction === 'get') {
        const key = actionParams.key || url.searchParams.get('key');
        if (!key) {
          return res.status(400).json({ error: 'Missing key parameter for get action', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/get/${encodeURIComponent(key)}`;
      } else if (parsedAction === 'exists') {
        const key = actionParams.key || url.searchParams.get('key');
        if (!key) {
          return res.status(400).json({ error: 'Missing key parameter for exists action', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/exists/${encodeURIComponent(key)}`;
      } else if (parsedAction === 'store') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/store`;
      } else if (parsedAction === 'batch') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/batch`;
      } else if (parsedAction === 'preload') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/wallet-metadata/artifacts/preload`;
      } else if (parsedAction === 'sync-chunk') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/chunk`;
      } else if (parsedAction === 'sync-finalize') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/finalize`;
      } else if (parsedAction === 'sync-manifest') {
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/manifest`;
      } else if (parsedAction === 'idb-sync-latest') {
        const walletId = actionParams.walletId;
        if (!walletId) {
          return res.status(400).json({ error: 'Missing required parameter: walletId', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/latest?walletId=${encodeURIComponent(walletId)}`;
      } else if (parsedAction === 'idb-sync-snapshot') {
        const ts = actionParams.ts;
        if (!ts) {
          return res.status(400).json({ error: 'Missing required parameter: ts', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/snapshot?ts=${encodeURIComponent(ts)}`;
      } else if (parsedAction === 'idb-sync-chunk') {
        const ts = actionParams.ts;
        const n = actionParams.n;
        if (!ts || n === undefined) {
          return res.status(400).json({ error: 'Missing required parameters: ts, n', requestId });
        }
        backendUrl = `${process.env.API_BASE_URL || 'https://staging.api.lexiecrypto.com'}/api/idb-sync/chunk?ts=${encodeURIComponent(ts)}&n=${encodeURIComponent(n)}`;
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
