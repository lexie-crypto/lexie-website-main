/**
 * Vercel Serverless Function - RAILGUN Graph API Proxy
 * For Vite projects: API routes go in /api/ directory (not pages/api/)
 * Bypasses CORS issues for The Graph API calls
 */

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
    return res.status(405).json({ 
      error: 'Method not allowed. Only POST requests are supported.' 
    });
  }

  try {
    // Debug: Log the entire request for troubleshooting
    console.log('[Graph API] Request received:', {
      method: req.method,
      headers: req.headers,
      bodyType: typeof req.body,
      body: req.body
    });

    // Extract chain ID from request
    const { chainId, query, variables } = req.body || {};
    
    if (!req.body) {
      console.error('[Graph API] No request body received');
      return res.status(400).json({ 
        error: 'No request body received' 
      });
    }
    
    if (!chainId) {
      console.error('[Graph API] Missing chainId in request body:', req.body);
      return res.status(400).json({ 
        error: 'Missing chainId in request body',
        received: req.body
      });
    }

    if (!query) {
      console.error('[Graph API] Missing GraphQL query in request body:', req.body);
      return res.status(400).json({ 
        error: 'Missing GraphQL query in request body',
        received: req.body
      });
    }

    // Get the appropriate Graph endpoint for the chain
    const endpoint = GRAPH_ENDPOINTS[chainId];
    if (!endpoint) {
      return res.status(400).json({ 
        error: `Unsupported chain ID: ${chainId}. Supported chains: ${Object.keys(GRAPH_ENDPOINTS).join(', ')}` 
      });
    }

    console.log(`[Graph API] Proxying request for chain ${chainId} to:`, endpoint);

    // Forward the request to The Graph
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Lexie-RAILGUN-Client/1.0'
      },
      body: JSON.stringify({
        query,
        variables: variables || {}
      }),
    });

    if (!response.ok) {
      console.error(`[Graph API] Request failed:`, {
        status: response.status,
        statusText: response.statusText,
        chainId,
        endpoint
      });
      
      return res.status(response.status).json({ 
        error: `Graph API request failed: ${response.status} ${response.statusText}` 
      });
    }

    const data = await response.json();
    
    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      console.error(`[Graph API] GraphQL errors:`, data.errors);
      return res.status(400).json({ 
        error: 'GraphQL query errors',
        details: data.errors 
      });
    }

    console.log(`[Graph API] Success for chain ${chainId}:`, {
      hasData: !!data.data,
      resultKeys: data.data ? Object.keys(data.data) : []
    });

    // Return the raw Graph API response
    return res.status(200).json(data);

  } catch (error) {
    console.error('[Graph API] Proxy error:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
} 