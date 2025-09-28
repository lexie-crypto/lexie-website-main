/**
 * Migration Script: LevelDB to Redis
 * Migrates existing artifacts from localforage to Redis backend
 */

export const migrateArtifactsToRedis = async () => {
  console.log('🚀 [MIGRATION] Starting artifact migration from LevelDB to Redis...');

  try {
    // Check if Redis store is available
    const { createRedisArtifactStore } = await import('./artifactStoreRedis.js');
    const redisStore = createRedisArtifactStore();

    // Get legacy localforage store
    const localforage = (await import('localforage')).default;
    const legacyStorage = localforage.createInstance({
      name: 'RailgunArtifacts',
      storeName: 'artifacts',
    });

    // Get all keys from legacy storage
    const allKeys = await legacyStorage.keys();
    console.log(`📋 [MIGRATION] Found ${allKeys.length} artifacts to migrate`);

    if (allKeys.length === 0) {
      console.log('ℹ️ [MIGRATION] No artifacts to migrate');
      return { migrated: 0, skipped: 0, errors: 0 };
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    // Migrate each artifact
    for (const key of allKeys) {
      try {
        // Check if already exists in Redis
        const existsInRedis = await redisStore.exists(key);
        if (existsInRedis) {
          console.log(`⏭️ [MIGRATION] Skipping ${key} (already in Redis)`);
          skipped++;
          continue;
        }

        // Get data from legacy storage
        const data = await legacyStorage.getItem(key);
        if (!data) {
          console.warn(`⚠️ [MIGRATION] No data found for ${key}`);
          continue;
        }

        // Store in Redis
        await redisStore.store('', key, data);
        console.log(`✅ [MIGRATION] Migrated ${key} (${data.length || data.byteLength || 0} bytes)`);
        migrated++;

      } catch (error) {
        console.error(`❌ [MIGRATION] Failed to migrate ${key}:`, error.message);
        errors++;
      }
    }

    console.log(`🎉 [MIGRATION] Migration complete!`);
    console.log(`📊 Migrated: ${migrated} artifacts`);
    console.log(`⏭️ Skipped: ${skipped} artifacts`);
    console.log(`❌ Errors: ${errors} artifacts`);

    return { migrated, skipped, errors };

  } catch (error) {
    console.error('❌ [MIGRATION] Migration failed:', error);
    throw error;
  }
};

/**
 * Health check to verify Redis migration
 */
export const verifyRedisMigration = async () => {
  console.log('🔍 [VERIFICATION] Verifying Redis artifact store...');

  try {
    const { createEnhancedRedisArtifactStore } = await import('./artifactStoreRedis.js');
    const store = createEnhancedRedisArtifactStore();

    // Check health
    const health = await store.checkHealth();
    console.log('🏥 [VERIFICATION] Redis health:', health);

    // Test common artifacts
    const testVariants = ['02x02', '08x02'];
    for (const variant of testVariants) {
      const hasArtifacts = await store.hasArtifacts(variant);
      console.log(`📦 [VERIFICATION] ${variant}: ${hasArtifacts ? '✅ Available' : '❌ Missing'}`);
    }

    return health;

  } catch (error) {
    console.error('❌ [VERIFICATION] Verification failed:', error);
    throw error;
  }
};

/**
 * Clear local artifacts after successful migration
 */
export const cleanupLocalArtifacts = async () => {
  console.log('🧹 [CLEANUP] Cleaning up local artifacts after migration...');

  try {
    const localforage = (await import('localforage')).default;
    const legacyStorage = localforage.createInstance({
      name: 'RailgunArtifacts',
      storeName: 'artifacts',
    });

    // Clear all data
    await legacyStorage.clear();
    console.log('✅ [CLEANUP] Local artifacts cleared');

    // Drop the database
    await legacyStorage.dropInstance();
    console.log('✅ [CLEANUP] Local database dropped');

  } catch (error) {
    console.error('❌ [CLEANUP] Cleanup failed:', error);
    throw error;
  }
};

// Auto-run migration if this script is executed directly in browser
if (typeof window !== 'undefined' && window.location) {
  // Only run in development or when explicitly requested
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('migrate') === 'artifacts') {
    console.log('🔄 [AUTO-MIGRATION] Starting automatic artifact migration...');

    migrateArtifactsToRedis()
      .then(async (result) => {
        console.log('✅ [AUTO-MIGRATION] Migration successful:', result);

        // Verify migration
        await verifyRedisMigration();

        // Ask user if they want to cleanup
        if (confirm('Migration successful! Clear local artifacts?')) {
          await cleanupLocalArtifacts();
          alert('Migration complete! Local artifacts cleaned up.');
        } else {
          alert('Migration complete! You can manually clear local artifacts later.');
        }
      })
      .catch((error) => {
        console.error('❌ [AUTO-MIGRATION] Migration failed:', error);
        alert('Migration failed. Check console for details.');
      });
  }
}

export default {
  migrateArtifactsToRedis,
  verifyRedisMigration,
  cleanupLocalArtifacts
};
