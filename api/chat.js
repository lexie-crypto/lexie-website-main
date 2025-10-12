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
    // Extract message from JSON body (frontend sends { message, funMode?, personalityMode?, lexieId? })
    const { message, funMode, personalityMode, lexieId } = req.body;
    if (!message) {
      console.log(`❌ [CHAT-PROXY-${requestId}] No message provided in request body`);
      console.log(`❌ [CHAT-PROXY-${requestId}] Received body:`, req.body);
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`[CHAT-PROXY-${requestId}] Incoming chat request:`, {
      messageLength: message.length,
      hasFunMode: !!funMode,
      personalityMode: personalityMode || 'normal',
      hasLexieId: !!lexieId
    });

    // Retrieve conversation context if LexieID is provided
    let conversationContext = '';
    if (lexieId) {
      try {
        console.log(`🧠 [CHAT-PROXY-${requestId}] Retrieving conversation context for LexieID: ${lexieId}`);

        // Use the same backend endpoint pattern to get memories
        const memoryUrl = `${targets[0].replace('/api/lexie/chat', '/api/lexie/memory')}?action=get-context&lexieId=${encodeURIComponent(lexieId)}&limit=10`;

        const memoryResponse = await fetch(memoryUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(internalKey ? { 'LEXIE_INTERNAL_KEY': internalKey } : {}),
            ...(signature ? { 'X-Lexie-Timestamp': timestamp, 'X-Lexie-Signature': signature } : {}),
            'Origin': 'https://staging.app.lexiecrypto.com',
            'User-Agent': 'Lexie-Chat-Proxy/1.0',
          },
          signal: AbortSignal.timeout(5000), // 5 second timeout for memory retrieval
        });

        if (memoryResponse.ok) {
          const memoryData = await memoryResponse.json();
          if (memoryData.success && memoryData.context) {
            conversationContext = memoryData.context;
            console.log(`✅ [CHAT-PROXY-${requestId}] Retrieved ${memoryData.messageCount || 0} conversation memories`);
          }
        } else {
          console.log(`⚠️ [CHAT-PROXY-${requestId}] Could not retrieve conversation context: ${memoryResponse.status}`);
        }
      } catch (memoryError) {
        console.log(`⚠️ [CHAT-PROXY-${requestId}] Memory retrieval failed:`, memoryError.message);
        // Continue without context - don't fail the chat request
      }
    }

    // Check for internal key (bypasses all backend validation if valid)
    const internalKey = process.env.LEXIE_INTERNAL_KEY;

    // Always attempt to include HMAC headers if secret is available
    const method = 'POST';
    const backendPath = '/api/lexie/chat';
    const timestamp = Date.now().toString();
    const signature = hmacSecret ? generateHmacSignature(method, backendPath, timestamp, hmacSecret) : undefined;

    // Build headers: include internal key if available AND include HMAC headers when possible
    const headers = {
      'Accept': 'application/json',
      // Content-Type will be set dynamically based on mode later
      ...(internalKey ? { 'LEXIE_INTERNAL_KEY': internalKey } : {}),
      ...(signature ? { 'X-Lexie-Timestamp': timestamp, 'X-Lexie-Signature': signature } : {}),
      // Keep canonical frontend origin
      'Origin': 'https://staging.app.lexiecrypto.com',
      'User-Agent': 'Lexie-Chat-Proxy/1.0',
    };

    console.log(`🔐 [CHAT-PROXY-${requestId}] Generated HMAC headers`, {
      method: 'POST',
      timestamp,
      signature: signature ? signature.substring(0, 20) + '...' : 'none',
      path: backendPath,
      hasInternalKey: !!internalKey
    });

    // Decide targets based on environment and origin
    const clientOrigin = req.headers.origin || req.headers.referer || 'unknown';
    const isLocalClient = /^(http:\/\/localhost|http:\/\/127\.0\.0\.1)/.test(clientOrigin);
    const isDevEnv = process.env.NODE_ENV !== 'production';

    let targets = ['https://staging.api.lexiecrypto.com/api/lexie/chat'];
    if (isLocalClient || isDevEnv) {
      targets = ['http://localhost:3000/api/lexie/chat', 'https://staging.api.lexiecrypto.com/api/lexie/chat'];
    }
    console.log(`📡 [CHAT-PROXY-${requestId}] Client origin: ${clientOrigin}, isLocalClient: ${isLocalClient}, isDevEnv: ${isDevEnv}`);
    console.log(`📡 [CHAT-PROXY-${requestId}] Target sequence:`, targets);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    try {
      // Prepare request body for external API
      let requestBody;
      if (funMode === true || personalityMode === 'degen') {
        // Send as plain text with degen prefix and context
        let fullMessage = '[degen] ' + message;
        if (conversationContext) {
          fullMessage = `[degen]\n\nCONVERSATION CONTEXT:\n${conversationContext}\n\nCURRENT MESSAGE:\n${message}`;
        }
        requestBody = fullMessage;
        headers['Content-Type'] = 'text/plain';
        console.log(`📝 [CHAT-PROXY-${requestId}] Sending request as plain text with degen prefix and context`);
      } else {
        // Send as plain text with normal personality and context
        let fullMessage = message;
        if (conversationContext) {
          fullMessage = `CONVERSATION CONTEXT:\n${conversationContext}\n\nCURRENT MESSAGE:\n${message}`;
        }
        requestBody = fullMessage;
        headers['Content-Type'] = 'text/plain';
        console.log(`📝 [CHAT-PROXY-${requestId}] Sending request as plain text with context`);
      }

      // Try targets in order (local → external)
      let result;
      let lastError;
      for (const url of targets) {
        try {
          console.log(`🚀 [CHAT-PROXY-${requestId}] Sending request to: ${url}`);
          result = await fetch(url, {
            method: 'POST',
            headers,
            body: requestBody,
            signal: controller.signal,
          });
          // If we get any HTTP response (even errors), break the loop
          break;
        } catch (e) {
          console.error(`❌ [CHAT-PROXY-${requestId}] Fetch attempt failed for ${url}:`, e?.message || e);
          lastError = e;
          continue;
        }
      }
      if (!result) {
        throw lastError || new Error('No response from any target');
      }

      clearTimeout(timeoutId);

      console.log(`✅ [CHAT-PROXY-${requestId}] Chat server response status: ${result.status}`);

      // Parse and forward the response
      let responseData;
      try {
        const responseText = await result.text();
        console.log(`📄 [CHAT-PROXY-${requestId}] Raw response text length: ${responseText.length}`);

        if (!responseText.trim()) {
          throw new Error('Empty response from server');
        }

        responseData = JSON.parse(responseText);
        console.log(`✅ [CHAT-PROXY-${requestId}] Successfully parsed JSON response`);
      } catch (parseError) {
        console.error(`❌ [CHAT-PROXY-${requestId}] Failed to parse response as JSON:`, parseError);

        if (!result.ok) {
          throw new Error(`Server error ${result.status}: ${result.statusText}`);
        } else {
          throw new Error('Invalid JSON response from server');
        }
      }

      if (!result.ok) {
        console.log(`❌ [CHAT-PROXY-${requestId}] Chat request failed:`, {
          status: result.status,
          statusText: result.statusText,
          error: responseData.error || 'Unknown error'
        });
        throw new Error(responseData.error || `Server error ${result.status}: ${result.statusText}`);
      } else {
        console.log(`🎉 [CHAT-PROXY-${requestId}] Chat request successful`);
        console.log(`📊 [CHAT-PROXY-${requestId}] Response data:`, {
          messageLength: responseData.message?.length || 0,
          hasAction: !!responseData.action
        });
      }

      // Store conversation in memory if LexieID is provided
      if (lexieId && responseData.message) {
        try {
          console.log(`💾 [CHAT-PROXY-${requestId}] Storing conversation memory for LexieID: ${lexieId}`);

          const memoryUrl = `${targets[0].replace('/api/lexie/chat', '/api/lexie/memory')}?action=store-chat`;

          const memoryPayload = {
            lexieId: lexieId,
            userMessage: message,
            assistantMessage: responseData.message,
            personalityMode: personalityMode || 'normal',
            funMode: funMode || false,
            platform: 'web'
          };

          // Store memory asynchronously - don't wait for it to complete
          fetch(memoryUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              ...(internalKey ? { 'LEXIE_INTERNAL_KEY': internalKey } : {}),
              ...(signature ? { 'X-Lexie-Timestamp': timestamp, 'X-Lexie-Signature': signature } : {}),
              'Origin': 'https://staging.app.lexiecrypto.com',
              'User-Agent': 'Lexie-Chat-Proxy/1.0',
            },
            body: JSON.stringify(memoryPayload),
            signal: AbortSignal.timeout(5000), // 5 second timeout for memory storage
          }).then(memoryResult => {
            if (memoryResult.ok) {
              console.log(`✅ [CHAT-PROXY-${requestId}] Successfully stored conversation memory`);
            } else {
              console.log(`⚠️ [CHAT-PROXY-${requestId}] Failed to store conversation memory: ${memoryResult.status}`);
            }
          }).catch(memoryError => {
            console.log(`⚠️ [CHAT-PROXY-${requestId}] Memory storage failed:`, memoryError.message);
          });

        } catch (memoryError) {
          console.log(`⚠️ [CHAT-PROXY-${requestId}] Memory storage setup failed:`, memoryError.message);
          // Continue with response - don't fail the chat request
        }
      }

      // Forward the backend response
      res.status(result.status).json(responseData);

    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error(`❌ [CHAT-PROXY-${requestId}] Request timeout after 60 seconds`);
        res.status(504).json({ error: 'Request timeout - Chat server took too long to respond' });
      } else {
        console.error(`❌ [CHAT-PROXY-${requestId}] Fetch error:`, fetchError);
        res.status(500).json({ error: 'Failed to connect to chat server' });
      }
    }
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
