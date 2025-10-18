/**
 * Extracted initializeRailgun function
 * Contains the entire Railgun wallet initialization logic
 */

import { NETWORK_CONFIG } from '@railgun-community/shared-models';
import { getWalletMetadata, storeWalletMetadata, fetchCurrentBlockNumbers } from '../wallet/metadata.js';
import { waitForRailgunReady } from './engine.js';
import { loadProvider } from '@railgun-community/wallet';

export const initializeRailgun = async ({
  isConnected,
  address,
  isInitializing,
  isRailgunInitialized,
  chainId,
  setIsInitializing,
  setIsRailgunInitialized,
  setRailgunAddress,
  setRailgunWalletID,
  setRailgunError,
  setShouldShowLexieIdModal,
  setShowLexieIdChoiceModal,
  setLexieIdChoicePromise,
  setLexieIdLinkPromise,
  setShowReturningUserChainModal,
  setReturningUserChainPromise,
  requestSignatureConfirmation,
  signMessageAsync,
  resetRPCLimiter,
  withRPCRetryLimit,
  getWalletSigner,
  chainIdRef,
  lastInitializedAddressRef,
  targetChainIdRef,
  rpcLimiter,
  connectors
}) => {
  if (!isConnected || !address || isInitializing) {
    console.log('Skipping Railgun init:', { isConnected, address: !!address, isInitializing });
    return;
  }

  // Defensive unload: if this is a fresh init start, clear any lingering SDK wallet state
  try {
    if (!isRailgunInitialized) {
      const { clearAllWallets } = await import('../utils/railgun/wallet');
      await clearAllWallets();
      console.log('[Railgun Init] 🧹 Cleared any lingering wallets before hydration');
    }
  } catch {}

  // Suppression flag for pages that only need public EOA + light engine (e.g., PaymentPage)
  try {
    if (typeof window !== 'undefined' && (window.__LEXIE_SUPPRESS_RAILGUN_INIT || window.__LEXIE_PAYMENT_PAGE)) {
      console.log('[Railgun Init] ⏭️ Suppressed by page flag (__LEXIE_SUPPRESS_RAILGUN_INIT or __LEXIE_PAYMENT_PAGE)');
      return;
    }
  } catch {}

  setIsInitializing(true);
  setRailgunError(null);

  // ✅ REDIS-ONLY: No localStorage keys needed

  // 🚀 REDIS-ONLY: Check Redis for wallet metadata
  let existingSignature = null;
  let existingWalletID = null;
  let existingMnemonic = null;
  let existingRailgunAddress = null;
  let redisWalletData = null;

  try {
    console.log('[WalletContext] 📥 Checking Redis for wallet metadata first...', {
      walletAddress: address?.slice(0, 8) + '...'
    });
    redisWalletData = await getWalletMetadata(address);

    if (redisWalletData) {
      console.log('[WalletContext] ✅ Found wallet metadata in Redis:', {
        walletId: redisWalletData.walletId?.slice(0, 8) + '...',
        railgunAddress: redisWalletData.railgunAddress?.slice(0, 8) + '...',
        walletAddress: redisWalletData.walletAddress?.slice(0, 8) + '...',
        totalKeys: redisWalletData.totalKeys,
        source: 'Redis'
      });
      existingWalletID = redisWalletData.walletId;
      existingRailgunAddress = redisWalletData.railgunAddress;

      // ✅ REDIS SUCCESS: If we have both walletID and railgunAddress from Redis,
      // we can potentially skip wallet creation entirely!
      console.log('[WalletContext] 🎯 Redis provides complete wallet data - will attempt fast hydration');
    } else {
      console.log('[WalletContext] ℹ️ No wallet metadata found in Redis, checking localStorage...');
    }
  } catch (redisError) {
    console.warn('[WalletContext] Redis wallet metadata check failed, falling back to localStorage:', redisError);
  }

  // ✅ REDIS-ONLY: Pure cross-device persistence (no localStorage fallback)
  if (redisWalletData?.crossDeviceReady) {
    console.log('[WalletContext] 🚀 Using COMPLETE wallet data from Redis - true cross-device access!', {
      version: redisWalletData.version,
      hasSignature: !!redisWalletData.signature,
      hasEncryptedMnemonic: !!redisWalletData.encryptedMnemonic,
      source: 'Redis-only'
    });
    existingSignature = redisWalletData.signature;
    existingMnemonic = redisWalletData.encryptedMnemonic;
    existingWalletID = redisWalletData.walletId;
    existingRailgunAddress = redisWalletData.railgunAddress;
  } else if (redisWalletData) {
    console.log('[WalletContext] ⚠️ Found partial Redis data - wallet needs migration to v2.0 format', {
      version: redisWalletData.version,
      hasSignature: !!redisWalletData.signature,
      hasEncryptedMnemonic: !!redisWalletData.encryptedMnemonic
    });
    // Use what we have from Redis, missing data will be recreated
    existingSignature = redisWalletData.signature;
    existingWalletID = redisWalletData.walletId;
    existingRailgunAddress = redisWalletData.railgunAddress;
  } else {
    console.log('[WalletContext] ℹ️ No Redis data found - will create new wallet for cross-device access');
  }

  console.log('[WalletContext] 📊 Wallet data sources (Redis-only architecture):', {
    redisVersion: redisWalletData?.version || 'none',
    crossDeviceReady: redisWalletData?.crossDeviceReady || false,
    walletIdSource: redisWalletData?.walletId ? 'Redis' : 'none',
    signatureSource: redisWalletData?.signature ? 'Redis' : 'none',
    mnemonicSource: redisWalletData?.encryptedMnemonic ? 'Redis' : 'none',
    railgunAddressSource: redisWalletData?.railgunAddress ? 'Redis' : 'none',
    storageStrategy: 'Redis-only (cross-device compatible)',
    needsNewWallet: !redisWalletData?.crossDeviceReady
  });

  // 🛡️ PRIMARY GUARD: Check if wallet already exists and is initialized
  const walletAlreadyInitialized = (walletID, expectedRailgunAddress) => {
    return railgunWalletID === walletID &&
           railgunAddress === expectedRailgunAddress &&
           isRailgunInitialized;
  };

  if (existingWalletID && existingRailgunAddress && walletAlreadyInitialized(existingWalletID, existingRailgunAddress)) {
    console.log(`✅ Railgun wallet already exists for ${address}:`, {
      walletID: existingWalletID.slice(0, 8) + '...',
      railgunAddress: existingRailgunAddress.slice(0, 8) + '...',
      status: 'initialized',
      source: redisWalletData ? 'Redis-verified' : 'localStorage'
    });
    setIsInitializing(false);
    return;
  }

  // 🎯 REDIS FAST PATH: If we have complete data from Redis, try to load directly
  if (existingSignature && existingWalletID && existingRailgunAddress) {
    try {
      console.log('💨 Fast path: Found wallet data in Redis, will load after engine init...', {
        hasSignature: !!existingSignature,
        hasWalletID: !!existingWalletID,
        hasRailgunAddress: !!existingRailgunAddress,
        hasMnemonic: !!existingMnemonic,
        walletIDPreview: existingWalletID.slice(0, 8) + '...',
        railgunAddressPreview: existingRailgunAddress?.slice(0, 8) + '...',
        source: 'Redis-only',
        version: redisWalletData?.version || 'unknown',
        note: existingMnemonic ? 'Complete data - will use fast path' : 'Partial data - will load existing wallet'
      });

      // Import required modules for fast path
      const CryptoJS = await import('crypto-js');
      const railgunWallet = await import('@railgun-community/wallet');
      const {
        startRailgunEngine,
        loadWalletByID,
        setLoggers
      } = railgunWallet;

      // Validate that loadWalletByID is actually a function
      if (typeof loadWalletByID !== 'function') {
        throw new Error(`loadWalletByID is not a function: ${typeof loadWalletByID}. Available functions: ${Object.keys(railgunWallet).filter(k => typeof railgunWallet[k] === 'function').join(', ')}`);
      }

      // Check if engine exists (fallback for older SDK versions)
      let engineExists = false;
      try {
        const { hasEngine } = await import('@railgun-community/wallet');
        if (typeof hasEngine === 'function') {
          engineExists = hasEngine();
        } else {
          console.log('hasEngine is not a function, will attempt engine start');
        }
      } catch (e) {
        console.log('hasEngine not available, will attempt engine start');
      }

      // Derive encryption key from existing signature
      const addressBytes = address.toLowerCase().replace('0x', '');
      const signatureBytes = existingSignature.replace('0x', '');
      const combined = signatureBytes + addressBytes;
      const hash = CryptoJS.SHA256(combined);
      const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

      // Ensure engine is started (minimal setup for fast path)
      if (!engineExists) {
        console.log('🔧 Starting minimal Railgun engine for fast path...');
        const LevelJS = (await import('level-js')).default;
        const db = new LevelJS('railgun-engine-db');

        const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
        const artifactManager = await createEnhancedArtifactStore(false);

        setLoggers(
          (message) => {
            try {
              // Parse simple progress hints like: "Trying to decrypt commitment. Current index 23151/1999"
              const match = /Current index\s+(\d+)\/(\d+)/i.exec(message || '');
              if (match) {
                const current = Number(match[1]);
                const total = Number(match[2]) || 1;
                const percent = Math.max(0, Math.min(100, Math.floor((current / total) * 100)));
                window.dispatchEvent(new CustomEvent('railgun-init-progress', { detail: { current, total, percent, message } }));
              }
            } catch (_) {}
            console.log(`🔍 [RAILGUN-SDK] ${message}`);
          },
          (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
        );

        await startRailgunEngine(
          'lexiewebsite',
          db,
          true,
          artifactManager.store,
          false,
          false,
          ['https://ppoi.fdi.network/'],
          [],
          true
        );

        // Load providers with connected wallet for fast path too
        const networkConfigs = [
          {
            networkName: NETWORK_CONFIG[1].chain.name,
            rpcUrl: 'https://eth.llamarpc.com',
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=ankr',
            chainId: 1
          },
          {
            networkName: NETWORK_CONFIG[137].chain.name,
            rpcUrl: 'https://polygon.llamarpc.com',
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=ankr',
            chainId: 137
          },
          {
            networkName: NETWORK_CONFIG[42161].chain.name,
            rpcUrl: 'https://arbitrum.llamarpc.com',
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=ankr',
            chainId: 42161
          },
          {
            networkName: NETWORK_CONFIG[56].chain.name,
            rpcUrl: 'https://binance.llamarpc.com',
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=ankr',
            chainId: 56
          },
        ];

        for (const { networkName, rpcUrl, ankrUrl, chainId: netChainId } of networkConfigs) {
          try {
            // FIXED: RAILGUN SDK requires string URLs only per official documentation
            // https://docs.railgun.org/developer-guide/wallet/getting-started/4.-add-networks-and-rpc-providers
            console.log(`[RAILGUN] Loading provider for ${networkName} using official SDK format...`);

            // DEBUG: Log exact values being passed to RAILGUN SDK
            console.log(`[RAILGUN-DEBUG] Values for ${networkName}:`, {
              networkName: networkName,
              networkNameType: typeof networkName,
              rpcUrl: rpcUrl,
              rpcUrlType: typeof rpcUrl,
              chainId: netChainId,
              chainIdType: typeof netChainId
            });

            const fallbackProviderConfig = {
              chainId: netChainId,
              providers: [
                {
                  provider: rpcUrl,     // Primary: Alchemy
                  priority: 2,
                  weight: 1,
                  maxLogsPerBatch: 5,
                  stallTimeout: 2500,
                },
                {
                  provider: ankrUrl, // Fallback: Ankr
                  priority: 1,
                  weight: 1,                           // Slightly lower weight for fallback
                  maxLogsPerBatch: 10,                 // Higher batch size for Ankr
                  stallTimeout: 3000,                  // Slightly higher timeout
                }
              ]
            };

            // DEBUG: Log the exact config being passed
            console.log(`[RAILGUN-DEBUG] Config for ${networkName}:`, JSON.stringify(fallbackProviderConfig, null, 2));

            // Wrap loadProvider with retry limit
            await withRPCRetryLimit(
              () => loadProvider(fallbackProviderConfig, networkName, 15000),
              networkName
            );
            console.log(`✅ Provider loaded for ${networkName} using official format`);
          } catch (error) {
            console.warn(`⚠️ Fast path provider load failed for ${networkName}:`, error);
          }
        }

        // Balance callbacks are handled centrally in sdk-callbacks.js

        // 🛑 CRITICAL: Pause providers immediately after loading to prevent wasteful polling
        console.log('⏸️ Pausing RAILGUN providers to prevent RPC polling until wallet connects...');
        const { pauseAllPollingProviders } = await import('@railgun-community/wallet');
        pauseAllPollingProviders(); // Stop polling until user actually needs it
        console.log('✅ RAILGUN providers paused - will resume when needed');
      }

      // 🔑 Load existing wallet using stored walletID (SDK can restore from ID + encryption key)
      console.log('🔑 Loading existing Railgun wallet with stored ID...', {
        walletIDPreview: existingWalletID.slice(0, 8) + '...',
        hasEncryptionKey: !!encryptionKey,
        encryptionKeyLength: encryptionKey?.length,
        walletIDLength: existingWalletID?.length
      });

      // Validate parameters before calling loadWalletByID
      if (!encryptionKey || typeof encryptionKey !== 'string') {
        throw new Error(`Invalid encryptionKey: ${typeof encryptionKey}`);
      }
      if (!existingWalletID || typeof existingWalletID !== 'string') {
        throw new Error(`Invalid existingWalletID: ${typeof existingWalletID}`);
      }

      const railgunWalletInfo = await loadWalletByID(encryptionKey, existingWalletID, false);

      // Verify wallet loaded correctly
      if (!railgunWalletInfo?.id || !railgunWalletInfo?.railgunAddress) {
        throw new Error(`Loaded wallet info is incomplete: ${JSON.stringify({
          hasID: !!railgunWalletInfo?.id,
          hasAddress: !!railgunWalletInfo?.railgunAddress,
          walletInfo: railgunWalletInfo
        })}`);
      }

      // Verify the loaded wallet ID matches what we expected
      if (railgunWalletInfo.id !== existingWalletID) {
        throw new Error(`Wallet ID mismatch: expected ${existingWalletID.slice(0, 8)}, got ${railgunWalletInfo.id?.slice(0, 8)}`);
      }

      // ✅ Store wallet info but DON'T set initialized state yet
      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(railgunWalletInfo.id);
      // setIsRailgunInitialized(true); // ⚠️ REMOVED - will set after modal confirmation

      console.log('✅ Fast path successful - existing wallet loaded:', {
        userAddress: address,
        railgunAddress: railgunWalletInfo.railgunAddress,
        walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
        storage: 'Redis-only'
      });

      // 🎯 FOR EXISTING WALLETS (FAST PATH): Show chain selection modal BEFORE setting initialized
      console.log('[Railgun Init] 🎯 Existing wallet loaded via fast path - showing chain selection modal');
      setShowReturningUserChainModal(true);

      // Create promise that resolves when user makes chain choice (blocks until confirmed)
      const fastPathChainChoicePromise = new Promise((resolve) => {
        setReturningUserChainPromise({ resolve });
      });

      // Wait for user to select/confirm chain (no timeout - user must choose)
      const fastPathChainConfirmed = await fastPathChainChoicePromise;

      // Reset chain modal state
      setShowReturningUserChainModal(false);
      setReturningUserChainPromise(null);

      if (!fastPathChainConfirmed) {
        console.log('[Railgun Init] ❌ User cancelled chain selection for existing wallet (fast path)');
        // Clear wallet state since user cancelled
        setRailgunAddress(null);
        setRailgunWalletID(null);
        setIsInitializing(false);
        return;
      }

      // ✅ NOW set initialized state after user confirmed chain
      setIsRailgunInitialized(true);
      console.log('[Railgun Init] ✅ User confirmed chain selection (fast path), wallet now initialized');

      // Notify UI that wallet metadata is ready for polling (after confirmation)
      try { window.dispatchEvent(new CustomEvent('railgun-wallet-metadata-ready', { detail: { address, walletId: railgunWalletInfo.id } })); } catch {}

      // 🚰 HYDRATION: Check if we need to hydrate IDB with Redis data for this wallet (AFTER modal confirmation)
      try {
        // Skip hydration for master wallet - it's the data source, not consumer
        const { isMasterWallet } = await import('../utils/sync/idb-sync/scheduler.js');
        const { isChainHydrating } = await import('../utils/sync/idb-sync/hydration.js');

        if (isMasterWallet(railgunWalletInfo.id)) {
          console.log('👑 Master wallet detected - skipping hydration for existing wallet (master wallet is the data source)');
        } else {
          // ✅ FIX: Check if chain is already SCANNED first (not just hydrated)
          let alreadyScanned = false;
          try {
            const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
            if (resp.ok) {
              const json = await resp.json();
              const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletInfo.id) || null;
              const scannedChains = metaKey?.scannedChains || [];
              alreadyScanned = scannedChains.includes(chainIdRef.current); // ✅ Use ref
            }
          } catch {}

          // If already scanned, skip bootstrap entirely (bootstrap is only for initial scan speedup)
          if (alreadyScanned) {
            console.log(`🚀 Skipping chain bootstrap - chain ${chainIdRef.current} already scanned via Railgun SDK (fast path)`); // ✅ Use ref
            return; // Exit early - no need to check hydration
          }

          // Check hydration guard: hydratedChains + hydration lock
          const isHydrating = isChainHydrating(railgunWalletInfo.id, chainIdRef.current); // ✅ Use ref

          // Check if chain is already hydrated
          let alreadyHydrated = false;
          try {
            const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
            if (resp.ok) {
              const json = await resp.json();
              const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletInfo.id) || null;
              const hydratedChains = metaKey?.hydratedChains || [];
              alreadyHydrated = hydratedChains.includes(chainIdRef.current); // ✅ Use ref
            }
          } catch {}

          if (alreadyHydrated || isHydrating) {
            console.log(`🚀 Skipping chain bootstrap - chain ${chainIdRef.current} already ${alreadyHydrated ? 'hydrated' : 'hydrating'}`); // ✅ Use ref
          } else {
            console.log('🚀 Checking for chain bootstrap data for existing wallet...');

            // For existing wallets, try to load chain-specific bootstrap data
            const { checkChainBootstrapAvailable, loadChainBootstrap } = await import('../utils/sync/idb-sync/hydration.js');

            const hasBootstrap = await checkChainBootstrapAvailable(chainIdRef.current); // ✅ Use ref
            if (hasBootstrap) {
              console.log(`🚀 Loading chain ${chainIdRef.current} bootstrap for existing wallet...`); // ✅ Use ref

              // Load chain bootstrap data (append mode for existing wallets)
              await loadChainBootstrap(railgunWalletInfo.id, chainIdRef.current, { // ✅ Use ref
                address, // Pass EOA address for Redis scannedChains check
                onProgress: (progress) => {
                  console.log(`🚀 Chain ${chainIdRef.current} bootstrap progress: ${progress}%`); // ✅ Use ref
                  try {
                    window.dispatchEvent(new CustomEvent('chain-bootstrap-progress', {
                      detail: { walletId: railgunWalletInfo.id, chainId: chainIdRef.current, progress } // ✅ Use ref
                    }));
                  } catch {}
                },
                onComplete: async () => {
                  console.log(`🚀 Chain ${chainIdRef.current} bootstrap completed successfully for existing wallet`); // ✅ Use ref

                  // Mark chain as hydrated in Redis metadata since we loaded bootstrap data
                  // Note: scannedChains will only be marked when modal unlocks to prevent premature marking
                  try {
                    const resp = await fetch('/api/wallet-metadata?action=persist-metadata', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        walletAddress: address,
                        walletId: railgunWalletInfo.id,
                        railgunAddress: existingRailgunAddress,
                        hydratedChains: [chainIdRef.current] // ✅ Use ref
                      })
                    });

                    if (resp.ok) {
                      console.log(`✅ Marked hydratedChains += ${chainIdRef.current} after bootstrap loading (scannedChains will be marked on modal unlock)`); // ✅ Use ref

                      // Only emit completion event after successful persistence
                      try {
                        window.dispatchEvent(new CustomEvent('chain-bootstrap-complete', {
                          detail: { walletId: railgunWalletInfo.id, chainId: chainIdRef.current } // ✅ Use ref
                        }));
                      } catch {}
                    } else {
                      console.error(`❌ Failed to mark hydratedChains += ${chainIdRef.current}:`, await resp.text()); // ✅ Use ref
                      // TODO: Show user error - persistence failed
                    }
                  } catch (persistError) {
                    console.warn(`⚠️ Error marking chain ${chainIdRef.current} as hydrated:`, persistError); // ✅ Use ref
                    // TODO: Show user error - persistence failed
                  }
                },
                onError: (error) => {
                  console.error(`🚀 Chain ${chainIdRef.current} bootstrap failed for existing wallet:`, error); // ✅ Use ref
                  try {
                    window.dispatchEvent(new CustomEvent('chain-bootstrap-error', {
                      detail: { walletId: railgunWalletInfo.id, chainId: chainIdRef.current, error: error.message } // ✅ Use ref
                    }));
                  } catch {}
                }
              });
            } else {
              console.log(`ℹ️ No chain ${chainIdRef.current} bootstrap available for existing wallet`); // ✅ Use ref
            }
          }
        }
      } catch (hydrationError) {
        console.warn('🚰 IDB hydration check/init failed (continuing):', hydrationError.message);
      }

      // 🚀 Initialize master wallet exports if this is the master wallet (for existing wallets loaded from Redis)
      try {
        const { startMasterWalletExports, isMasterWallet, getChainForMasterWallet, getMasterExportStatus } = await import('../utils/sync/idb-sync/scheduler.js');

        console.log(`🔍 Checking if loaded wallet is a master wallet (ID: ${railgunWalletInfo.id?.substring(0, 16) || 'undefined'}...)`);

        if (isMasterWallet(railgunWalletInfo.id)) {
          const chainId = getChainForMasterWallet(railgunWalletInfo.id);
          console.log(`🎯 MASTER WALLET DETECTED (Chain ${chainId}) - starting periodic exports to Redis`);

          // Start master exports (will detect chain automatically)
          startMasterWalletExports(railgunWalletInfo.id);

          // Verify it's running
          setTimeout(() => {
            const status = getMasterExportStatus();
            console.log('📊 Master export status after startup:', status);
          }, 1000);
        } else {
          console.log('📱 Regular user wallet loaded from Redis - will hydrate from master data');
        }
      } catch (masterError) {
        console.warn('⚠️ Master wallet export initialization failed for existing wallet:', masterError.message);
      }

      // 🔄 Run initial Merkle-tree scan and balance refresh for CURRENT chain only (prevent infinite polling)
      try {
        const { refreshBalances } = await import('@railgun-community/wallet');
        let railgunChain = null;
        for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
          if (cfg.chain.id === chainIdRef.current) { railgunChain = cfg.chain; break; } // ✅ Use ref
        }
        if (railgunChain) {
          const scanKey = `railgun-initial-scan:${address?.toLowerCase()}:${railgunWalletInfo.id}:${railgunChain.id}`;
          const alreadyScanned = typeof window !== 'undefined' && (window.__RAILGUN_INITIAL_SCAN_DONE?.[railgunChain.id] || localStorage.getItem(scanKey) === '1');
          if (!alreadyScanned) {
            console.log('[Railgun Init] 🔄 Performing initial balance refresh for chain', railgunChain.id);
            // Start UI polling exactly when refresh begins
            try { window.dispatchEvent(new CustomEvent('vault-poll-start', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
            await refreshBalances(railgunChain, [railgunWalletInfo.id]);
            try { window.dispatchEvent(new CustomEvent('vault-poll-complete', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
            if (typeof window !== 'undefined') {
              window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
              window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id] = true;
              try { localStorage.setItem(scanKey, '1'); } catch {}
            }
            // Note: scannedChains will only be marked when modal unlocks to prevent premature marking
            // This ensures that if user refreshes before modal unlocks, scanning will restart
            console.log('[Railgun Init] ✅ Initial scan complete for chain (scannedChains will be marked on modal unlock)', railgunChain.id);
          } else {
            console.log('[Railgun Init] ⏭️ Skipping initial scan (already completed) for chain', railgunChain.id);
          }
        } else {
          console.warn('[Railgun Init] ⚠️ Unable to resolve Railgun chain for initial scan; chainId:', chainIdRef.current);
        }
      } catch (scanError) {
        console.warn('[Railgun Init] ⚠️ Initial balance refresh failed (continuing):', scanError?.message);
      }

      setIsInitializing(false);
      return; // ✨ Exit early - wallet successfully loaded from storage

    } catch (hydrateError) {
      console.error('❌ Fast path failed, falling back to full initialization:', {
        error: hydrateError.message,
        stack: hydrateError.stack,
        errorType: hydrateError.constructor.name,
        walletID: existingWalletID?.slice(0, 8) + '...',
        hasSignature: !!existingSignature,
        hasMnemonic: !!existingMnemonic
      });
    }
  }

  console.log('🚀 Full initialization required...', {
    reason: !existingSignature ? 'No signature' :
            !existingWalletID ? 'No walletID' :
            !existingMnemonic ? 'No mnemonic' : 'Fast path failed'
  });

  // 🚀 Request signature ASAP to avoid UI delay (before engine/provider loading)
  try {
    if (!existingSignature) {
      const signatureMessage = `LexieVault Creation\nAddress: ${address}\n\nSign this message to create your LexieVault.`;

      // Show confirmation popup before early signature request
      const confirmed = await requestSignatureConfirmation(signatureMessage);
      if (!confirmed) {
        throw new Error('Early signature request cancelled by user');
      }

      try {
        window.dispatchEvent(new CustomEvent('railgun-signature-requested', { detail: { address } }));
      } catch (_) {}
      const earlySignature = await signMessageAsync({ message: signatureMessage });
      console.log('✅ Early signature acquired prior to engine init:', address);
      // Persist into flow variables so later steps reuse it and don't prompt again
      existingSignature = earlySignature;
    }
  } catch (earlySigError) {
    console.error('❌ Early signature request failed:', earlySigError);
    throw earlySigError; // Fail init so UI can surface the error cleanly
  }

  try {
    // Import the official Railgun SDK
    const {
      startRailgunEngine,
      loadProvider,
      createRailgunWallet,
      loadWalletByID,
      setLoggers
    } = await import('@railgun-community/wallet');

    console.log('✅ Official Railgun SDK imported');

    // Step 1: Initialize Railgun Engine with official SDK
    const LevelJS = (await import('level-js')).default;
    const db = new LevelJS('railgun-engine-db');

    // Use existing artifact store
    const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
    const artifactManager = await createEnhancedArtifactStore(false);

    // Set up official SDK logging
    setLoggers(
      (message) => {
        try {
          // Parse simple progress hints like: "Trying to decrypt commitment. Current index 23151/1999"
          const match = /Current index\s+(\d+)\/(\d+)/i.exec(message || '');
          if (match) {
            const current = Number(match[1]);
            const total = Number(match[2]) || 1;
            const percent = Math.max(0, Math.min(100, Math.floor((current / total) * 100)));
            window.dispatchEvent(new CustomEvent('railgun-init-progress', { detail: { current, total, percent, message } }));
          }
        } catch (_) {}
        console.log(`🔍 [RAILGUN-SDK] ${message}`);
      },
      (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
    );

    // Start engine with official SDK
    // Signal init starting for UI
    try { window.dispatchEvent(new CustomEvent('railgun-init-started', { detail: { address } })); } catch {}

    await startRailgunEngine(
      'lexiewebsite',
      db,
      true, // shouldDebug
      artifactManager.store,
      false, // useNativeArtifacts (web)
      false, // skipMerkletreeScans
      ['https://ppoi.fdi.network/'], // POI nodes
      [], // customPOILists
      true // verboseScanLogging
    );
    console.log('✅ Railgun engine started with official SDK');

    // 🎯 Initialize IDB sync system AFTER wallet creation is complete
    // This happens much later in the flow when the wallet actually exists

    // Step 2: Load providers using connected wallet's provider when possible
    const networkConfigs = [
      {
        networkName: NETWORK_CONFIG[1].chain.name,
        rpcUrl: 'https://eth.llamarpc.com',
        ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=ankr',
        chainId: 1
      },
      {
        networkName: NETWORK_CONFIG[137].chain.name,
        rpcUrl: 'https://polygon.llamarpc.com',
        ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=ankr',
        chainId: 137
      },
      {
        networkName: NETWORK_CONFIG[42161].chain.name,
        rpcUrl: 'https://arbitrum.llamarpc.com',
        ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=ankr',
        chainId: 42161
      },
      {
        networkName: NETWORK_CONFIG[56].chain.name,
        rpcUrl: 'https://binance.llamarpc.com',
        ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=ankr',
        chainId: 56
      },
    ];

    // Check global rate limiter before loading providers
    resetRPCLimiter();
    if (rpcLimiter.current.isBlocked) {
      console.warn('[RPC-Limiter] 🚫 Global RPC limit reached. Limiting provider loading to current chain only (permanent until disconnect).');
      // Only load provider for current chain when rate limited - this is essential for transactions
      const currentChainConfig = networkConfigs.find(config => config.chainId === chainId);
      if (currentChainConfig) {
        console.log('[RPC-Limiter] ⚡ Loading provider for current chain despite rate limit (essential for transactions)');
        try {
          // FIXED: Use only string URL as per official RAILGUN SDK documentation with Ankr fallback
          const fallbackProviderConfig = {
            chainId: currentChainConfig.chainId,
            providers: [
              {
                provider: currentChainConfig.rpcUrl,  // Primary: Alchemy
                priority: 2,
                weight: 1,
                maxLogsPerBatch: 5,
                stallTimeout: 2500,
              },
              {
                provider: currentChainConfig.ankrUrl, // Fallback: Ankr (proxied)
                priority: 1,
                weight: 1,                           // Slightly lower weight for fallback
                maxLogsPerBatch: 10,                 // Higher batch size for Ankr
                stallTimeout: 3000,                  // Slightly higher timeout
              }
            ]
          };

          // Load provider for current chain only
          await withRPCRetryLimit(
            () => loadProvider(fallbackProviderConfig, currentChainConfig.networkName, 15000),
            currentChainConfig.networkName,
            1 // Reduced retries when rate limited
          );
          console.log(`✅ Provider loaded for current chain ${currentChainConfig.networkName} despite rate limit`);
        } catch (error) {
          console.warn(`⚠️ Failed to load provider for current chain ${currentChainConfig.networkName}:`, error);
        }
      }
    } else {
      for (const { networkName, rpcUrl, ankrUrl, chainId: netChainId } of networkConfigs) {
        try {
          // FIXED: RAILGUN SDK requires string URLs only per official documentation
          // https://docs.railgun.org/developer-guide/wallet/getting-started/4.-add-networks-and-rpc-providers
          console.log(`📡 Loading provider for ${networkName} using official SDK format...`);

          // DEBUG: Log exact values being passed to RAILGUN SDK
          console.log(`[RAILGUN-DEBUG] Full init values for ${networkName}:`, {
            networkName: networkName,
            networkNameType: typeof networkName,
            rpcUrl: rpcUrl,
            rpcUrlType: typeof rpcUrl,
            chainId: netChainId,
            chainIdType: typeof netChainId
          });

          const fallbackProviderConfig = {
            chainId: netChainId,
            providers: [
              {
                provider: rpcUrl,     // Primary: Alchemy
                priority: 2,
                weight: 1,
                maxLogsPerBatch: 5,
                stallTimeout: 2500,
              },
              {
                provider: ankrUrl,    // Fallback: Ankr (proxied)
                priority: 1,
                weight: 1,            // Slightly lower weight for fallback
                maxLogsPerBatch: 10,  // Higher batch size for Ankr
                stallTimeout: 3000,   // Slightly higher timeout
              }
            ]
          };

          // DEBUG: Log the exact config being passed
          console.log(`[RAILGUN-DEBUG] Full init config for ${networkName}:`, JSON.stringify(fallbackProviderConfig, null, 2));

          // Wrap loadProvider with retry limit
          await withRPCRetryLimit(
            () => loadProvider(fallbackProviderConfig, networkName, 15000),
            networkName
          );
          console.log(`✅ Provider loaded for ${networkName} using official SDK format`);
        } catch (error) {
          console.warn(`⚠️ Failed to load provider for ${networkName}:`, error);
        }
      }
    }

    // Step 3: Balance callbacks are handled centrally in sdk-callbacks.js

    // 🛑 CRITICAL: Pause providers after full initialization to prevent wasteful polling
    console.log('⏸️ Pausing RAILGUN providers after full init to prevent RPC polling...');
    const { pauseAllPollingProviders } = await import('@railgun-community/wallet');
    pauseAllPollingProviders(); // Stop polling until user actually needs it
    console.log('✅ RAILGUN providers paused after full init - will resume when needed');

    // Step 4: Wallet creation/loading with official SDK
    const bip39 = await import('bip39');
    const { Mnemonic, randomBytes } = await import('ethers');
    const CryptoJS = await import('crypto-js');

    // Get or create signature for this EOA - Redis-only approach
    let signature = existingSignature; // From Redis

    if (!signature) {
      // First time for this EOA or migration needed - request signature
      const signatureMessage = `LexieVault Creation\nAddress: ${address}\n\nSign this message to create your LexieVault.`;

      // Show confirmation popup before signature request
      const confirmed = await requestSignatureConfirmation(signatureMessage);
      if (!confirmed) {
        throw new Error('Signature request cancelled by user');
      }

      // Notify UI that a signature is being requested
      try {
        window.dispatchEvent(new CustomEvent('railgun-signature-requested', { detail: { address } }));
      } catch (_) {}
      signature = await signMessageAsync({ message: signatureMessage });
      console.log('✅ New signature created for cross-device wallet access:', address);
    } else {
      console.log('✅ Using existing signature from Redis:', address);
    }

    // Derive encryption key from stored signature (always same for same EOA)
    const addressBytes = address.toLowerCase().replace('0x', '');
    const signatureBytes = signature.replace('0x', '');
    const combined = signatureBytes + addressBytes;
    const hash = CryptoJS.SHA256(combined);
    const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

    // User-specific storage (Redis-only approach)
    const savedWalletID = existingWalletID; // From Redis only
    let railgunWalletInfo;

    // Recovery variables for backup restoration
    let recoveredMnemonic = null;
    let recoveredRailgunAddress = null;

    if (savedWalletID && existingRailgunAddress) {
      // Load existing wallet using Redis data
      console.log('👛 Full init: Loading existing Railgun wallet from Redis...', {
        walletID: savedWalletID.slice(0, 8) + '...',
        railgunAddress: existingRailgunAddress.slice(0, 8) + '...',
        userAddress: address,
        source: 'Redis-only',
        version: redisWalletData?.version || 'unknown'
      });

      try {
        // 🛡️ Graceful error handling for invalid/corrupted data
        railgunWalletInfo = await loadWalletByID(encryptionKey, savedWalletID, false);
        console.log('✅ Existing Railgun wallet loaded successfully in full init');
      } catch (loadError) {
        console.warn('⚠️ Failed to load existing wallet - checking for recovery options:', loadError);

        // 🚨 Check if this is a LevelDB data missing error (browser storage cleared)
        const { isLevelDBDataMissingError, attemptWalletRecovery } = await import('../utils/railgun/wallet-backup.js');

        if (isLevelDBDataMissingError(loadError)) {
          console.log('🚨 LevelDB data missing - attempting wallet recovery from backup...');

          try {
            // Attempt to recover wallet from essential backup
            const recoveryData = await attemptWalletRecovery(address, savedWalletID, encryptionKey);

            if (recoveryData) {
              console.log('✅ Wallet recovered from backup - will recreate with recovered data');

              // Set recovered data for wallet creation
              recoveredMnemonic = recoveryData.mnemonic;
              recoveredRailgunAddress = recoveryData.railgunAddress;
              railgunWalletInfo = null; // Force recreation with recovered data
            } else {
              console.warn('❌ Wallet recovery failed - no backup available');
              railgunWalletInfo = null; // Fall back to normal creation
            }
          } catch (recoveryError) {
            console.error('❌ Wallet recovery attempt failed:', recoveryError);
            railgunWalletInfo = null; // Fall back to normal creation
          }
        } else {
          // Regular error - proceed with normal wallet creation
          railgunWalletInfo = null;
        }
      }
    }

    if (!railgunWalletInfo) {
      // 🛡️ Additional guard: Don't create if we already have one in state
      if (railgunWalletID && railgunAddress) {
        console.log('⚠️ Preventing wallet creation - already have wallet in state:', {
          existingWalletID: railgunWalletID.slice(0, 8) + '...',
          existingRailgunAddress: railgunAddress.slice(0, 8) + '...'
        });
        setIsInitializing(false);
        return;
      }

      // 🔄 If railgunWalletID exists but wallet isn't initialized, rehydrate mnemonic first
      if (existingWalletID && !walletAlreadyInitialized(existingWalletID, existingRailgunAddress)) {
        console.log('🔄 WalletID exists but not initialized - will rehydrate from storage:', {
          walletID: existingWalletID.slice(0, 8) + '...',
          railgunAddress: existingRailgunAddress?.slice(0, 8) + '...',
          hasSignature: !!existingSignature,
          hasMnemonic: !!existingMnemonic,
          source: redisWalletData ? 'Redis' : 'localStorage'
        });
      }

      // 🆕 Only create new wallet if we truly don't have one
      console.log('🔑 Creating NEW Railgun wallet (none exists for this EOA)...', {
        userAddress: address,
        reason: !savedWalletID ? 'No stored walletID' : 'Failed to load existing wallet',
        hasStoredData: { signature: !!existingSignature, mnemonic: !!existingMnemonic }
      });

      // 🔄 Check for recovered mnemonic first (from backup recovery)
      let mnemonic = null;

      if (recoveredMnemonic) {
        console.log('🔄 Using recovered mnemonic from backup for wallet recreation');
        mnemonic = recoveredMnemonic;
      } else {
        // 🔄 Check for existing encrypted mnemonic from Redis
        const savedEncryptedMnemonic = existingMnemonic; // From Redis only

        if (savedEncryptedMnemonic) {
          try {
            // 🔓 Attempt to decrypt existing mnemonic from Redis
            console.log('🔓 Decrypting mnemonic from Redis...', {
              hasEncryptedMnemonic: !!savedEncryptedMnemonic,
              source: 'Redis-only',
              version: redisWalletData?.version || 'unknown'
            });

            const decryptedBytes = CryptoJS.AES.decrypt(savedEncryptedMnemonic, encryptionKey);
            const decryptedMnemonic = decryptedBytes.toString(CryptoJS.enc.Utf8);

            // 🛡️ Validate decrypted mnemonic
            if (decryptedMnemonic && bip39.validateMnemonic(decryptedMnemonic)) {
              mnemonic = decryptedMnemonic;
              console.log('✅ Successfully decrypted and validated mnemonic from Redis');
            } else {
              throw new Error('Decrypted mnemonic failed validation');
            }

          } catch (decryptError) {
            console.warn('⚠️ Failed to decrypt Redis mnemonic - will create new wallet:', decryptError);
            // Create new wallet since Redis data is corrupted
          }
        }
      }

      if (!mnemonic) {
        // 🆕 Generate fresh secure mnemonic for Redis storage
        console.log('🆕 Generating new cryptographically secure mnemonic for Redis...');
        mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase.trim();

        if (!bip39.validateMnemonic(mnemonic)) {
          throw new Error('Generated mnemonic failed validation');
        }

        console.log('✅ Generated new secure mnemonic (will be stored in Redis only)');
      }

      // 🏗️ Create wallet with official SDK - Fetch current block numbers for faster initialization
      console.log('🏗️ Fetching current block numbers for wallet creation optimization...');

      const creationBlockNumberMap = await fetchCurrentBlockNumbers();

      console.log('✅ Block numbers fetched for wallet creation:', {
        ethereum: creationBlockNumberMap[NETWORK_CONFIG[1].chain.name],
        polygon: creationBlockNumberMap[NETWORK_CONFIG[137].chain.name],
        arbitrum: creationBlockNumberMap[NETWORK_CONFIG[42161].chain.name],
        bnb: creationBlockNumberMap[NETWORK_CONFIG[56].chain.name]
      });

      try {
        railgunWalletInfo = await createRailgunWallet(
          encryptionKey,
          mnemonic,
          creationBlockNumberMap
        );

        // 🚀 REDIS-ONLY: Store COMPLETE wallet data for true cross-device persistence
        try {
          // Encrypt mnemonic for Redis storage
          const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, encryptionKey).toString();

          const storeSuccess = await storeWalletMetadata(
            address,
            railgunWalletInfo.id,
            railgunWalletInfo.railgunAddress,
            signature,
            encryptedMnemonic, // Store encrypted mnemonic in Redis
            creationBlockNumberMap // Store creation block numbers for faster future loads
          );

          if (storeSuccess) {
            console.log('✅ Stored COMPLETE wallet data to Redis for true cross-device access:', {
              walletId: railgunWalletInfo.id?.slice(0, 8) + '...',
              railgunAddress: railgunWalletInfo.railgunAddress?.slice(0, 8) + '...',
              hasSignature: !!signature,
              hasEncryptedMnemonic: !!encryptedMnemonic,
              redisKey: `railgun:${address}:${railgunWalletInfo.id}`,
              crossDeviceReady: true,
              version: '2.0'
            });

            console.log('🎉 Wallet is now accessible from ANY device/browser!');

            // 🔄 Create essential backup for wallet recovery protection
            try {
              const { backupEssentialWalletData } = await import('../utils/railgun/wallet-backup.js');
              await backupEssentialWalletData(railgunWalletInfo.id, encryptionKey, address);
              console.log('✅ Essential wallet backup created for recovery protection');
            } catch (backupError) {
              console.warn('⚠️ Failed to create essential backup (non-critical):', backupError);
              // Don't fail wallet creation if backup fails
            }

            // DIRECT FLAG: Set flag to show Lexie ID modal
            // NEW: Show Lexie ID choice modal instead of direct Lexie ID modal
            setShowLexieIdChoiceModal(true);

            // Create promise that resolves when user makes choice (blocks until Yes/No clicked)
            const choicePromise = new Promise((resolve) => {
              setLexieIdChoicePromise({ resolve });
            });

            // Wait for user choice (no timeout - user must choose)
            const userWantsLexieId = await choicePromise;

            // Reset choice modal state
            setShowLexieIdChoiceModal(false);
            setLexieIdChoicePromise(null);

            if (userWantsLexieId) {
              console.log('🎮 User chose to claim Lexie ID, showing modal...');
              // Show Lexie ID modal
              setShouldShowLexieIdModal(true);

              // Create promise that resolves when Lexie ID is linked
              const lexieIdPromise = new Promise((resolve) => {
                setLexieIdLinkPromise({ resolve });
              });

              // Wait for handleLexieIdLink to complete
              await lexieIdPromise;

              // Reset Lexie ID promise state
              setLexieIdLinkPromise(null);

              // Now wait 5 seconds for game to load before starting bootstrap
              console.log('⏳ Lexie ID linked, waiting 5 seconds for game to load...');
              await new Promise(resolve => setTimeout(resolve, 5000));
              console.log('✅ Game loading period complete, proceeding to bootstrap...');

            } else {
              console.log('⏭️ User declined Lexie ID, proceeding immediately to bootstrap...');
            }
          } else {
            console.warn('⚠️ Redis storage failed - wallet will only work on this device');
          }
        } catch (redisError) {
          console.warn('⚠️ Failed to store wallet metadata to Redis (non-critical):', redisError);
        }

        console.log('✅ Created and saved new Railgun wallet:', {
          userAddress: address,
          walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
          railgunAddress: railgunWalletInfo.railgunAddress?.slice(0, 8) + '...',
          storage: 'Redis-only',
          crossDevice: true
        });

        // 🚰 HYDRATION: Check if newly created wallet needs hydration (edge case)
        // Skip hydration for master wallet - it's the data source, not consumer
        const { isMasterWallet } = await import('../utils/sync/idb-sync/scheduler.js');
        const { isChainHydrating } = await import('../utils/sync/idb-sync/hydration.js');

        if (isMasterWallet(railgunWalletInfo.id)) {
          console.log('👑 Master wallet detected - skipping hydration for new wallet (master wallet is the data source)');
        } else {
          // Check hydration guard: hydratedChains + hydration lock
          const isHydrating = isChainHydrating(railgunWalletInfo.id, chainIdRef.current); // ✅ Use ref

          // For new wallets, hydratedChains should be empty, but double-check
          let alreadyHydrated = false;
          try {
            const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
            if (resp.ok) {
              const json = await resp.json();
              const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletInfo.id) || null;
              const hydratedChains = metaKey?.hydratedChains || [];
              alreadyHydrated = hydratedChains.includes(chainIdRef.current); // ✅ Use ref
            }
          } catch {}

        }
      } catch (createError) {
        console.error('❌ Failed to create Railgun wallet:', createError);
        throw new Error(`Railgun wallet creation failed: ${createError.message}`);
      }
    }

    // 🎯 Check if this is a returning user (existing wallet loaded, not created)
    const isReturningUser = savedWalletID && existingRailgunAddress;

    // Store wallet info but DON'T set initialized state yet
    setRailgunAddress(railgunWalletInfo.railgunAddress);
    setRailgunWalletID(railgunWalletInfo.id);
    // setIsRailgunInitialized(true); // ⚠️ REMOVED - will set after modal confirmation

    console.log('✅ Wallet state updated - all data persisted in Redis for cross-device access');

    // 🎯 FOR RETURNING USERS (FULL PATH): Show chain selection modal BEFORE setting initialized
    if (isReturningUser) {
      console.log('[Railgun Init] 🎯 Returning user detected in full path - showing chain selection modal');
      setShowReturningUserChainModal(true);

      // Create promise that resolves when user makes chain choice (blocks until confirmed)
      const fullPathChainChoicePromise = new Promise((resolve) => {
        setReturningUserChainPromise({ resolve });
      });

      // Wait for user to select/confirm chain (no timeout - user must choose)
      const fullPathChainConfirmed = await fullPathChainChoicePromise;

      // Reset chain modal state
      setShowReturningUserChainModal(false);
      setReturningUserChainPromise(null);

      if (!fullPathChainConfirmed) {
        console.log('[Railgun Init] ❌ User cancelled chain selection for returning user (full path)');
        // Clear wallet state since user cancelled
        setRailgunAddress(null);
        setRailgunWalletID(null);
        setIsInitializing(false);
        return;
      }

      console.log('[Railgun Init] ✅ User confirmed chain selection (full path), proceeding with vault initialization');
    }

    // ✅ NOW set initialized state after modal confirmation (or immediately for new users)
    setIsRailgunInitialized(true);
    console.log('[Railgun Init] ✅ Wallet initialized after chain confirmation');
    // Notify UI that metadata is persisted; polling may begin
    try { window.dispatchEvent(new CustomEvent('railgun-wallet-metadata-ready', { detail: { address, walletId: railgunWalletInfo.id } })); } catch {}

    // 🎯 Initialize IDB sync system BEFORE scanning starts so it can capture all events
    setTimeout(async () => {
      // Use the actual wallet ID that was just created
      const walletId = railgunWalletInfo.id;

      try {
        console.log('🔄 Initializing IDB sync system before scanning begins...');

        // Import the sync module
        const { initializeSyncSystem } = await import('../utils/sync/idb-sync/index.js');

        if (walletId) {
          await initializeSyncSystem(walletId);
          console.log('✅ IDB sync system initialized and ready to capture scan events');
        } else {
          console.warn('⚠️ No wallet ID available for sync system');
        }

      } catch (syncError) {
        console.info('ℹ️ IDB sync system initialization failed (optional feature):', syncError.message);
        console.info('ℹ️ Railgun wallet functionality remains fully operational');
      }

      // 🚀 Initialize master wallet exports if this is the master wallet
      try {
        const { startMasterWalletExports, isMasterWallet, getChainForMasterWallet, getMasterExportStatus } = await import('../utils/sync/idb-sync/scheduler.js');

        console.log(`🔍 Checking if this is master wallet (ID: ${walletId?.substring(0, 16) || 'undefined'}...)`);

        if (isMasterWallet(walletId)) {
          const chainId = getChainForMasterWallet(walletId);
          console.log(`🎯 MASTER WALLET DETECTED (Chain ${chainId}) - starting periodic exports to Redis`);

          // Start master exports (will detect chain automatically)
          startMasterWalletExports(walletId);

          // Verify it's running
          setTimeout(() => {
            const status = getMasterExportStatus();
            console.log('📊 Master export status after startup:', status);
          }, 1000);
        } else {
          console.log('📱 Regular user wallet - will hydrate from master data');
        }
      } catch (masterError) {
        console.warn('⚠️ Master wallet export initialization failed:', masterError.message);
      }
    }, 1000); // Short delay to ensure everything is stable

    // 🔄 Run initial Merkle-tree scan and balance refresh for CURRENT chain only (prevent infinite polling)
    try {
      const { refreshBalances } = await import('@railgun-community/wallet');
      let railgunChain = null;
      for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
        if (cfg.chain.id === chainIdRef.current) { railgunChain = cfg.chain; break; } // ✅ Use ref
      }
      if (railgunChain) {
        const scanKey = `railgun-initial-scan:${address?.toLowerCase()}:${railgunWalletInfo.id}:${railgunChain.id}`;
        const alreadyScanned = typeof window !== 'undefined' && (window.__RAILGUN_INITIAL_SCAN_DONE?.[railgunChain.id] || localStorage.getItem(scanKey) === '1');
        if (!alreadyScanned) {
          console.log('[Railgun Init] 🔄 Performing initial balance refresh for chain', railgunChain.id);
          // Start UI polling exactly when refresh begins
          try { window.dispatchEvent(new CustomEvent('vault-poll-start', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
          await refreshBalances(railgunChain, [railgunWalletInfo.id]);
          try { window.dispatchEvent(new CustomEvent('vault-poll-complete', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
          if (typeof window !== 'undefined') {
            window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
            window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id] = true;
            try { localStorage.setItem(scanKey, '1'); } catch {}
          }
          // Note: scannedChains will only be marked when modal unlocks to prevent premature marking
          // This ensures that if user refreshes before modal unlocks, scanning will restart
          console.log('[Railgun Init] ✅ Initial scan complete for chain (scannedChains will be marked on modal unlock)', railgunChain.id);
        } else {
          console.log('[Railgun Init] ⏭️ Skipping initial scan (already completed) for chain', railgunChain.id);
        }
      } else {
        console.warn('[Railgun Init] ⚠️ Unable to resolve Railgun chain for initial scan; chainId:', chainIdRef.current);
      }
    } catch (scanError) {
      console.warn('[Railgun Init] ⚠️ Initial balance refresh failed (continuing):', scanError?.message);
    }

    console.log('🎉 Railgun initialization completed with official SDK:', {
      userAddress: address,
      railgunAddress: railgunWalletInfo.railgunAddress,
      walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
      storage: 'Redis-only',
      crossDevice: true
    });

    // Force unlock modal when Railgun initialization completes
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('railgun-init-force-unlock', {
        detail: {
          userAddress: address,
          railgunAddress: railgunWalletInfo.railgunAddress,
          walletID: railgunWalletInfo.id
        }
      }));
    }

    // Signal init completed for UI with 100%
    try { window.dispatchEvent(new CustomEvent('railgun-init-completed', { detail: { address } })); } catch {}

    // 🎯 FIXED: Don't auto-resume polling after init - let useBalances hook control when to poll
    console.log('⏸️ Providers remain paused after init - will resume only when balance refresh needed');

    return; // Successfully completed initialization
  } catch (error) {
    console.error('❌ Railgun initialization failed:', error);
    setRailgunError(error.message || 'Failed to initialize Railgun');
    setIsRailgunInitialized(false);
    setRailgunAddress(null);
    setRailgunWalletID(null);
    try { window.dispatchEvent(new CustomEvent('railgun-init-failed', { detail: { error: error?.message || String(error) } })); } catch {}
  } finally {
    setIsInitializing(false);
  }
};
