/**
 * Vercel Serverless Function - JSON-RPC Proxy for Alchemy and Ankr
 * Purpose: Prevent exposing API keys in the browser. All RPC calls go server→server.
 * Usage (client): POST /api/rpc?chainId=42161&provider=alchemy
 *  - body: standard JSON-RPC payload { jsonrpc, id, method, params }
 *  - provider is optional; defaults to "alchemy" with automatic fallback to ankr on failure
 */

export const config = {
  api: {
    bodyParser: true,
  },
};

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
    return key ? base + key : base; // Ankr supports no-key and key auth
  }
  // default to alchemy
  const base = ALCHEMY_HOSTS[cid];
  if (!base) return null;
  const key = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY; // server-only preferred
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

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).slice(2, 8);

  // CORS
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://app.lexiecrypto.com',
    'https://lexiecrypto.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    'https://staging.lexiecrypto.com',
    'https://staging.chatroom.lexiecrypto.com',
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) || origin.endsWith('.lexiecrypto.com'));
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { chainId: chainIdRaw, provider: providerRaw } = req.query;
    let body = req.body;
    // Ensure we have a serializable payload; do not over-validate (some clients send batch arrays)
    let bodyForForward = body;
    try {
      if (typeof bodyForForward === 'string') {
        // already raw JSON
      } else if (bodyForForward == null) {
        // Try to read raw
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        bodyForForward = raw || bodyForForward;
      }
    } catch (_) {}

    // Determine chainId (query param has priority). We do not rely on body structure here.
    const chainId = Number(chainIdRaw || 1);
    const providerPref = String(providerRaw || 'alchemy').toLowerCase(); // 'alchemy' | 'ankr' | 'auto'

    const alchemyUrl = buildUpstreamUrl('alchemy', chainId);
    const ankrUrl = buildUpstreamUrl('ankr', chainId);

    if (!alchemyUrl && providerPref !== 'ankr') {
      console.error(`[RPC ${requestId}] Alchemy URL missing for chain ${chainId}.`);
    }
    if (!ankrUrl) {
      console.error(`[RPC ${requestId}] Ankr URL missing for chain ${chainId}.`);
    }

    const tryOrder = [];
    if (providerPref === 'ankr') tryOrder.push({ name: 'ankr', url: ankrUrl });
    else if (providerPref === 'alchemy') tryOrder.push({ name: 'alchemy', url: alchemyUrl });
    else { // auto
      tryOrder.push({ name: 'alchemy', url: alchemyUrl }, { name: 'ankr', url: ankrUrl });
    }

    // Remove nulls
    const providers = tryOrder.filter(p => !!p.url);
    if (providers.length === 0) {
      return res.status(500).json({ error: 'No RPC providers configured for requested chain' });
    }

    let lastError = null;
    for (const p of providers) {
      try {
        const timeoutSignal = AbortSignal.timeout(20000);
        const result = await forwardJSONRPC({ upstreamUrl: p.url, body: bodyForForward ?? body, signal: timeoutSignal });
        if (result.ok) {
          return res.status(200).json(result.json ?? { ok: true, raw: result.text });
        }
        // Retry on 429/5xx
        if (result.status === 429 || (result.status >= 500 && result.status < 600)) {
          lastError = new Error(`${p.name} responded ${result.status}`);
          continue;
        }
        // Non-retryable error: return immediately
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


