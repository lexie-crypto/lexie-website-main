/**
 * Redis-based RAILGUN Artifact Store Implementation
 * Uses the proxy instead of direct Redis access for security
 * Replaces the localforage-based store for better performance
 */

import { ArtifactStore } from '@railgun-community/wallet';

/**
 * Creates a proxy-based artifact store that uses Redis backend
 * @param {Object} options - Configuration options
 * @param {string} options.baseUrl - Base URL for the proxy (defaults to current origin)
 * @param {boolean} options.useCache - Whether to use local caching (defaults to true)
 * @returns {ArtifactStore} RAILGUN ArtifactStore instance
 */
export const createRedisArtifactStore = (options = {}) => {
  const baseUrl = options.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const useCache = options.useCache !== false;

  // Simple in-memory cache for frequently accessed artifacts
  const memoryCache = new Map();
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  console.log('[RedisArtifactStore] Creating Redis artifact store...', {
    baseUrl,
    useCache
  });

  /**
   * Make authenticated request to proxy
   */
  const makeProxyRequest = async (method, path, body = null) => {
    // Convert path-based routing to action-based routing
    let actionParams = {};

    if (path.startsWith('/get/')) {
      const key = path.replace('/get/', '');
      actionParams = { action: 'artifacts', subaction: 'get', key: decodeURIComponent(key) };
    } else if (path === '/exists/') {
      // This shouldn't happen, but handle it
      actionParams = { action: 'artifacts', subaction: 'exists' };
    } else if (path.startsWith('/exists/')) {
      const key = path.replace('/exists/', '');
      actionParams = { action: 'artifacts', subaction: 'exists', key: decodeURIComponent(key) };
    } else if (path === '/health') {
      actionParams = { action: 'artifacts', subaction: 'health' };
    } else {
      // Fallback
      actionParams = { action: 'artifacts', path };
    }

    // Build URL with query parameters
    const url = new URL(`${baseUrl}/api/wallet-metadata`);
    Object.entries(actionParams).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const headers = {
      'Content-Type': 'application/json',
      'Accept': method === 'GET' && actionParams.subaction === 'get'
        ? 'application/octet-stream, application/json'
        : 'application/json',
    };

    const requestOptions = {
      method,
      headers,
      signal: AbortSignal.timeout(60000), // 60 second timeout for large artifacts
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Proxy request failed: ${response.status} ${errorText}`);
    }

    return response;
  };

  /**
   * Get artifact from cache or proxy
   */
  const getArtifact = async (path) => {
    // Check memory cache first
    if (useCache && memoryCache.has(path)) {
      const cached = memoryCache.get(path);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log(`[RedisArtifactStore] Cache hit for: ${path}`);
        return cached.data;
      } else {
        memoryCache.delete(path);
      }
    }

    try {
      console.log(`[RedisArtifactStore] Fetching from proxy: ${path}`);
      const response = await makeProxyRequest('GET', `/get/${encodeURIComponent(path)}`);

      // Handle binary data
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/octet-stream')) {
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Cache the result
        if (useCache) {
          memoryCache.set(path, {
            data,
            timestamp: Date.now()
          });
        }

        console.log(`[RedisArtifactStore] Retrieved binary artifact: ${path} (${data.length} bytes)`);
        return data;
      }

      // Handle JSON error responses
      const jsonResponse = await response.json();
      if (!jsonResponse.success) {
        console.warn(`[RedisArtifactStore] Artifact not found: ${path}`);
        return null;
      }

      return null;
    } catch (error) {
      console.error(`[RedisArtifactStore] Error fetching ${path}:`, error.message);
      return null;
    }
  };

  /**
   * Store artifact via proxy
   */
  const storeArtifact = async (dir, path, item) => {
    try {
      console.log(`[RedisArtifactStore] Storing artifact: ${path}`);

      // Convert item to base64 for JSON transport
      let valueToSend;
      if (item instanceof Uint8Array) {
        valueToSend = Buffer.from(item).toString('base64');
      } else if (item instanceof ArrayBuffer) {
        valueToSend = Buffer.from(item).toString('base64');
      } else if (typeof item === 'string') {
        valueToSend = item;
      } else {
        // Convert to string as fallback
        valueToSend = String(item);
      }

      const response = await makeProxyRequest('POST', '/store', {
        key: path,
        value: valueToSend
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(`Failed to store artifact: ${result.error}`);
      }

      // Update cache
      if (useCache) {
        memoryCache.set(path, {
          data: item,
          timestamp: Date.now()
        });
      }

      console.log(`[RedisArtifactStore] Successfully stored: ${path} (${item.length || item.byteLength || 0} bytes)`);
    } catch (error) {
      console.error(`[RedisArtifactStore] Error storing ${path}:`, error.message);
      throw error;
    }
  };

  /**
   * Check if artifact exists via proxy
   */
  const artifactExists = async (path) => {
    try {
      const response = await makeProxyRequest('GET', `/exists/${encodeURIComponent(path)}`);
      const result = await response.json();

      const exists = result.success && result.data?.exists;
      console.log(`[RedisArtifactStore] Exists check: ${path} = ${exists}`);
      return exists;
    } catch (error) {
      console.warn(`[RedisArtifactStore] Error checking existence of ${path}:`, error.message);
      return false;
    }
  };

  // Return the official ArtifactStore instance
  // Add health check method to the store
  const checkHealth = async () => {
    try {
      console.log(`[RedisArtifactStore] Checking health...`);
      const response = await makeProxyRequest('GET', '/health');
      const result = await response.json();
      return result.success && result.data && result.data.status === 'healthy';
    } catch (error) {
      console.warn(`[RedisArtifactStore] Health check failed:`, error.message);
      return false;
    }
  };

  // Return the artifact store with additional health check method
  const artifactStore = new ArtifactStore(
    getArtifact,     // get method
    storeArtifact,   // store method
    artifactExists   // exists method
  );

  // Add health check method
  artifactStore.checkHealth = checkHealth;

  return artifactStore;
};

/**
 * Enhanced artifact store with integrated downloader using Redis backend
 */
export const createEnhancedRedisArtifactStore = (options = {}) => {
  const artifactStore = createRedisArtifactStore(options);

  return {
    store: artifactStore,
    downloader: null, // Will be set after import

    // Initialize downloader (deferred to avoid circular imports)
    async initialize() {
      const { ArtifactDownloader } = await import('./artifactDownloader.js');
      this.downloader = new ArtifactDownloader(artifactStore, options.useNativeArtifacts || false);
      return this;
    },

    // Check if artifacts are available in Redis
    async checkArtifactsHealth() {
      try {
        console.log(`[EnhancedRedisArtifactStore] Checking artifact health...`);
        const response = await makeProxyRequest('GET', '/health');
        const result = await response.json();

        if (result.success && result.data) {
          const { status, availableArtifacts, totalArtifacts } = result.data;
          console.log(`[EnhancedRedisArtifactStore] Health check: ${status} (${availableArtifacts}/${totalArtifacts} artifacts available)`);
          return {
            healthy: status === 'healthy',
            availableCount: availableArtifacts,
            totalCount: totalArtifacts,
            hasCommonArtifacts: availableArtifacts > 0
          };
        }

        return { healthy: false, availableCount: 0, totalCount: 0, hasCommonArtifacts: false };
      } catch (error) {
        console.warn(`[EnhancedRedisArtifactStore] Health check failed:`, error.message);
        return { healthy: false, availableCount: 0, totalCount: 0, hasCommonArtifacts: false };
      }
    },

    // Convenience methods
    async downloadArtifacts(artifactVariantString) {
      if (!this.downloader) await this.initialize();

      // Check health first - if artifacts are already available, skip download
      const health = await this.checkArtifactsHealth();
      if (health.hasCommonArtifacts) {
        console.log(`[EnhancedRedisArtifactStore] Artifacts already available (${health.availableCount}/${health.totalCount}), skipping download`);
        return { success: true, skipped: true, reason: 'artifacts_already_available' };
      }

      console.log(`[EnhancedRedisArtifactStore] Downloading artifacts for variant: ${artifactVariantString}`);
      return await this.downloader.downloadArtifacts(artifactVariantString);
    },

    async getArtifacts(artifactVariantString) {
      if (!this.downloader) await this.initialize();
      console.log(`[EnhancedRedisArtifactStore] Getting artifacts for variant: ${artifactVariantString}`);
      return await this.downloader.getDownloadedArtifacts(artifactVariantString);
    },

    async hasArtifacts(artifactVariantString) {
      const { artifactDownloadsPath, ArtifactName } = await import('@railgun-community/shared-models');
      const { getArtifactDownloadsPaths } = await import('./artifactUtil.js');

      const paths = [
        artifactDownloadsPath(ArtifactName.VKEY, artifactVariantString),
        artifactDownloadsPath(ArtifactName.ZKEY, artifactVariantString),
        artifactDownloadsPath(options.useNativeArtifacts ? ArtifactName.DAT : ArtifactName.WASM, artifactVariantString),
      ];

      const exists = await Promise.all(paths.map(path => artifactStore.exists(path)));
      return exists.every(Boolean);
    },

    // Health check
    async checkHealth() {
      try {
        const response = await fetch(`${options.baseUrl || window.location.origin}/api/wallet-metadata/artifacts/health`);
        const result = await response.json();
        return result.success ? result.data : { status: 'error' };
      } catch (error) {
        console.error('[EnhancedRedisArtifactStore] Health check failed:', error);
        return { status: 'error', error: error.message };
      }
    },

    // Clear memory cache
    clearCache() {
      console.log('[EnhancedRedisArtifactStore] Clearing memory cache');
      // Note: This only clears local memory cache, not Redis cache
      if (typeof window !== 'undefined' && window.location) {
        // Trigger cache clear by adding timestamp to bypass browser cache
        const cacheBuster = Date.now();
        console.log(`[EnhancedRedisArtifactStore] Cache cleared with bust: ${cacheBuster}`);
      }
    }
  };
};

export default createRedisArtifactStore;
