import crypto from 'crypto';

// Configure Next.js to handle multipart/form-data properly
export const config = {
  api: {
    bodyParser: false, // Disable default body parser for multipart handling
  },
}

function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export default async function handler(req, res) {
  const method = req.method;
  
  // Extract the API path from the URL
  // URL will be like "/api/destination-summary" or "/api/user-countries/CA"
  let apiPath = req.url || '/api/';
  
  // Remove query parameters for path extraction
  const pathOnly = apiPath.split('?')[0];
  
  // Handle trailing slashes and ensure we have a valid path
  if (pathOnly === '/api/' || pathOnly === '/api') {
    console.log('[WALLET-PROXY] ❌ No API path specified');
    return res.status(400).json({
      success: false,
      error: 'No API path specified. Use /api/{endpoint}'
    });
  }

  const requestId = Math.random().toString(36).substring(7);
  console.log(`[WALLET-PROXY-${requestId}] ${method} request to: ${apiPath}`);

  try {
    // Set CORS headers (allowing all origins for now, can be restricted later)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Lexie-Timestamp, X-Lexie-Signature, X-User-Id');

    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS') {
      console.log(`[WALLET-PROXY-${requestId}] OPTIONS preflight request`);
      return res.status(200).end();
    }

    // Validate allowed methods
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      console.log(`[WALLET-PROXY-${requestId}] ❌ Invalid method ${method}`);
      return res.status(405).json({
        success: false,
        error: 'Method not allowed'
      });
    }

    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`[WALLET-PROXY-${requestId}] ❌ LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    // Generate HMAC signature
    const timestamp = Date.now().toString();
    const signature = generateHmacSignature(method, apiPath, timestamp, hmacSecret);

    // Determine content type based on incoming request
    const incomingContentType = req.headers['content-type'] || 'application/json';
    const isTextPlain = incomingContentType.includes('text/plain');
    let isMultipart = incomingContentType.startsWith('multipart/form-data'); // Better detection to avoid false positives
    
    
    // Prepare headers with HMAC authentication
    const headers = {
      'Accept': 'application/json',
      'x-lexie-timestamp': timestamp,
      'x-lexie-signature': signature,
      'Origin': 'https://lexiecrypto.com',
      'User-Agent': 'Lexie-Proxy/1.0',
    };

    // CRITICAL: Only set Content-Type if NOT multipart/form-data
    // For multipart uploads, let the original Content-Type (with boundary) pass through
    if (!isMultipart) {
      headers['Content-Type'] = isTextPlain ? 'text/plain' : 'application/json';
    } else {
      // For multipart/form-data, preserve the original Content-Type with boundary
      headers['Content-Type'] = incomingContentType;
    }

    // Forward additional headers if present
    if (req.headers['x-user-id']) {
      headers['X-User-Id'] = req.headers['x-user-id'];
    }

    console.log(`[WALLET-PROXY-${requestId}] Forwarding ${method} request to: https://api.lexiecrypto.com${apiPath}`);
    console.log(`[WALLET-PROXY-${requestId}] Content-Type: ${headers['Content-Type']}`);
    
    const proxyStart = Date.now();
    
    // Create timeout controller (30s for all wallet operations)
    const timeoutMs = 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[WALLET-PROXY-${requestId}] ❌ Request timeout after ${timeoutMs/1000}s`);
      controller.abort();
    }, timeoutMs);

    let backendResponse;
    try {
      // Prepare request options
      const requestOptions = {
        method: method,
        headers: headers,
        signal: controller.signal,
      };

      // Add body for POST, PUT, PATCH requests - handle different content types
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (isMultipart) {
          // For multipart/form-data, forward the raw request stream
          console.log(`[WALLET-PROXY-${requestId}] Forwarding multipart/form-data (raw stream)`);
          requestOptions.body = req; // Forward the entire request object as stream
        } else if (req.body) {
          // For non-multipart requests with parsed body
          if (isTextPlain) {
            // For text/plain, send the body as-is (should be a string)
            requestOptions.body = typeof req.body === 'string' ? req.body : String(req.body);
            console.log(`[WALLET-PROXY-${requestId}] Sending text/plain body:`, requestOptions.body.substring(0, 100));
          } else {
            // For JSON, stringify the body
            requestOptions.body = JSON.stringify(req.body);
            console.log(`[WALLET-PROXY-${requestId}] Sending JSON body`);
          }
        } else {
          console.log(`[WALLET-PROXY-${requestId}] No body to forward for ${method} request`);
        }
      }

      // Forward the request to the backend
      backendResponse = await fetch(`https://api.lexiecrypto.com${apiPath}`, requestOptions);
      
      clearTimeout(timeoutId);
      console.log(`[WALLET-PROXY-${requestId}] Backend responded in ${Date.now() - proxyStart}ms with status ${backendResponse.status}`);
      
    } catch (err) {
      clearTimeout(timeoutId);
      console.error(`[WALLET-PROXY-${requestId}] ❌ Backend call failed after ${Date.now() - proxyStart}ms:`, {
        error: err.message,
        name: err.name
      });
      
      if (err instanceof Error && err.name === 'AbortError') {
        console.error(`[WALLET-PROXY-${requestId}] ❌ Timeout after ${timeoutMs/1000}s`);
        return res.status(504).json({ 
          success: false, 
          error: `Request timeout after ${timeoutMs/1000} seconds` 
        });
      }
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to connect to backend server' 
      });
    }

    // Parse and forward the response
    let data;
    try {
      const responseText = await backendResponse.text();
      
      // Log raw response for wallet endpoints if debugging needed
      if (apiPath.includes('/api/store-') || apiPath.includes('/api/get-')) {
        console.log(`[WALLET-PROXY-${requestId}] Raw response:`, responseText.substring(0, 200));
      }
      
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[WALLET-PROXY-${requestId}] ❌ Failed to parse JSON response:`, parseError.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Invalid JSON response from backend',
          rawResponse: responseText
        });
      }
    } catch (textError) {
      console.error(`[WALLET-PROXY-${requestId}] ❌ Failed to read response text:`, textError.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to read backend response' 
      });
    }

    console.log(`[WALLET-PROXY-${requestId}] ✅ Success, returning data`);
    
    // Set the correct Content-Type header from backend response
    const contentType = backendResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    res.status(backendResponse.status).json(data);
    
  } catch (error) {
    console.error(`[WALLET-PROXY-${requestId}] ❌ Uncaught error`, {
      error: error?.message || error,
      stack: error?.stack || 'no stack',
      method: req.method,
      url: req.url,
      body: req.body
    });
    
    // Make sure we always respond
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: 'Internal wallet proxy error' 
      });
    }
  }
} 


