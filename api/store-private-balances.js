/**
 * Vercel Serverless Function - Store Private Balance Data in Redis
 * Key: private_balances:<walletId>-<chainId>
 * Value: { updatedAt, balances: [...] }
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
    console.error('[STORE-PRIVATE-BALANCES] ❌ Redis client initialization failed:', error.message);
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

  const path = '/api/store-private-balances';
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

  console.log('[STORE-PRIVATE-BALANCES] ✅ HMAC signature validated');
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
    console.log('[STORE-PRIVATE-BALANCES] 🔍 Request received:', {
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

    const { walletId, chainId, balances } = req.body;

    // Validate required fields
    if (!walletId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing walletId in request body' 
      });
    }

    if (!chainId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing chainId in request body' 
      });
    }

    if (!Array.isArray(balances)) {
      return res.status(400).json({ 
        success: false,
        error: 'balances must be an array' 
      });
    }

    // Filter to only store balances with numericBalance > 0
    const filteredBalances = balances.filter(balance => 
      balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
    );

    console.log(`[STORE-PRIVATE-BALANCES] 💾 Storing private balance data:`, {
      walletId: walletId?.slice(0, 8) + '...',
      chainId,
      totalBalances: balances.length,
      filteredBalances: filteredBalances.length
    });

    // Initialize Redis client
    const redisClient = initializeRedisClient();
    await redisClient.connect();

    try {
      // Store private balance data with proper key format
      const redisKey = `private_balances:${walletId}-${chainId}`;
      const balanceData = {
        updatedAt: Date.now(),
        balances: filteredBalances.map(balance => ({
          symbol: balance.symbol,
          tokenAddress: balance.tokenAddress || balance.address,
          formattedBalance: balance.formattedBalance,
          numericBalance: balance.numericBalance,
          decimals: balance.decimals,
          chainId: balance.chainId || chainId,
          name: balance.name
        }))
      };

      // Store without expiration (no TTL)
      const result = await redisClient.set(redisKey, JSON.stringify(balanceData));

      console.log(`[STORE-PRIVATE-BALANCES] ✅ Stored private balance data in Redis:`, {
        key: redisKey,
        result,
        balanceCount: balanceData.balances.length,
        ttl: 'No TTL (persistent)',
        dataSize: JSON.stringify(balanceData).length
      });

      // Verify storage
      const verification = await redisClient.get(redisKey);
      if (!verification) {
        throw new Error('Failed to verify Redis storage');
      }

      console.log(`[STORE-PRIVATE-BALANCES] ✅ Verification successful`);

      await redisClient.quit();

      return res.status(200).json({
        success: true,
        message: 'Private balance data stored successfully',
        stored: {
          key: redisKey,
          walletId: walletId?.slice(0, 8) + '...',
          chainId,
          balanceCount: balanceData.balances.length,
          persistent: true
        }
      });

    } catch (redisError) {
      console.error('[STORE-PRIVATE-BALANCES] ❌ Redis operation failed:', redisError);
      await redisClient.quit().catch(() => {});
      
      return res.status(500).json({
        success: false,
        error: 'Failed to store private balance data',
        details: redisError.message
      });
    }

  } catch (error) {
    console.error('[STORE-PRIVATE-BALANCES] ❌ Handler error:', error);
    
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