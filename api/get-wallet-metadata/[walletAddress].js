/**
 * Vercel Serverless Function - Get Wallet Metadata from Redis
 * Key: wallet_meta:<walletAddress>
 * Returns: { walletAddress, walletId, createdAt }
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
    console.error('[GET-WALLET-METADATA] ❌ Redis client initialization failed:', error.message);
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

  // Use actual request path with wallet address
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

  console.log('[GET-WALLET-METADATA] ✅ HMAC signature validated');
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
    console.log('[GET-WALLET-METADATA] 🔍 Request received:', {
      method: req.method,
      url: req.url
    });

    // Validate HMAC signature
    validateHmacSignature(req);

    // Extract walletAddress from URL path
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing walletAddress in URL path' 
      });
    }

    console.log(`[GET-WALLET-METADATA] 📥 Retrieving wallet metadata for:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...'
    });

    // Initialize Redis client
    const redisClient = initializeRedisClient();
    await redisClient.connect();

    try {
      // Get wallet metadata from Redis
      const redisKey = `wallet_meta:${walletAddress}`;
      const walletDataJson = await redisClient.get(redisKey);

      if (!walletDataJson) {
        console.log(`[GET-WALLET-METADATA] ❌ No wallet metadata found for: ${walletAddress?.slice(0, 8)}...`);
        await redisClient.quit();
        
        return res.status(404).json({
          success: false,
          error: 'Wallet metadata not found'
        });
      }

      const walletData = JSON.parse(walletDataJson);
      
      console.log(`[GET-WALLET-METADATA] ✅ Found wallet metadata:`, {
        walletAddress: walletData.walletAddress?.slice(0, 8) + '...',
        walletId: walletData.walletId?.slice(0, 8) + '...',
        createdAt: walletData.createdAt ? new Date(walletData.createdAt).toISOString() : 'Unknown'
      });

      await redisClient.quit();

      return res.status(200).json({
        success: true,
        data: {
          walletAddress: walletData.walletAddress,
          walletId: walletData.walletId,
          createdAt: walletData.createdAt
        }
      });

    } catch (redisError) {
      console.error('[GET-WALLET-METADATA] ❌ Redis operation failed:', redisError);
      await redisClient.quit().catch(() => {});
      
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve wallet metadata',
        details: redisError.message
      });
    }

  } catch (error) {
    console.error('[GET-WALLET-METADATA] ❌ Handler error:', error);
    
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