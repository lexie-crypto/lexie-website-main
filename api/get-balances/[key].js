/**
 * Vercel Serverless Function - Get Balance Data from Redis
 * Key: wallet_balances:<walletId>-<chainId>
 * Returns: { updatedAt, balances: [...], isFresh: boolean }
 */

import crypto from 'crypto';
import Redis from 'ioredis';

// Configure body parser for proper request handling
export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Initialize Redis client with TLS configuration (from testRedisWalletFlow.mjs)
 */
function initializeRedisClient() {
  try {
    let redisClient;

    if (process.env.REDIS_URL) {
      redisClient = new Redis(process.env.REDIS_URL, {
        tls: {
          ca: process.env.REDIS_CA_CERT,
          cert: process.env.REDIS_CLIENT_CERT,
          key: process.env.REDIS_CLIENT_KEY,
          rejectUnauthorized: true,
        },
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        lazyConnect: true
      });
    } else if (process.env.REDIS_HOST) {
      redisClient = new Redis({
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || "6379"),
        db: parseInt(process.env.REDIS_DB || "0"),
        tls: process.env.REDIS_TLS === "true" ? {
          ca: process.env.REDIS_CA_CERT,
          cert: process.env.REDIS_CLIENT_CERT,
          key: process.env.REDIS_CLIENT_KEY,
          rejectUnauthorized: process.env.REDIS_REJECT_UNAUTHORIZED === "true",
        } : undefined,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        connectTimeout: 10000,
        lazyConnect: true
      });
    } else {
      throw new Error('No Redis configuration found');
    }

    return redisClient;
  } catch (error) {
    console.error('[GET-BALANCES] ❌ Redis client initialization failed:', error.message);
    throw error;
  }
}

/**
 * Validate HMAC signature
 */
function validateHmacSignature(req) {
  const hmacSecret = process.env.LEXIE_HMAC_SECRET;
  if (!hmacSecret) {
    throw new Error('LEXIE_HMAC_SECRET environment variable is not set');
  }

  const method = req.method;
  const timestamp = req.headers['x-lexie-timestamp'];
  const signature = req.headers['x-lexie-signature'];

  if (!timestamp || !signature) {
    throw new Error('Missing required HMAC headers');
  }

  const requestTimestamp = parseInt(timestamp, 10);
  if (isNaN(requestTimestamp)) {
    throw new Error('Invalid timestamp format');
  }

  const drift = Math.abs(Date.now() - requestTimestamp);
  if (drift > 5 * 60 * 1000) { // 5 minutes
    throw new Error(`Timestamp expired by ${drift}ms`);
  }

  // Use actual request path with key parameter
  const path = req.url;
  const payload = `${method}:${path}:${timestamp}`;

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', hmacSecret)
    .update(payload)
    .digest('hex');

  if (!signature.startsWith('sha256=')) {
    throw new Error('Invalid signature format');
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid signature');
  }

  console.log('[GET-BALANCES] ✅ HMAC signature validated');
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Lexie-Timestamp, X-Lexie-Signature, Origin, User-Agent');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Only GET requests are supported.' 
    });
  }

  try {
    console.log('[GET-BALANCES] 🔍 Request received:', {
      method: req.method,
      url: req.url
    });

    // Validate HMAC signature
    validateHmacSignature(req);

    // Extract key from URL path (walletId-chainId format)
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing key parameter in URL path' 
      });
    }

    console.log(`[GET-BALANCES] 📥 Retrieving balance data for key: ${key}`);

    // Initialize Redis client
    const redisClient = initializeRedisClient();
    await redisClient.connect();

    try {
      // Get balance data from Redis using proper key format
      const redisKey = `wallet_balances:${key}`;
      const balanceDataJson = await redisClient.get(redisKey);

      if (!balanceDataJson) {
        console.log(`[GET-BALANCES] ❌ No balance data found for key: ${key}`);
        await redisClient.quit();
        
        return res.status(404).json({
          success: false,
          error: 'Balance data not found'
        });
      }

      const balanceData = JSON.parse(balanceDataJson);
      
      // Calculate freshness (< 5 minutes = fresh)
      const age = Date.now() - balanceData.updatedAt;
      const isFresh = age < (5 * 60 * 1000); // 5 minutes in milliseconds
      
      console.log(`[GET-BALANCES] ✅ Found balance data:`, {
        key,
        redisKey,
        balanceCount: balanceData.balances?.length || 0,
        updatedAt: balanceData.updatedAt ? new Date(balanceData.updatedAt).toISOString() : 'Unknown',
        age: `${Math.round(age / 1000)}s`,
        isFresh
      });

      await redisClient.quit();

      return res.status(200).json({
        success: true,
        data: {
          updatedAt: balanceData.updatedAt,
          balances: balanceData.balances || [],
          isFresh
        }
      });

    } catch (redisError) {
      console.error('[GET-BALANCES] ❌ Redis operation failed:', redisError);
      await redisClient.quit().catch(() => {});
      
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve balance data',
        details: redisError.message
      });
    }

  } catch (error) {
    console.error('[GET-BALANCES] ❌ Handler error:', error);
    
    if (error.message.includes('HMAC') || error.message.includes('signature') || error.message.includes('timestamp')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed',
        details: error.message
      });
    }
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
} 