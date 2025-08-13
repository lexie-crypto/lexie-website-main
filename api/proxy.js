/**
 * Unified Proxy Module
 * - Exposes two handlers: handleRpc and handleGasRelayer
 * - Shares CORS and config across both
 */

import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: true,
  },
};

// ------------------------
// RPC PROXY (Alchemy/Ankr)
// ------------------------

const ALCHEMY_HOSTS = {
  1: 'https://eth-mainnet.g.alchemy.com/v2/',
  42161: 'https://arb-mainnet.g.alchemy.com/v2/',
  137: 'https://polygon-mainnet.g.alchemy.com/v2/',
  56: 'https://bnb-mainnet.g.alchemy.com/v2/',
};

const ANKR_HOSTS = {
  1: 'https://rpc.ankr.com/eth/',
  42161: 'https://rpc.ankr.com/arbitrum/',
  137: 'https://rpc.ankr.com/polygon/',
  56: 'https://rpc.ankr.com/bsc/',
};

function buildUpstreamUrl(provider, chainId) {
  const cid = Number(chainId);
  if (provider === 'ankr') {
    const base = ANKR_HOSTS[cid];
    if (!base) return null;
    const key = process.env.ANKR_API_KEY || '';
    return key ? base + key : base; // Ankr supports optional keys
  }
  const base = ALCHEMY_HOSTS[cid];
  if (!base) return null;
  const key = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
  if (!key) return null;
  return base + key;
}

async function forwardJSONRPC({ upstreamUrl, body, signal }) {
  const res = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text };
}

function setCORS(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'https://lexiecrypto.com/wallet',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) || origin.endsWith('.lexiecrypto.com'));
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

export async function handleRpc(req, res) {
  const requestId = Math.random().toString(36).slice(2, 8);

  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  try {
    const { chainId: chainIdRaw, provider: providerRaw } = req.query;
    let body = req.body;
    let bodyForForward = body;
    try {
      if (typeof bodyForForward === 'string') {
        // pass-through
      } else if (bodyForForward == null) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        bodyForForward = raw || bodyForForward;
      }
    } catch (_) {}

    const chainId = Number(chainIdRaw || 1);
    const providerPref = String(providerRaw || 'alchemy').toLowerCase();

    const alchemyUrl = buildUpstreamUrl('alchemy', chainId);
    const ankrUrl = buildUpstreamUrl('ankr', chainId);

    const tryOrder = [];
    if (providerPref === 'ankr') tryOrder.push({ name: 'ankr', url: ankrUrl });
    else if (providerPref === 'alchemy') tryOrder.push({ name: 'alchemy', url: alchemyUrl });
    else tryOrder.push({ name: 'alchemy', url: alchemyUrl }, { name: 'ankr', url: ankrUrl });

    const providers = tryOrder.filter(p => !!p.url);
    if (providers.length === 0) {
      return res.status(500).json({ error: 'No RPC providers configured for requested chain' });
    }

    let lastError = null;
    for (const p of providers) {
      try {
        const timeoutSignal = AbortSignal.timeout(20000);
        const result = await forwardJSONRPC({ upstreamUrl: p.url, body: bodyForForward ?? body, signal: timeoutSignal });
        if (result.ok) return res.status(200).json(result.json ?? { ok: true, raw: result.text });
        if (result.status === 429 || (result.status >= 500 && result.status < 600)) {
          lastError = new Error(`${p.name} responded ${result.status}`);
          continue;
        }
        return res.status(result.status).send(result.text);
      } catch (err) {
        lastError = err;
      }
    }

    const message = lastError?.message || 'Unknown upstream error';
    return res.status(502).json({ error: `RPC upstream failed: ${message}` });
  } catch (error) {
    console.error('💥 [RPC Proxy] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ----------------------------
// GAS RELAYER PROXY (HMAC)
// ----------------------------

export async function handleGasRelayer(req, res) {
  const requestId = Math.random().toString(36).substring(7);

  setCORS(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const relayerPath = url.pathname.replace('/api/gas-relayer', '');

    let backendUrl;
    if (relayerPath === '/health' || relayerPath === '') {
      backendUrl = `https://relayer.lexiecrypto.com/health`;
    } else if (relayerPath === '/estimate-fee') {
      backendUrl = `https://relayer.lexiecrypto.com/api/relay/estimate-fee`;
    } else if (relayerPath === '/submit') {
      backendUrl = `https://relayer.lexiecrypto.com/api/relay/submit`;
    } else if (relayerPath === '/address') { // proxy path -> backend address
      backendUrl = `https://relayer.lexiecrypto.com/api/relayer/address`;
    } else {
      return res.status(404).json({ success: false, error: 'Unknown relayer endpoint' });
    }

    const hmacSecret = process.env.LEXIE_HMAC_SECRET || process.env.HMAC_SECRET;
    if (!hmacSecret) {
      return res.status(500).json({ success: false, error: 'Server authentication configuration error' });
    }

    const timestamp = Date.now().toString();
    const bodyString = req.method === 'POST' ? JSON.stringify(req.body) : '';

    let backendPath;
    if (relayerPath === '/submit') backendPath = '/api/relay/submit';
    else if (relayerPath === '/estimate-fee') backendPath = '/api/relay/estimate-fee';
    else if (relayerPath === '/address') backendPath = '/api/relayer/address';
    else if (relayerPath === '/health' || relayerPath === '') backendPath = '/health';
    else backendPath = relayerPath || '/';

    const payload = `${req.method}:${backendPath}:${timestamp}:${bodyString}`;
    const signature = 'sha256=' + crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': req.headers.origin || 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Gas-Relayer-Proxy/1.0',
      'X-Lexie-Signature': signature,
      'X-Lexie-Timestamp': timestamp,
    };

    const fetchOptions = { method: req.method, headers, signal: AbortSignal.timeout(30000) };
    if (req.method === 'POST') fetchOptions.body = bodyString;

    const relayerResponse = await fetch(backendUrl, fetchOptions);
    const responseBody = await relayerResponse.text();

    try {
      const json = JSON.parse(responseBody);
      return res.status(relayerResponse.status).json(json);
    } catch {
      return res.status(relayerResponse.status).send(responseBody);
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal proxy error' });
  }
}


