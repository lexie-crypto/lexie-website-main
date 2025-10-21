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

  // HMAC secret is required for all authenticated requests
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    console.error(`❌ [WALLET-METADATA-PROXY-${requestId}] LEXIE_HMAC_SECRET environment variable is not set`);
    return res.status(500).json({
      success: false,
      error: 'Server authentication configuration error'
    });
  }

  // Titans API by-lexieid endpoint is now public (no auth needed)

  console.log(`🔄 [WALLET-METADATA-PROXY-${requestId}] ${req.method} request`, {
    method: req.method,
    url: req.url,
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
    'https://lexiecrypto.com',
    'https://app.lexiecrypto.com',
    'https://chatroom.lexiecrypto.com',
    'https://pay.lexiecrypto.com',
    'https://pay.lexiecrypto.com',
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
    console.log(`🌐 [WALLET-METADATA-PROXY-${requestId}] OPTIONS preflight response sent for: ${req.url}`);
    return res.status(204).end();
  }

  // Check for contacts requests using req.query (Next.js parses query params automatically)
  const isContactsRequest = req.query.action === 'contacts';

  if (isContactsRequest) {
    // Extract wallet address and wallet ID from req.query
    const walletAddress = req.query.walletAddress;
    const walletId = req.query.walletId;

    if (!walletAddress || !walletId) {
      return res.status(400).json({
        success: false,
        error: 'Missing walletAddress or walletId parameters'
      });
    }

    // Forward to dedicated backend contacts endpoints
    // GET: /api/wallet-metadata/contacts/{walletAddress}/{walletId}
    // PUT: /api/wallet-metadata/contacts/{walletAddress}/{walletId}
    const backendPath = `/api/wallet-metadata/contacts/${walletAddress}/${walletId}`;
    const backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    const timestamp = Date.now().toString();
    const bodyString = req.method === 'POST' || req.method === 'PUT' ? JSON.stringify(req.body) : '';
    const signature = generateHmacSignature(req.method, backendPath, timestamp, hmacSecret);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Contacts-Proxy/1.0',
    };

    try {
      const fetchOptions = {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(30000),
      };

      if (bodyString) {
        fetchOptions.body = bodyString;
      }

      const backendResponse = await fetch(backendUrl, fetchOptions);
      const responseBody = await backendResponse.text();

      try {
        const jsonResult = JSON.parse(responseBody);
        res.status(backendResponse.status).json(jsonResult);
      } catch (jsonError) {
        console.error(`❌ [CONTACTS-PROXY-${requestId}] Failed to parse response as JSON:`, jsonError.message);
        res.status(backendResponse.status).send(responseBody);
      }

    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message.includes('timeout') ? 'Backend timeout - please try again' :
                 error.message.includes('502') ? 'Backend service unavailable' :
                 'Internal proxy error'
        });
      }
    }

    return; // Exit after handling contacts request
  }

  // Only allow GET, POST, and PUT methods for non-contacts requests
  if (!['GET', 'POST', 'PUT'].includes(req.method)) {
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
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;

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
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;

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
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;

        console.log(`📊 [HISTORY-PROXY-${requestId}] GET history for wallet: ${(walletId?.toString() || '').slice(0, 8)}... (page: ${page}, size: ${pageSize})`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);

      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
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
      backendUrl = `https://api.lexiecrypto.com${backendPath}`;

      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
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

  // Handle timeline append from frontend monitor (HMAC added server-side)
  if (req.method === 'POST' && action === 'timeline-append') {
    try {
      const body = req.body || {};
      const walletIdBody = body.walletId;
      const event = body.event;

      if (!walletIdBody || !event) {
        return res.status(400).json({ success: false, error: 'Missing walletId or event' });
      }

      // Forward to backend timeline append endpoint
      const backendPath = `/api/wallet-metadata/timeline-append/${encodeURIComponent(walletIdBody)}`;
      const backendUrl = `https://api.lexiecrypto.com${backendPath}`;

      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

      const backendResp = await fetch(backendUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event }),
        signal: AbortSignal.timeout(30000),
      });

      const result = await backendResp.json();
      return res.status(backendResp.status).json(result);
    } catch (err) {
      console.error('❌ [WALLET-METADATA-PROXY] timeline-append error:', err);
      return res.status(500).json({ success: false, error: 'timeline-append proxy error' });
    }
  }

  // Handle fee data storage from frontend (direct fee calculation)
  if (req.method === 'POST' && action === 'store-fee-data') {
    try {
      const body = req.body || {};
      const { traceId, feeData } = body;

      if (!traceId || !feeData) {
        return res.status(400).json({ success: false, error: 'Missing traceId or feeData' });
      }

      console.log(`💰 [FEE-STORE-PROXY-${requestId}] Storing fee data for traceId: ${traceId}`);

      // Forward to backend fee storage endpoint
      const backendPath = '/api/wallet-metadata/store-fee-data';
      const backendUrl = `https://api.lexiecrypto.com${backendPath}`;

      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Fee-Store-Proxy/1.0',
      };

      const backendResp = await fetch(backendUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ traceId, feeData }),
        signal: AbortSignal.timeout(30000),
      });

      const result = await backendResp.json();
      console.log(`✅ [FEE-STORE-PROXY-${requestId}] Fee storage result:`, result);
      return res.status(backendResp.status).json(result);
    } catch (err) {
      console.error('❌ [FEE-STORE-PROXY] Error storing fee data:', err);
      return res.status(500).json({ success: false, error: 'fee-store proxy error' });
    }
  }

  // Handle analytics endpoint
  if (action === 'get-analytics') {
    console.log(`✅ [ANALYTICS-PROXY-${requestId}] Analytics endpoint detected`);

    // Build query string from analytics parameters
    const { period, startDate, endDate } = req.query;
    const analyticsQueryParams = new URLSearchParams();

    if (period && typeof period === 'string') {
      analyticsQueryParams.append('period', period);
    }
    if (startDate && typeof startDate === 'string') {
      analyticsQueryParams.append('startDate', startDate);
    }
    if (endDate && typeof endDate === 'string') {
      analyticsQueryParams.append('endDate', endDate);
    }

    const queryString = analyticsQueryParams.toString();
    backendPath = queryString ? `/api/get-analytics?${queryString}` : '/api/get-analytics';
    backendUrl = `https://api.lexiecrypto.com${backendPath}`;

    const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);

    headers = {
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': 'https://app.lexiecrypto.com',
      'User-Agent': 'Lexie-Analytics-Proxy/1.0',
    };

    console.log(`🔐 [ANALYTICS-PROXY-${requestId}] Generated HMAC headers`, {
      method: 'GET',
      timestamp,
      signature: headers['X-Lexie-Signature'].substring(0, 20) + '...',
      path: backendPath
    });

    console.log(`📡 [ANALYTICS-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

    // Make the backend request
    const fetchOptions = {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(30000),
    };

    const backendResponse = await fetch(backendUrl, fetchOptions);
    const result = await backendResponse.json();

    console.log(`✅ [ANALYTICS-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

    // Forward the backend response
    res.status(backendResponse.status).json(result);
    return; // Exit after handling analytics
  }

  // Original wallet-metadata logic continues below
  console.log(`📊 [PROXY-${requestId}] Processing as regular wallet-metadata route`);
  if (req.method === 'GET') {
      if (action === 'balances') {
        // Disabled: note-based balance endpoint removed
        console.log(`🚫 [WALLET-METADATA-PROXY-${requestId}] GET balances disabled (note system removed)`);
        return res.status(410).json({ success: false, error: 'balances endpoint disabled' });

      } else if (action === 'lexie-status') {
        const lexieID = req.query.lexieID;
        backendPath = `/api/status?lexieID=${encodeURIComponent(lexieID)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie status for ${lexieID}`);
      } else if (action === 'rewards-balance') {
        const lexieID = req.query.lexieId || req.query.lexieID;
        if (!lexieID) {
          console.log(`❌ [REWARDS-PROXY-${requestId}] Missing lexieId for rewards-balance`);
          return res.status(400).json({ success: false, error: 'Missing lexieId' });
        }
        backendPath = `/api/rewards/balance?lexieId=${encodeURIComponent(lexieID)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🎁 [REWARDS-PROXY-${requestId}] GET balance for ${lexieID}`);

      } else if (action === 'rewards-combined-balance') {
        const lexieID = req.query.lexieId || req.query.lexieID;
        if (!lexieID) {
          console.log(`❌ [REWARDS-PROXY-${requestId}] Missing lexieId for rewards-combined-balance`);
          return res.status(400).json({ success: false, error: 'Missing lexieId' });
        }

        // Forward all query parameters to the backend
        const queryParams = new URLSearchParams();
        queryParams.append('lexieId', lexieID);

        // Forward game points and referral points if provided
        if (req.query.gamePoints !== undefined) {
          queryParams.append('gamePoints', req.query.gamePoints);
        }
        if (req.query.referralPoints !== undefined) {
          queryParams.append('referralPoints', req.query.referralPoints);
        }

        backendPath = `/api/rewards/combined-balance?${queryParams.toString()}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🎁 [REWARDS-PROXY-${requestId}] GET combined balance for ${lexieID} with gamePoints=${req.query.gamePoints}, referralPoints=${req.query.referralPoints}`);
        console.log(`🎁 [REWARDS-PROXY-${requestId}] Full query:`, req.query);
        console.log(`🎁 [REWARDS-PROXY-${requestId}] Backend URL: ${backendUrl}`);

      } else if (action === 'get-game-points') {
        const lexieID = req.query.lexieId || req.query.lexieID;
        if (!lexieID) {
          console.log(`❌ [GAME-POINTS-PROXY-${requestId}] Missing lexieId for get-game-points`);
          return res.status(400).json({ success: false, error: 'Missing lexieId' });
        }
        // Use titans API with HMAC authentication
        backendPath = `/users/by-lexieid/${encodeURIComponent(lexieID)}`;
        backendUrl = `https://titans-api.lexiecrypto.com${backendPath}`;
        console.log(`🎮 [GAME-POINTS-PROXY-${requestId}] GET game points for ${lexieID}`);

      } else if (action === 'lexie-resolve') {
        const lexieID = req.query.lexieID;
        backendPath = `/api/resolve?lexieID=${encodeURIComponent(lexieID)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie resolve for ${lexieID}`);
      } else if (action === 'by-wallet') {
        const railgunAddress = req.query.railgunAddress || req.query.walletAddress;
        if (!railgunAddress) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing railgunAddress for by-wallet`);
          return res.status(400).json({ success: false, error: 'Missing railgunAddress' });
        }
        backendPath = `/api/by-wallet?railgunAddress=${encodeURIComponent(railgunAddress)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET Lexie by-wallet for ${String(railgunAddress).slice(0,8)}...`);

      } else if (action === 'check-verification') {
        const eoa = req.query.eoa;
        if (!eoa) {
          console.log(`❌ [WALLET-METADATA-PROXY-${requestId}] Missing eoa for check-verification`);
          return res.status(400).json({ success: false, error: 'Missing eoa parameter' });
        }
        backendPath = `/api/check-verification?eoa=${encodeURIComponent(eoa)}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET check-verification for EOA ${eoa.slice(0,8)}...`);

      } else if (action === 'resolve-wallet-id') {
        const resolveType = req.query.type;
        const identifier = req.query.identifier || req.query.address || req.query.railgunAddress || req.query.txId;

        if (!identifier) {
          console.log(`❌ [RESOLVE-PROXY-${requestId}] Missing identifier for resolve-wallet-id`);
          return res.status(400).json({ success: false, error: 'Missing identifier parameter' });
        }

        if (resolveType === 'by-eoa' || req.query.address) {
          backendPath = `/api/resolve-wallet-id/by-eoa/${identifier}`;
          backendUrl = `https://api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] Resolve wallet by EOA: ${identifier.slice(0, 8)}...`);
        } else if (resolveType === 'by-railgun' || req.query.railgunAddress) {
          backendPath = `/api/resolve-wallet-id/by-railgun/${identifier}`;
          backendUrl = `https://api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] Resolve wallet by Railgun: ${identifier.slice(0, 8)}...`);
        } else if (resolveType === 'by-tx' || req.query.txId) {
          backendPath = `/api/resolve-wallet-id/by-tx/${identifier}`;
          backendUrl = `https://api.lexiecrypto.com${backendPath}`;
          console.log(`🔍 [RESOLVE-PROXY-${requestId}] Resolve wallet by TX: ${identifier.slice(0, 8)}...`);
        } else {
          console.log(`❌ [RESOLVE-PROXY-${requestId}] Invalid resolve type: ${resolveType}`);
          return res.status(400).json({ success: false, error: 'Invalid resolve type' });
        }

      } else if (action === 'wallet-timeline') {
        const walletId = req.query.walletId;
        if (!walletId) {
          console.log(`❌ [WALLET-TIMELINE-PROXY-${requestId}] Missing walletId for wallet-timeline GET`);
          return res.status(400).json({ success: false, error: 'Missing walletId parameter' });
        }

        const { page = '1', pageSize = '50' } = req.query;
        backendPath = `/api/wallet-metadata/wallet-timeline/${walletId}?page=${page}&pageSize=${pageSize}`;
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`📊 [WALLET-TIMELINE-PROXY-${requestId}] GET wallet timeline for wallet: ${walletId.slice(0, 8)}... (page: ${page}, size: ${pageSize})`);

      } else if (action === 'get-all-points') {
        backendPath = '/api/get-all-points';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`📊 [POINTS-PROXY-${requestId}] GET all points data`);

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
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        
        console.log(`🔍 [WALLET-METADATA-PROXY-${requestId}] GET request for wallet ${walletAddress?.slice(0, 8)}...`);
      }

      const signature = generateHmacSignature('GET', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

    } else if (req.method === 'POST') {
      // Handle admin password verification through proxy
      if (action === 'verify-admin-password') {
        console.log(`🔐 [ADMIN-PASSWORD-PROXY-${requestId}] POST verify admin password through proxy`);

        const backendPath = '/api/verify-admin-password';
        const backendUrl = `https://api.lexiecrypto.com${backendPath}`;

        const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);

        headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-lexie-timestamp': timestamp,
          'x-lexie-signature': signature,
          'Origin': 'https://app.lexiecrypto.com',
          'User-Agent': 'Lexie-Wallet-Proxy/1.0',
        };

        console.log(`🔐 [ADMIN-PASSWORD-PROXY-${requestId}] Generated HMAC headers`, {
          method: 'POST',
          timestamp,
          signature: headers['x-lexie-signature'].substring(0, 20) + '...',
          path: backendPath
        });

        console.log(`📡 [ADMIN-PASSWORD-PROXY-${requestId}] Forwarding to backend: ${backendUrl}`);

        // Make the backend request
        const fetchOptions = {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify(req.body)
        };

        const backendResponse = await fetch(backendUrl, fetchOptions);
        const result = await backendResponse.json();

        console.log(`✅ [ADMIN-PASSWORD-PROXY-${requestId}] Backend responded with status ${backendResponse.status}`);

        // Forward the backend response
        res.status(backendResponse.status).json(result);
        return;

      } else if (action === 'store-balances') {
        // Handle POST: store balances only
        backendPath = '/api/store-wallet-balances';
        console.log(`💾 [WALLET-METADATA-PROXY-${requestId}] POST store balances`);

      } else if (action === 'lexie-link-start') {
        backendPath = '/api/start';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔗 [WALLET-METADATA-PROXY-${requestId}] POST Lexie link start`);

      } else if (action === 'lexie-link-verify') {
        backendPath = '/api/verify';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] POST Lexie link verify`);

      } else if (action === 'lexie-claim') {
        backendPath = '/api/claim';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🎯 [WALLET-METADATA-PROXY-${requestId}] POST Lexie claim`);

      } else if (action === 'generate-verification') {
        backendPath = '/api/generate-verification';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🔗 [WALLET-METADATA-PROXY-${requestId}] POST generate verification`);

      } else if (action === 'verify-cross-link') {
        backendPath = '/api/verify-cross-link';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`✅ [WALLET-METADATA-PROXY-${requestId}] POST verify cross-link`);

      } else if (action === 'rewards-award') {
        backendPath = '/api/rewards/award';
        backendUrl = `https://api.lexiecrypto.com${backendPath}`;
        console.log(`🎁 [REWARDS-PROXY-${requestId}] POST award points`);

      } else {
        // Default: store wallet metadata (signature, encryptedMnemonic, reverse index, balances merge)
        backendPath = '/api/store-wallet-metadata';
        console.log(`💾 [WALLET-METADATA-PROXY-${requestId}] POST store wallet metadata`);
      }

      backendUrl = backendUrl || `https://api.lexiecrypto.com${backendPath}`;
      
      const signature = generateHmacSignature('POST', backendPath, timestamp, hmacSecret);
      
      headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };
    }

    // Generate appropriate authentication headers based on backend
    if (backendUrl.includes('titans-api.lexiecrypto.com')) {
      // Titans API by-lexieid endpoint is now public - no auth headers needed
      headers = {
        'Accept': 'application/json',
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

      console.log(`🌐 [WALLET-METADATA-PROXY-${requestId}] Public endpoint - no auth headers`, {
        method: req.method,
        path: backendPath,
        backend: 'titans'
      });
    } else {
      // Lexie API uses HMAC authentication
      const signature = generateHmacSignature(req.method, backendPath, timestamp, hmacSecret);

      headers = {
        'Accept': 'application/json',
        'X-Lexie-Timestamp': timestamp,
        'X-Lexie-Signature': signature,
        'Origin': 'https://app.lexiecrypto.com',
        'User-Agent': 'Lexie-Wallet-Proxy/1.0',
      };

      console.log(`🔐 [WALLET-METADATA-PROXY-${requestId}] Generated HMAC headers`, {
        method: req.method,
        timestamp,
        signature: signature.substring(0, 20) + '...',
        path: backendPath,
        backend: 'lexie'
      });
    }

    // Add Content-Type for POST requests
    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

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