import crypto from 'crypto';

/**
 * Generate HMAC signature for backend authentication
 */
function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// No longer needed - using standardized HMAC format for both services

/**
 * Handle gas relayer requests
 */
async function handleGasRelayerRequest(req, res, requestId, hmacSecret) {
  console.log(`🚀 [GAS-RELAYER-${requestId}] ${req.method} request via wallet-metadata proxy`);
  
  // Parse the URL to get the relayer endpoint
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relayerPath = url.pathname.replace('/api/wallet-metadata/gas-relayer', '').replace('/api/gas-relayer', '');
  
  console.log(`🔍 [GAS-RELAYER-${requestId}] URL parsing:`, {
    originalUrl: req.url,
    parsedPathname: url.pathname,
    relayerPath,
    host: req.headers.host
  });
  
  let backendPath, backendUrl;
  
  if (relayerPath === '/health' || relayerPath === '') {
    // Health check endpoint
    backendPath = '/health';
    backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
    
  } else if (relayerPath === '/estimate-fee') {
    // Fee estimation endpoint  
    backendPath = '/api/relay/estimate-fee';
    backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
    
  } else if (relayerPath === '/submit') {
    // Transaction submission endpoint
    backendPath = '/api/relay/submit';
    backendUrl = `https://relayer.lexiecrypto.com${backendPath}`;
    
  } else {
    console.log(`❌ [GAS-RELAYER-${requestId}] Unknown relayer endpoint: ${relayerPath}`);
    return res.status(404).json({
      success: false,
      error: 'Unknown relayer endpoint'
    });
  }

  const timestamp = Date.now().toString();
  const bodyString = req.method === 'POST' ? JSON.stringify(req.body) : '';
  const signature = generateGasRelayerHmacSignature(req.method, backendPath, timestamp, bodyString, hmacSecret);
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'Origin': 'https://app.lexiecrypto.com',
    'User-Agent': 'Lexie-Gas-Relayer-Proxy/1.0',
  };

  console.log(`🔐 [GAS-RELAYER-${requestId}] Generated HMAC headers`, {
    method: req.method,
    timestamp,
    signature: signature.substring(0, 20) + '...',
    path: backendPath
  });

  console.log(`📡 [GAS-RELAYER-${requestId}] Forwarding to relayer: ${backendUrl}`);

  try {
    // Make the relayer request
    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    // Add body for POST requests
    if (req.method === 'POST') {
      fetchOptions.body = bodyString;
    }

    const relayerResponse = await fetch(backendUrl, fetchOptions);
    const responseBody = await relayerResponse.text(); // Read as text first

    console.log(`✅ [GAS-RELAYER-${requestId}] Gas relayer responded with status ${relayerResponse.status}`);
    console.log(`✅ [GAS-RELAYER-${requestId}] Response body (first 200 chars): ${responseBody.substring(0, 200)}...`);

    // Attempt to parse as JSON, fallback to text
    try {
      const jsonResult = JSON.parse(responseBody);
      res.status(relayerResponse.status).json(jsonResult);
    } catch (jsonError) {
      console.error(`❌ [GAS-RELAYER-${requestId}] Failed to parse response as JSON:`, jsonError.message);
      res.status(relayerResponse.status).send(responseBody); // Send raw text if not JSON
    }

  } catch (error) {
    console.error(`❌ [GAS-RELAYER-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      path: req.url
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Gas relayer timeout - please try again' :
               error.message.includes('502') ? 'Gas relayer service unavailable' :
               'Internal proxy error'
      });
    }
  }
}

export const config = {
  api: {
    bodyParser: true, // Enable body parsing for JSON
  },
};

export default async function handler(req, res) {
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`🔄 [WALLET-METADATA-PROXY-${requestId}] ${req.method} request`, {
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
    'http://localhost:3000', 
    'http://localhost:3001',
    'http://localhost:5173',
    'https://staging.lexiecrypto.com',
    'https://staging.chatroom.lexiecrypto.com',
  ];
  const isOriginAllowed = origin && (allowedOrigins.includes(origin) || 
    (origin && origin.endsWith('.lexiecrypto.com')));
  
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, X-Signature, X-Timestamp');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    console.log(`🌐 [WALLET-METADATA-PROXY-${requestId}] OPTIONS preflight response sent for: ${req.url}`);
    return res.status(204).end();
  }

  // Only allow GET, POST, and OPTIONS methods
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Method ${req.method} not allowed`);
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    // Get HMAC secret from environment
    const hmacSecret = process.env.LEXIE_HMAC_SECRET;
    if (!hmacSecret) {
      console.error(`❌ [WALLET-METADATA-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
      return res.status(500).json({
        success: false,
        error: 'Server authentication configuration error'
      });
    }

    let backendPath, backendUrl, headers;
    const timestamp = Date.now().toString();

      // Gas relayer now has its own separate endpoint /api/gas-relayer

  // Detect request type based on query parameters
  const {
    walletAddress,
    action,
    walletId,
    tokenAddress,
    requiredAmount
  } = req.query;

  // Detect history routes based on action parameter

  console.log(`🔍 [PROXY-${requestId}] Route detection:`, {
    action,
    method: req.method,
    query: req.query
  });

  // Handle history routes
  if (action === 'history') {
    console.log(`✅ [HISTORY-PROXY-${requestId}] History route detected, processing...`);

    if (req.method === 'GET') {
      const { subaction, q, walletId, page = '1', pageSize = '50' } = req.query;

      if (subaction === 'resolve') {
        // GET /?action=history&subaction=resolve&q=<identifier>
        if (!q) {
          console.log(`❌ [HISTORY-PROXY-${requestId}] Missing query parameter for resolve`);
          return res.status(400).json({
            success: false,
            error: 'Missing query parameter'
          });
        }

        backendPath = `/?action=history&subaction=resolve&q=${encodeURIComponent(q?.toString() || '')}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`🔍 [HISTORY-PROXY-${requestId}] GET resolve for query: ${(q?.toString() || '').slice(0, 20)}...`);

      } else if (subaction === 'export') {
        // GET /?action=history&subaction=export&walletId=<walletId>
        if (!walletId) {
          console.log(`❌ [HISTORY-PROXY-${requestId}] Missing walletId for export`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletId parameter'
          });
        }

        backendPath = `/?action=history&subaction=export&walletId=${walletId}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`📊 [HISTORY-PROXY-${requestId}] GET export CSV for wallet: ${(walletId?.toString() || '').slice(0, 8)}...`);

      } else {
        // GET /?action=history&walletId=<walletId>&page=&pageSize=
        if (!walletId) {
          console.log(`❌ [HISTORY-PROXY-${requestId}] Missing walletId for history`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletId parameter'
          });
        }

        backendPath = `/?action=history&walletId=${walletId}&page=${page}&pageSize=${pageSize}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

        console.log(`📊 [HISTORY-PROXY-${requestId}] GET history for wallet: ${(walletId?.toString() || '').slice(0, 8)}... (page: ${page}, size: ${pageSize})`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);

      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

      console.log(`🔐 [ADMIN-PROXY-${requestId}] HMAC headers generated:`, {
        method: 'GET',
        timestamp,
        signature: signature.substring(0, 20) + '...',
        backendPath,
        hasTimestamp: !!headers['X-Lexie-Timestamp'],
        hasSignature: !!headers['X-Lexie-Signature']
      });

    } else if (req.method === 'POST') {
      // POST endpoints for history (if any in future)
      const queryString = new URLSearchParams(req.query).toString();
      backendPath = `/?${queryString}`;
      backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };
    }

    console.log(`🔐 [HISTORY-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: headers['X-Lexie-Signature'].substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [HISTORY-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

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
    if (backendPath.includes('subaction=export')) {
      const contentType = backendResponse.headers.get('content-type');
      if (contentType && contentType.includes('text/csv')) {
        const csvData = await backendResponse.text();
        console.log(`✅ [HISTORY-PROXY-${requestId}] CSV export successful (${csvData.length} chars)`);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-history.csv"`);
        return res.status(backendResponse.status).send(csvData);
      }
    }

    // Handle JSON responses
    const result = await backendResponse.json();

    console.log(`✅ [HISTORY-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

    return; // Exit after handling history routes
  }

  // Original wallet-metadata logic continues below
  console.log(`📊 [PROXY-${requestId}] Processing as regular wallet-metadata route`);
  if (req.method === 'GET') {
      // Check if this is a resolve-wallet-id request
      if (req.url.includes('/resolve-wallet-id/')) {
        // Extract the resolve type and identifier from URL path
        const urlPath = req.url.split('?')[0]; // Remove query parameters

        // Handle /resolve-wallet-id/by-eoa/:address
        const eoaMatch = urlPath.match(/\/resolve-wallet-id\/by-eoa\/([^\/]+)/);
        if (eoaMatch) {
          const address = eoaMatch[1];
          backendPath = `/api/resolve-wallet-id/by-eoa/${address}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] GET resolve wallet by EOA: ${address.slice(0, 8)}...`);
        }

        // Handle /resolve-wallet-id/by-railgun/:railgunAddress
        const railgunMatch = urlPath.match(/\/resolve-wallet-id\/by-railgun\/([^\/]+)/);
        if (railgunMatch) {
          const railgunAddress = railgunMatch[1];
          backendPath = `/api/resolve-wallet-id/by-railgun/${railgunAddress}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] GET resolve wallet by Railgun: ${railgunAddress.slice(0, 8)}...`);
        }

        // Handle /resolve-wallet-id/by-tx/:txId
        const txMatch = urlPath.match(/\/resolve-wallet-id\/by-tx\/([^\/]+)/);
        if (txMatch) {
          const txId = txMatch[1];
          backendPath = `/api/resolve-wallet-id/by-tx/${txId}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] GET resolve wallet by TX: ${txId.slice(0, 8)}...`);
        }

        // If no matches found, return error
        if (!backendPath) {
          console.log(`❌ [RESOLVE-PROXY-${requestId}] Invalid resolve-wallet-id URL format: ${req.url}`);
          return res.status(400).json({ success: false, error: 'Invalid resolve-wallet-id URL format' });
        }

      } else if (req.url.includes('/wallet-timeline/')) {
        // Extract walletId from URL path
        const urlPath = req.url.split('?')[0]; // Remove query parameters
        const walletIdMatch = urlPath.match(/\/wallet-timeline\/([^\/]+)/);
        if (walletIdMatch) {
          const walletId = walletIdMatch[1];
          const { page = '1', pageSize = '50' } = req.query;

          backendPath = `/api/wallet-metadata/wallet-timeline/${walletId}?page=${page}&pageSize=${pageSize}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;

          console.log(`📊 [WALLET-TIMELINE-PROXY-${requestId}] GET wallet timeline for wallet: ${walletId.slice(0, 8)}... (page: ${page}, size: ${pageSize})`);
        } else {
          console.log(`❌ [WALLET-TIMELINE-PROXY-${requestId}] Invalid wallet-timeline URL format: ${req.url}`);
          return res.status(400).json({ success: false, error: 'Invalid wallet-timeline URL format' });
        }

      } else if (action === 'balances') {
        // Disabled: note-based balance endpoint removed
        console.log(`🚫 [WALLET-METADATA-PROXY-${requestId}] GET balances disabled (note system removed)`);
        return res.status(410).json({ success: false, error: 'balances endpoint disabled' });

      } else if (action === 'lexie-status') {
        const lexieID = req.query.lexieID;
        backendPath = `/api/status?lexieID=${encodeURIComponent(lexieID)}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie status for ${lexieID}`);

      } else if (action === 'lexie-resolve') {
        const lexieID = req.query.lexieID;
        backendPath = `/api/resolve?lexieID=${encodeURIComponent(lexieID)}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie resolve for ${lexieID}`);
      } else if (action === 'by-wallet') {
        const railgunAddress = req.query.railgunAddress || req.query.walletAddress;
        if (!railgunAddress) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing railgunAddress for by-wallet`);
          return res.status(400).json({ success: false, error: 'Missing railgunAddress' });
        }
        backendPath = `/api/by-wallet?railgunAddress=${encodeURIComponent(railgunAddress)}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie by-wallet for ${String(railgunAddress).slice(0,8)}...`);

      } else {
        // Handle GET: retrieve wallet metadata (original functionality)
        if (!walletAddress) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing walletAddress parameter for GET`);
          return res.status(400).json({
            success: false,
            error: 'Missing walletAddress parameter'
          });
        }

        backendPath = `/api/get-wallet-metadata/${walletAddress}`;
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET request for wallet ${walletAddress?.slice(0, 8)}...`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

    } else if (req.method === 'POST') {
      // Check if this is a resolve-wallet-id POST request (future use)
      if (req.url.includes('/resolve-wallet-id/')) {
        // Extract the resolve type and identifier from URL path
        const urlPath = req.url.split('?')[0]; // Remove query parameters

        // Handle /resolve-wallet-id/by-eoa/:address
        const eoaMatch = urlPath.match(/\/resolve-wallet-id\/by-eoa\/([^\/]+)/);
        if (eoaMatch) {
          const address = eoaMatch[1];
          backendPath = `/api/resolve-wallet-id/by-eoa/${address}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] POST resolve wallet by EOA: ${address.slice(0, 8)}...`);
        }

        // Handle /resolve-wallet-id/by-railgun/:railgunAddress
        const railgunMatch = urlPath.match(/\/resolve-wallet-id\/by-railgun\/([^\/]+)/);
        if (railgunMatch) {
          const railgunAddress = railgunMatch[1];
          backendPath = `/api/resolve-wallet-id/by-railgun/${railgunAddress}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] POST resolve wallet by Railgun: ${railgunAddress.slice(0, 8)}...`);
        }

        // Handle /resolve-wallet-id/by-tx/:txId
        const txMatch = urlPath.match(/\/resolve-wallet-id\/by-tx\/([^\/]+)/);
        if (txMatch) {
          const txId = txMatch[1];
          backendPath = `/api/resolve-wallet-id/by-tx/${txId}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] POST resolve wallet by TX: ${txId.slice(0, 8)}...`);
        }

        // If no matches found, return error
        if (!backendPath) {
          console.log(`❌ [RESOLVE-PROXY-${requestId}] Invalid resolve-wallet-id POST URL format: ${req.url}`);
          return res.status(400).json({ success: false, error: 'Invalid resolve-wallet-id URL format' });
        }

      } else if (req.url.includes('/wallet-timeline/')) {
        // Extract walletId from URL path
        const urlPath = req.url.split('?')[0]; // Remove query parameters
        const walletIdMatch = urlPath.match(/\/wallet-timeline\/([^\/]+)/);
        if (walletIdMatch) {
          const walletId = walletIdMatch[1];
          backendPath = `/api/wallet-metadata/wallet-timeline/${walletId}`;
          backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
          console.log(`📊 [WALLET-TIMELINE-PROXY-${requestId}] POST wallet timeline for wallet: ${walletId.slice(0, 8)}...`);
        } else {
          console.log(`❌ [WALLET-TIMELINE-PROXY-${requestId}] Invalid wallet-timeline POST URL format: ${req.url}`);
          return res.status(400).json({ success: false, error: 'Invalid wallet-timeline URL format' });
        }

      } else if (action === 'store-balances') {
        // Handle POST: store balances only
        backendPath = '/api/store-wallet-balances';
        console.log(`💾 [WALLET-METADATA-PROXY-${requestId}] POST store balances`);

      } else if (action === 'lexie-link-start') {
        backendPath = '/api/start';
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        console.log(`🔗 [WALLET-METADATA-PROXY-${requestId}] POST Lexie link start`);

      } else if (action === 'lexie-link-verify') {
        backendPath = '/api/verify';
        backendUrl = `https://staging.api.lexiecrypto.com${backendPath}`;
        console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] POST Lexie link verify`);

      } else {
        // Default: store wallet metadata (signature, encryptedMnemonic, reverse index, balances merge)
        backendPath = '/api/store-wallet-metadata';
        console.log(`💾 [WALLET-METADATA-PROXY-${requestId}] POST store wallet metadata`);
      }

      backendUrl = backendUrl || `https://staging.api.lexiecrypto.com${backendPath}`;
      
      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://staging.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };
    }

    console.log(`🔐 [WALLET-METADATA-PROXY-${requestId}] Generated HMAC headers`, {
      method: req.method,
      timestamp,
      signature: headers['X-Lexie-Signature'].substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [WALLET-METADATA-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

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
    const result = await backendResponse.json();

    console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);

  } catch (error) {
    console.error(`❌ [WALLET-METADATA-PROXY-${requestId}] Error:`, {
      method: req.method,
      error: error.message,
      stack: error.stack,
      action: req.query.action || 'metadata',
      walletAddress: req.query.walletAddress?.slice(0, 8) + '...' || 'N/A'
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message.includes('timeout') ? 'Backend timeout - please try again' :
               'Internal proxy error'
      });
    }
  }
} 