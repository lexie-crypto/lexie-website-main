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
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);

  console.log(`🧠 [MEMORY-API-${requestId}] ${req.method} request`, {
    method: req.method,
    url: req.url,
    action: req.query.action,
    hasBody: !!req.body,
    timestamp: Date.now()
  });

  // HMAC secret is required for authenticated requests
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    console.error(`❌ [MEMORY-API-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
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
    'https://staging.lexiecrypto.com',
    'https://staging.app.lexiecrypto.com',
    'https://staging.chatroom.lexiecrypto.com',
    'https://chatroom.lexiecrypto.com',
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) ||
    (origin && origin.endsWith('.lexiecrypto.com')));

  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Signature, X-Timestamp, x-lexie-signature, x-lexie-timestamp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [MEMORY-API-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  const action = req.query.action;

  try {
    // Check for internal key (bypasses all backend validation if valid)
    const internalKey = process.env.LEXIE_INTERNAL_KEY;

    // Always attempt to include HMAC headers if secret is available
    const method = req.method;
    const backendPath = `/api/lexie/memory${action ? `?action=${action}` : ''}`;
    const timestamp = Date.now().toString();
    const signature = hmacSecret ? generateHmacSignature(method, backendPath, timestamp, hmacSecret) : undefined;

    // Build headers
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(internalKey ? { 'LEXIE_INTERNAL_KEY': internalKey } : {}),
      ...(signature ? { 'X-Lexie-Timestamp': timestamp, 'X-Lexie-Signature': signature } : {}),
      'Origin': 'https://staging.app.lexiecrypto.com',
      'User-Agent': 'Lexie-Memory-Proxy/1.0',
    };

    // Target backend
    const targets = ['https://staging.api.lexiecrypto.com/api/lexie/memory'];
    const isLocalClient = /^(http:\/\/localhost|http:\/\/127\.0\.0\.1)/.test(req.headers.origin || req.headers.referer || '');
    const isDevEnv = process.env.NODE_ENV !== 'production';

    if (isLocalClient || isDevEnv) {
      targets.unshift('http://localhost:3000/api/lexie/memory');
    }

    console.log(`📡 [MEMORY-API-${requestId}] Action: ${action}, targets:`, targets);

    if (action === 'get-context') {
      // Handle context retrieval
      const { lexieId, limit = 10 } = req.query;

      if (!lexieId) {
        return res.status(400).json({ error: 'lexieId parameter required for get-context' });
      }

      console.log(`📚 [MEMORY-API-${requestId}] Retrieving context for LexieID: ${lexieId}, limit: ${limit}`);

      // Try targets to get context
      let result;
      let lastError;
      for (const url of targets) {
        try {
          const contextUrl = `${url}?action=get-context&lexieId=${encodeURIComponent(lexieId)}&limit=${limit}`;
          console.log(`🚀 [MEMORY-API-${requestId}] Fetching context from: ${contextUrl}`);

          result = await fetch(contextUrl, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(10000),
          });

          if (result.ok) break;
        } catch (e) {
          console.error(`❌ [MEMORY-API-${requestId}] Context fetch failed for ${url}:`, e?.message || e);
          lastError = e;
          continue;
        }
      }

      if (!result) {
        throw lastError || new Error('No response from any target for context retrieval');
      }

      const data = await result.json();

      if (!result.ok) {
        console.log(`❌ [MEMORY-API-${requestId}] Context retrieval failed:`, {
          status: result.status,
          error: data.error || 'Unknown error'
        });
        return res.status(result.status).json(data);
      }

      console.log(`✅ [MEMORY-API-${requestId}] Context retrieved successfully: ${data.messageCount || 0} messages`);
      return res.status(200).json(data);

    } else if (action === 'store-chat') {
      // Handle chat storage
      const {
        lexieId,
        userMessage,
        assistantMessage,
        personalityMode,
        funMode,
        platform
      } = req.body;

      if (!lexieId || !userMessage || !assistantMessage) {
        return res.status(400).json({
          error: 'Missing required fields: lexieId, userMessage, assistantMessage'
        });
      }

      console.log(`💾 [MEMORY-API-${requestId}] Storing chat memory for LexieID: ${lexieId}`);

      // Try targets to store memory
      let result;
      let lastError;
      for (const url of targets) {
        try {
          const storeUrl = `${url}?action=store-chat`;
          console.log(`🚀 [MEMORY-API-${requestId}] Storing memory at: ${storeUrl}`);

          result = await fetch(storeUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              lexieId,
              userMessage,
              assistantMessage,
              personalityMode: personalityMode || 'normal',
              funMode: funMode || false,
              platform: platform || 'web'
            }),
            signal: AbortSignal.timeout(10000),
          });

          if (result.ok) break;
        } catch (e) {
          console.error(`❌ [MEMORY-API-${requestId}] Memory storage failed for ${url}:`, e?.message || e);
          lastError = e;
          continue;
        }
      }

      if (!result) {
        throw lastError || new Error('No response from any target for memory storage');
      }

      const data = await result.json();

      if (!result.ok) {
        console.log(`❌ [MEMORY-API-${requestId}] Memory storage failed:`, {
          status: result.status,
          error: data.error || 'Unknown error'
        });
        return res.status(result.status).json(data);
      }

      console.log(`✅ [MEMORY-API-${requestId}] Chat memory stored successfully`);
      return res.status(200).json(data);

    } else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

  } catch (error) {
    console.error(`❌ [MEMORY-API-${requestId}] Error:`, {
      method: req.method,
      action: action,
      error: error.message,
      stack: error.stack
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Memory service timeout' :
               error.message.includes('502') ? 'Memory service unavailable' :
               'Memory service error'
      });
    }
  }
}
