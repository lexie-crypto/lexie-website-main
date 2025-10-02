/**
 * Official Railgun SDK Callbacks Integration
 * Implements official callback system to ensure proper balance sync and spendable note confirmation
 */

// Global state for tracking spendable note availability
const spendableNotesState = new Map(); // walletId -> { tokenAddress -> { isSpendable: bool, amount: bigint, lastUpdate: timestamp } }
const merkleTreeScanState = new Map(); // walletId -> { utxoProgress: number, txidProgress: number, isComplete: bool }

/**
 * Track spendable note state for proof generation blocking
 * @param {string} walletId - Railgun wallet ID
 * @param {string} tokenAddress - Token address (lowercase)
 * @param {bigint} amount - Required amount
 * @returns {boolean} Whether spendable notes are available
 */
export const areSpendableNotesReady = (walletId, tokenAddress, amount) => {
  const walletState = spendableNotesState.get(walletId);
  if (!walletState) {
    console.log('[SDK Callbacks] 🔍 No wallet state found for spendable check:', {
      walletId: walletId?.slice(0, 8) + '...',
      hasState: false
    });
    return false;
  }
  
  const tokenState = walletState[tokenAddress?.toLowerCase()];
  if (!tokenState) {
    console.log('[SDK Callbacks] 🔍 No token state found for spendable check:', {
      walletId: walletId?.slice(0, 8) + '...',
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      hasTokenState: false,
      availableTokens: Object.keys(walletState).map(addr => addr.slice(0, 10) + '...')
    });
    return false;
  }
  
  const isReady = tokenState.isSpendable && tokenState.amount >= BigInt(amount);
  
  console.log('[SDK Callbacks] 🎯 Spendable notes readiness check:', {
    walletId: walletId?.slice(0, 8) + '...',
    tokenAddress: tokenAddress?.slice(0, 10) + '...',
    required: amount.toString(),
    available: tokenState.amount.toString(),
    isSpendable: tokenState.isSpendable,
    isReady,
    lastUpdate: tokenState.lastUpdate
  });
  
  return isReady;
};

/**
 * Wait for spendable notes to become available
 * @param {string} walletId - Railgun wallet ID
 * @param {string} tokenAddress - Token address
 * @param {bigint} amount - Required amount
 * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
 * @returns {Promise<boolean>} Whether notes became spendable within timeout
 */
export const waitForSpendableNotes = (walletId, tokenAddress, amount, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // Check immediately
    if (areSpendableNotesReady(walletId, tokenAddress, amount)) {
      console.log('[SDK Callbacks] ✅ Spendable notes already ready');
      resolve(true);
      return;
    }
    
    console.log('[SDK Callbacks] ⏳ Waiting for spendable notes...', {
      walletId: walletId?.slice(0, 8) + '...',
      tokenAddress: tokenAddress?.slice(0, 10) + '...',
      amount: amount.toString(),
      timeout: `${timeoutMs}ms`
    });
    
    // Set up listener for balance updates
    const handleBalanceUpdate = (event) => {
      const balanceEvent = event.detail;
      
      // Only check updates for our wallet
      if (balanceEvent.railgunWalletID === walletId) {
        console.log('[SDK Callbacks] 📡 Balance update received during wait:', {
          walletId: walletId?.slice(0, 8) + '...',
          bucket: balanceEvent.balanceBucket,
          tokenCount: balanceEvent.erc20Amounts?.length || 0
        });
        
        // Check if our token is now spendable
        if (areSpendableNotesReady(walletId, tokenAddress, amount)) {
          console.log('[SDK Callbacks] 🎉 Spendable notes became ready during wait!');
          window.removeEventListener('railgun-balance-update', handleBalanceUpdate);
          resolve(true);
        }
      }
    };
    
    // Listen for balance updates
    window.addEventListener('railgun-balance-update', handleBalanceUpdate);
    
    // Set timeout
    setTimeout(() => {
      window.removeEventListener('railgun-balance-update', handleBalanceUpdate);
      const elapsed = Date.now() - startTime;
      console.warn('[SDK Callbacks] ⏰ Timeout waiting for spendable notes:', {
        walletId: walletId?.slice(0, 8) + '...',
        tokenAddress: tokenAddress?.slice(0, 10) + '...',
        amount: amount.toString(),
        elapsed: `${elapsed}ms`,
        stillWaiting: !areSpendableNotesReady(walletId, tokenAddress, amount)
      });
      resolve(false);
    }, timeoutMs);
  });
};

/**
 * Check if Merkle tree scans are complete for a wallet
 * @param {string} walletId - Railgun wallet ID
 * @returns {boolean} Whether both UTXO and TXID scans are complete
 */
export const areMerkleScansComplete = (walletId) => {
  const scanState = merkleTreeScanState.get(walletId);
  if (!scanState) return false;
  
  const isComplete = scanState.utxoProgress >= 1.0 && scanState.txidProgress >= 1.0;
  
  console.log('[SDK Callbacks] 🔍 Merkle scan completeness check:', {
    walletId: walletId?.slice(0, 8) + '...',
    utxoProgress: scanState.utxoProgress,
    txidProgress: scanState.txidProgress,
    isComplete
  });
  
  return isComplete;
};

/**
 * Wait for Merkle tree scans to complete
 * @param {string} walletId - Railgun wallet ID
 * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
 * @returns {Promise<boolean>} Whether scans completed within timeout
 */
export const waitForMerkleScansComplete = (walletId, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // Check immediately
    if (areMerkleScansComplete(walletId)) {
      console.log('[SDK Callbacks] ✅ Merkle scans already complete');
      resolve(true);
      return;
    }
    
    console.log('[SDK Callbacks] ⏳ Waiting for Merkle scans to complete...', {
      walletId: walletId?.slice(0, 8) + '...',
      timeout: `${timeoutMs}ms`
    });
    
    // Set up listeners for scan progress
    const handleUTXOScan = (event) => {
      const scanData = event.detail;
      
      // Update scan state
      let walletScanState = merkleTreeScanState.get(walletId) || { utxoProgress: 0, txidProgress: 0 };
      walletScanState.utxoProgress = scanData.progress || 0;
      merkleTreeScanState.set(walletId, walletScanState);
      
      console.log('[SDK Callbacks] 📊 UTXO scan progress:', {
        walletId: walletId?.slice(0, 8) + '...',
        progress: `${Math.round(scanData.progress * 100)}%`,
        status: scanData.scanStatus
      });

      // Check if both scans are complete
      if (areMerkleScansComplete(walletId)) {
        console.log('[SDK Callbacks] 🎉 All Merkle scans completed!');
        window.removeEventListener('railgun-utxo-scan', handleUTXOScan);
        window.removeEventListener('railgun-txid-scan', handleTXIDScan);

        // Dispatch scan completion event to unlock modal
        window.dispatchEvent(new CustomEvent('railgun-scan-completed', {
          detail: { walletId, type: 'initial' }
        }));

        resolve(true);
      }
    };
    
    const handleTXIDScan = (event) => {
      const scanData = event.detail;
      
      // Update scan state
      let walletScanState = merkleTreeScanState.get(walletId) || { utxoProgress: 0, txidProgress: 0 };
      walletScanState.txidProgress = scanData.progress || 0;
      merkleTreeScanState.set(walletId, walletScanState);
      
      console.log('[SDK Callbacks] 📊 TXID scan progress:', {
        walletId: walletId?.slice(0, 8) + '...',
        progress: `${Math.round(scanData.progress * 100)}%`,
        status: scanData.scanStatus
      });

      // Check if both scans are complete
      if (areMerkleScansComplete(walletId)) {
        console.log('[SDK Callbacks] 🎉 All Merkle scans completed!');
        window.removeEventListener('railgun-utxo-scan', handleUTXOScan);
        window.removeEventListener('railgun-txid-scan', handleTXIDScan);

        // Dispatch scan completion event to unlock modal
        window.dispatchEvent(new CustomEvent('railgun-scan-completed', {
          detail: { walletId, type: 'initial' }
        }));

        resolve(true);
      }
    };
    
    // Listen for scan updates
    window.addEventListener('railgun-utxo-scan', handleUTXOScan);
    window.addEventListener('railgun-txid-scan', handleTXIDScan);
    
    // Set timeout
    setTimeout(() => {
      window.removeEventListener('railgun-utxo-scan', handleUTXOScan);
      window.removeEventListener('railgun-txid-scan', handleTXIDScan);
      const elapsed = Date.now() - startTime;
      console.warn('[SDK Callbacks] ⏰ Timeout waiting for Merkle scans:', {
        walletId: walletId?.slice(0, 8) + '...',
        elapsed: `${elapsed}ms`,
        finalState: merkleTreeScanState.get(walletId)
      });
      resolve(false);
    }, timeoutMs);
  });
};

/**
 * Enhanced UTXO Merkletree scan callback with detailed progress tracking
 * @param {Object} scanData - Scan progress data from SDK
 */
export const onUTXOMerkletreeScanCallback = (scanData) => {
  console.log('[SDK Callbacks] 📊 UTXO Merkletree scan update:', {
    progress: `${Math.round((scanData.progress || 0) * 100)}%`,
    scanStatus: scanData.scanStatus,
    timestamp: new Date().toISOString()
  });
  
  // Dispatch event for UI components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: scanData
    }));
  }
  
  // Log scan milestones
  const progressPercent = Math.round((scanData.progress || 0) * 100);
  if (progressPercent === 100 || scanData.scanStatus === 'Complete') {
    console.log('[SDK Callbacks] 🎯 UTXO Merkletree scan reached 100% - notes should be available for processing');
  } else if (progressPercent % 25 === 0 && progressPercent > 0) {
    console.log(`[SDK Callbacks] 📈 UTXO scan milestone: ${progressPercent}% complete`);
  }
};

/**
 * Enhanced TXID Merkletree scan callback with detailed progress tracking
 * @param {Object} scanData - Scan progress data from SDK
 */
export const onTXIDMerkletreeScanCallback = (scanData) => {
  console.log('[SDK Callbacks] 📊 TXID Merkletree scan update:', {
    progress: `${Math.round((scanData.progress || 0) * 100)}%`,
    scanStatus: scanData.scanStatus,
    timestamp: new Date().toISOString()
  });
  
  // Dispatch event for UI components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('railgun-txid-scan', {
      detail: scanData
    }));
  }
  
  // Log scan milestones
  const progressPercent = Math.round((scanData.progress || 0) * 100);
  if (progressPercent === 100 || scanData.scanStatus === 'Complete') {
    console.log('[SDK Callbacks] 🎯 TXID Merkletree scan reached 100% - transaction data fully processed');
  } else if (progressPercent % 25 === 0 && progressPercent > 0) {
    console.log(`[SDK Callbacks] 📈 TXID scan milestone: ${progressPercent}% complete`);
  }
};

/**
 * Enhanced balance update callback that tracks spendable note availability
 * @param {Object} balancesEvent - Balance update event from SDK
 */
export const handleBalanceUpdateCallback = async (balancesEvent) => {
  try {
    const walletId = balancesEvent.railgunWalletID;
    const chainId = balancesEvent.chain?.id;
    const bucket = balancesEvent.balanceBucket;
    
    console.log('[SDK Callbacks] 🎯 Balance update callback received:', {
      walletId: walletId?.slice(0, 8) + '...',
      chainId: chainId,
      bucket: bucket,
      erc20Count: balancesEvent.erc20Amounts?.length || 0,
      timestamp: new Date().toISOString()
    });

    // Cache the balance update using our balance cache system
    try {
      const { onBalanceUpdateCallback: cacheCallback } = await import('./balanceCache.js');
      cacheCallback(balancesEvent);
    } catch (error) {
      console.error('[SDK Callbacks] ❌ Error updating balance cache:', error);
    }

    // Process spendable balance updates (most important for proof generation)
    if (bucket === 'Spendable' && balancesEvent.erc20Amounts?.length > 0) {
      
      // Update spendable notes state
      let walletState = spendableNotesState.get(walletId) || {};
      
      balancesEvent.erc20Amounts.forEach(token => {
        const tokenAddress = token.tokenAddress?.toLowerCase();
        const amount = BigInt(token.amount || '0');
        
        if (tokenAddress) {
          walletState[tokenAddress] = {
            isSpendable: amount > 0n,
            amount: amount,
            lastUpdate: Date.now()
          };
          
          console.log('[SDK Callbacks] 💎 Spendable note state updated:', {
            walletId: walletId?.slice(0, 8) + '...',
            tokenAddress: tokenAddress.slice(0, 10) + '...',
            amount: amount.toString(),
            isSpendable: amount > 0n
          });
        }
      });
      
      spendableNotesState.set(walletId, walletState);
      
      console.log('[SDK Callbacks] ✅ Spendable notes state updated for wallet:', {
        walletId: walletId?.slice(0, 8) + '...',
        spendableTokens: Object.keys(walletState).length,
        tokensWithBalance: Object.values(walletState).filter(s => s.isSpendable).length
      });
    }
    
    // Continue with existing balance update handling (dispatch to useBalances)
    const event = new CustomEvent('railgun-balance-update', {
      detail: balancesEvent
    });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(event);
    }
    
    // Log correlation between scans and balance updates
    if (bucket === 'Spendable') {
      const scansComplete = areMerkleScansComplete(walletId);
      console.log('[SDK Callbacks] 🔗 Balance/Scan correlation:', {
        walletId: walletId?.slice(0, 8) + '...',
        balanceUpdateReceived: true,
        merkleScansComplete: scansComplete,
        bucket: bucket,
        isOptimalTiming: scansComplete, // Best case: scans complete before balance update
        note: scansComplete ? 'Perfect sync: scans complete → balance ready' : 'Partial sync: balance updating while scans in progress'
      });
    }
    
  } catch (error) {
    console.error('[SDK Callbacks] ❌ Error in balance update callback:', error);
  }
};

/**
 * Initialize all SDK callbacks - called during engine setup
 */
export const initializeSDKCallbacks = async () => {
  try {
    console.log('[SDK Callbacks] 🔧 Initializing official Railgun SDK callbacks...');
    
    // Import the official SDK callback setters
    const { 
      setOnUTXOMerkletreeScanCallback, 
      setOnTXIDMerkletreeScanCallback, 
      setOnBalanceUpdateCallback 
    } = await import('@railgun-community/wallet');
    
    // Set up the callbacks
    setOnUTXOMerkletreeScanCallback(onUTXOMerkletreeScanCallback);
    setOnTXIDMerkletreeScanCallback(onTXIDMerkletreeScanCallback);
    setOnBalanceUpdateCallback(handleBalanceUpdateCallback);
    
    console.log('[SDK Callbacks] ✅ All official SDK callbacks initialized');
    
    // Clear any existing state
    spendableNotesState.clear();
    merkleTreeScanState.clear();
    
    console.log('[SDK Callbacks] 🧹 Callback state cleared and ready');
    
  } catch (error) {
    console.error('[SDK Callbacks] ❌ Failed to initialize SDK callbacks:', error);
    throw error;
  }
};

// Export for use in other modules
export default {
  initializeSDKCallbacks,
  areSpendableNotesReady,
  waitForSpendableNotes,
  areMerkleScansComplete,
  waitForMerkleScansComplete,
  onUTXOMerkletreeScanCallback,
  onTXIDMerkletreeScanCallback,
  handleBalanceUpdateCallback,
};