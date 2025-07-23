/**
 * Vercel Serverless Function - Store Wallet Metadata in Redis
 * Key: wallet_meta:<walletAddress>
 * Value: { walletAddress, walletId, createdAt }
 * No TTL - persists indefinitely
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
    console.error('[STORE-WALLET-METADATA] ❌ Redis client initialization failed:', error.message);
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

  const path = '/api/store-wallet-metadata';
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

  console.log('[STORE-WALLET-METADATA] ✅ HMAC signature validated');
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Lexie-Timestamp, X-Lexie-Signature, Origin, User-Agent');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Only POST requests are supported.' 
    });
  }

  try {
    console.log('[STORE-WALLET-METADATA] 🔍 Request received:', {
      method: req.method,
      hasBody: !!req.body
    });

    // Validate HMAC signature
    validateHmacSignature(req);

    // Validate request body
    if (!req.body) {
      return res.status(400).json({ 
        success: false,
        error: 'No request body received' 
      });
    }

    const { walletAddress, walletId } = req.body;

    // Validate required fields
    if (!walletAddress) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing walletAddress in request body' 
      });
    }

    if (!walletId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing walletId in request body' 
      });
    }

    console.log(`[STORE-WALLET-METADATA] 💾 Storing wallet metadata:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      walletId: walletId?.slice(0, 8) + '...'
    });

    // Initialize Redis client
    const redisClient = initializeRedisClient();
    await redisClient.connect();

    try {
      // Store wallet metadata with no TTL
      const redisKey = `wallet_meta:${walletAddress}`;
      const walletData = {
        walletAddress,
        walletId,
        createdAt: Date.now()
      };

      // Store without expiration (no TTL)
      const result = await redisClient.set(redisKey, JSON.stringify(walletData));

      console.log(`[STORE-WALLET-METADATA] ✅ Stored wallet metadata in Redis:`, {
        key: redisKey,
        result,
        dataSize: JSON.stringify(walletData).length,
        ttl: 'No TTL (persistent)'
      });

      // Verify storage
      const verification = await redisClient.get(redisKey);
      if (!verification) {
        throw new Error('Failed to verify Redis storage');
      }

      console.log(`[STORE-WALLET-METADATA] ✅ Verification successful`);

      await redisClient.quit();

      return res.status(200).json({
        success: true,
        message: 'Wallet metadata stored successfully',
        stored: {
          key: redisKey,
          walletAddress: walletAddress?.slice(0, 8) + '...',
          walletId: walletId?.slice(0, 8) + '...',
          persistent: true
        }
      });

    } catch (redisError) {
      console.error('[STORE-WALLET-METADATA] ❌ Redis operation failed:', redisError);
      await redisClient.quit().catch(() => {});
      
      return res.status(500).json({
        success: false,
        error: 'Failed to store wallet metadata',
        details: redisError.message
      });
    }

  } catch (error) {
    console.error('[STORE-WALLET-METADATA] ❌ Handler error:', error);
    
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