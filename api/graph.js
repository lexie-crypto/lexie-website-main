/**
 * Vercel Serverless Function - RAILGUN Graph API Proxy
 * For Vite projects: API routes go in /api/ directory (not pages/api/)
 * Bypasses CORS issues for The Graph API calls
 */

// Configure body parser for proper request handling
export const config = {
  api: {
    bodyParser: true,
  },
};

// RAILGUN Graph endpoints per chain
const GRAPH_ENDPOINTS = {
  1: 'https://api.thegraph.com/subgraphs/name/railgun-community/railgun-v2-ethereum',
  42161: 'https://api.thegraph.com/subgraphs/name/railgun-community/railgun-v2-arbitrum-one',  
  137: 'https://api.thegraph.com/subgraphs/name/railgun-community/railgun-v2-matic',
  56: 'https://api.thegraph.com/subgraphs/name/railgun-community/railgun-v2-bsc',
};

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    console.error(`[GRAPH PROXY] ❌ Method not allowed: ${req.method}`);
    return res.status(405).json({ 
      error: 'Method not allowed. Only POST requests are supported.' 
    });
  }

  try {
    // COMPREHENSIVE LOGGING: Log everything about the incoming request
    console.log('[GRAPH PROXY] 🔍 === REQUEST DEBUG START ===');
    console.log('[GRAPH PROXY] Method:', req.method);
    console.log('[GRAPH PROXY] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[GRAPH PROXY] Raw req.body type:', typeof req.body);
    console.log('[GRAPH PROXY] Raw req.body value:', JSON.stringify(req.body, null, 2));
    console.log('[GRAPH PROXY] req.body keys:', req.body ? Object.keys(req.body) : 'NO KEYS');
    console.log('[GRAPH PROXY] === REQUEST DEBUG END ===');

    // Extract request data
    const { chainId, query, variables } = req.body || {};
    
    console.log('[GRAPH PROXY] 📝 Extracted values:');
    console.log('[GRAPH PROXY] - chainId:', chainId);
    console.log('[GRAPH PROXY] - query type:', typeof query);
    console.log('[GRAPH PROXY] - query length:', query ? query.length : 'N/A');
    console.log('[GRAPH PROXY] - variables type:', typeof variables);
    console.log('[GRAPH PROXY] - variables keys:', variables ? Object.keys(variables) : 'N/A');
    
    // Validate request body exists
    if (!req.body) {
      console.error('[GRAPH PROXY] ❌ No request body received');
      return res.status(400).json({ 
        error: 'No request body received. Expected JSON with chainId, query, and variables.' 
      });
    }
    
    // Validate required GraphQL query
    if (!query) {
      console.error('[GRAPH PROXY] ❌ Missing GraphQL query in body:', JSON.stringify(req.body, null, 2));
      console.error('[GRAPH PROXY] ❌ Body type:', typeof req.body);
      console.error('[GRAPH PROXY] ❌ Body keys:', req.body ? Object.keys(req.body) : 'NONE');
      return res.status(400).json({ 
        error: 'Missing GraphQL query',
        debug: {
          bodyType: typeof req.body,
          bodyKeys: req.body ? Object.keys(req.body) : [],
          receivedBody: req.body
        }
      });
    }

    // Use default chainId if not provided (Arbitrum One)
    const targetChainId = chainId || 42161;

    // Get the appropriate Graph endpoint for the chain
    const endpoint = GRAPH_ENDPOINTS[targetChainId];
    if (!endpoint) {
      return res.status(400).json({ 
        error: `Unsupported chain ID: ${targetChainId}. Supported chains: ${Object.keys(GRAPH_ENDPOINTS).join(', ')}` 
      });
    }

    console.log(`[GRAPH PROXY] 🚀 Proxying request for chain ${targetChainId} to:`, endpoint);
    console.log(`[GRAPH PROXY] 📤 Outgoing query length:`, query.length);
    console.log(`[GRAPH PROXY] 📤 Outgoing variables:`, JSON.stringify(variables || {}, null, 2));

    // Forward the request to The Graph
    const graphRequestBody = {
      query,
      variables: variables || {}
    };
    
    console.log(`[GRAPH PROXY] 📦 Full request body to Graph API:`, JSON.stringify(graphRequestBody, null, 2));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Lexie-RAILGUN-Client/1.0'
      },
      body: JSON.stringify(graphRequestBody),
    });

    console.log(`[GRAPH PROXY] 📡 Graph API response status:`, response.status, response.statusText);

    if (!response.ok) {
      console.error(`[GRAPH PROXY] ❌ Request failed:`, {
        status: response.status,
        statusText: response.statusText,
        chainId: targetChainId,
        endpoint
      });
      
      return res.status(response.status).json({ 
        error: `Graph API request failed: ${response.status} ${response.statusText}` 
      });
    }

    const data = await response.json();
    
    console.log(`[GRAPH PROXY] 📥 Graph API response received:`, {
      hasData: !!data.data,
      hasErrors: !!data.errors,
      dataKeys: data.data ? Object.keys(data.data) : [],
      errorCount: data.errors ? data.errors.length : 0
    });
    
    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      console.error(`[GRAPH PROXY] ❌ GraphQL errors:`, data.errors);
      return res.status(400).json({ 
        error: 'GraphQL query errors',
        details: data.errors 
      });
    }

    console.log(`[GRAPH PROXY] ✅ Success for chain ${targetChainId}`);
    console.log(`[GRAPH PROXY] 📊 Response data keys:`, data.data ? Object.keys(data.data) : []);

    // Return the raw Graph API response
    return res.status(200).json(data);

  } catch (error) {
    console.error('[GRAPH PROXY] 💥 Proxy error:', error);
    console.error('[GRAPH PROXY] 💥 Error stack:', error.stack);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
} 