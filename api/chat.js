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

  console.log(`🤖 [CHAT-PROXY-${requestId}] ${req.method} request`, {
    method: req.method,
    url: req.url,
    hasBody: !!req.body,
    timestamp: Date.now()
  });

  // HMAC secret is required for authenticated requests
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    console.error(`❌ [CHAT-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
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
    console.log(`🌐 [CHAT-PROXY-${requestId}] OPTIONS preflight response sent`);
    return res.status(204).end();
  }

  // Only allow POST method for chat requests
  if (req.method !== 'POST') {
    console.log(`❌ [CHAT-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Forward to chat backend
    const backendPath = '/api/chat';
    const backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

    const timestamp = Date.now().toString();
    const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': 'https://staging.app.lexiecrypto.com',
      'User-Agent': 'Lexie-Chat-Proxy/1.0',
    };

    console.log(`🔐 [CHAT-PROXY-${requestId}] Generated HMAC headers`, {
      method: 'POST',
      timestamp,
      signature: signature.substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [CHAT-PROXY-${requestId}] Forwarding to chat backend: ${backendUrl}`);

    // Make the backend request
    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60000), // 60 second timeout for chat responses
    };

    const backendResponse = await fetch(backendUrl, fetchOptions);
    const result = await backendResponse.json();

    console.log(`✅ [CHAT-PROXY-${requestId}] Chat backend responded with status ${backendResponse.status}`, {
      messageLength: result.message?.length || 0,
      hasAction: !!result.action
    });

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [CHAT-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Chat request timeout - please try again' :
               error.message.includes('502') ? 'Chat service unavailable' :
               'Internal chat proxy error'
      });
    }
  }
}
