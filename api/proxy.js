import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: true,
  },
};

export async function handleGasRelayer(req, res) {
  const requestId = Math.random().toString(36).substring(7);

  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const relayerPath = url.pathname.replace('/api/gas-relayer', '') || '/';

    console.log(`🔍 [PROXY-${requestId}] Processing path`, {
      originalPath: url.pathname,
      relayerPath,
      method: req.method
    });

    // Map proxy paths to backend API paths (support both short and full)
    let targetPath = relayerPath;
    if (targetPath === '/' || targetPath === '') {
      targetPath = '/health';
    } else if (targetPath === '/api/relay/submit' || targetPath === '/submit') {
      targetPath = '/api/relay/submit';
    } else if (targetPath === '/api/relay/estimate-fee' || targetPath === '/estimate-fee') {
      targetPath = '/api/relay/estimate-fee';
    } else if (targetPath === '/api/relayer/address' || targetPath === '/address') {
      targetPath = '/api/relayer/address';
    }

    const RAILWAY_URL = process.env.RAILWAY_RELAYER_URL || 'https://relayer.lexiecrypto.com';
    const backendUrl = `${RAILWAY_URL}${targetPath}`;

    console.log(`🎯 [PROXY-${requestId}] Target`, { targetPath, backendUrl });

    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error('LEXIE_HMAC_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error', requestId });
    }

    const timestamp = Date.now().toString();
    const bodyString = req.method === 'POST' ? JSON.stringify(req.body) : '';
    const payload = `${req.method}:${targetPath}:${timestamp}:${bodyString}`;
    const signature =
      'sha256=' + crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');

    const response = await fetch(backendUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Lexie-Signature': signature,
        'X-Lexie-Timestamp': timestamp,
        'X-Request-ID': requestId,
        'X-Forwarded-For':
          req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress,
      },
      body: req.method === 'POST' ? bodyString : undefined,
      signal: AbortSignal.timeout(30000),
    });

    console.log(`📤 [PROXY-${requestId}] Backend response`, {
      status: response.status,
      statusText: response.statusText
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
    console.error(`[${requestId}] Proxy error:`, error);
    res.status(500).json({ error: 'Relay service error', requestId });
  }
}


