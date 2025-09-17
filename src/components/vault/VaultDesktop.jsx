/**
 * Wallet Page - Main wallet interface with privacy features
 * Integrates external wallet connection and Railgun privacy functionality
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { 
  WalletIcon, 
  ArrowRightIcon, 
  EyeIcon, 
  EyeSlashIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../../contexts/WalletContext';
import TerminalWindow from '../ui/TerminalWindow.jsx';
import useBalances from '../../hooks/useBalances';
import PrivacyActions from '../PrivacyActions';
import TransactionHistory from '../TransactionHistory';
import InjectedProviderButtons from '../InjectedProviderButtons.jsx';
import {
  shieldTokens,
  parseTokenAmount,
  isTokenSupportedByRailgun,
} from '../../utils/railgun/actions';
// Removed deprecated checkSufficientBalance import
import { deriveEncryptionKey } from '../../utils/railgun/wallet';

import { isChainScanned, toNum } from '../../utils/isChainScanned';

const VaultDesktopInner = () => {
  const {
    isConnected,
    isConnecting,
    address,
    chainId,
    railgunWalletId,
    railgunAddress,
    isRailgunInitialized,
    isInitializingRailgun,
    canUseRailgun,
    railgunError,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    getCurrentNetwork,
    walletProviders,
    isWalletAvailable,
    walletProvider, // Add walletProvider to destructuring
    checkChainReady,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    loading: isLoading,
    error: balanceErrors,
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    lastUpdateTime,
    loadPrivateBalancesFromMetadata, // Add this for Redis-only refresh
    isPrivateBalancesLoading, // Add this
  } = useBalances();

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [selectedView, setSelectedView] = useState('balances'); // 'balances', 'privacy', or 'history'
  const [activeAction, setActiveAction] = useState('shield'); // 'shield', 'unshield', 'transfer'
  const [showPrivateBalances, setShowPrivateBalances] = useState(false);
  const [isShielding, setIsShielding] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
  const [activeTransactionMonitors, setActiveTransactionMonitors] = useState(0);
  const [shieldingTokens, setShieldingTokens] = useState(new Set());
  const [shieldAmounts, setShieldAmounts] = useState({});
  const [showSignatureGuide, setShowSignatureGuide] = useState(false);
  const [showSignRequestPopup, setShowSignRequestPopup] = useState(false);
  const [initProgress, setInitProgress] = useState({ percent: 0, message: '' });
  const [isInitInProgress, setIsInitInProgress] = useState(false);
  const [initFailedMessage, setInitFailedMessage] = useState('');
  const initAddressRef = React.useRef(null);
  // Track when initial connection hydration is complete
  const initialConnectDoneRef = React.useRef(false);
  // Lexie ID linking state
  const [lexieIdInput, setLexieIdInput] = useState('');
  const [lexieLinking, setLexieLinking] = useState(false);
  const [lexieCode, setLexieCode] = useState('');
  const [lexieNeedsCode, setLexieNeedsCode] = useState(false);
  const [lexieMessage, setLexieMessage] = useState('');
  const [showLexieModal, setShowLexieModal] = useState(false);
  const [currentLexieId, setCurrentLexieId] = useState('');
  const [pointsBalance, setPointsBalance] = useState(null);
  // Local state to show a refreshing indicator for Vault Balances (always available)
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  // Redis metadata gating for lock modal
  const [hasRedisWalletData, setHasRedisWalletData] = useState(null);
  const redisCheckRef = useRef({ inFlight: false, lastFor: null });

  const network = getCurrentNetwork();
  const [isChainReady, setIsChainReady] = useState(false);

  // Check Redis for existing wallet metadata for this address
  const checkRedisWalletData = useCallback(async () => {
    if (!address) { setHasRedisWalletData(null); return null; }
    try {
      if (redisCheckRef.current.inFlight && redisCheckRef.current.lastFor === address) {
        return hasRedisWalletData == null ? null : !!hasRedisWalletData;
      }
      redisCheckRef.current.inFlight = true;
      redisCheckRef.current.lastFor = address;
      const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
      if (!resp.ok) { setHasRedisWalletData(null); return null; }
      const data = await resp.json().catch(() => ({}));
      const keys = Array.isArray(data?.keys) ? data.keys : [];
      const metaKey = keys.find((k) => (k.walletId && k.railgunAddress && (k?.eoa?.toLowerCase?.() === address.toLowerCase()))) || null;
      const exists = !!metaKey && (!!metaKey.signature || !!metaKey.encryptedMnemonic);
      setHasRedisWalletData(exists);
      return exists;
    } catch {
      setHasRedisWalletData(null);
      return null;
    } finally {
      redisCheckRef.current.inFlight = false;
    }
  }, [address, hasRedisWalletData]);

  // Keep metadata status up to date when address changes; clear cached state first
  useEffect(() => { setHasRedisWalletData(null); checkRedisWalletData(); }, [address, checkRedisWalletData]);

  // Reset initial-connect flag and lock UI on wallet/address change
  useEffect(() => {
    initialConnectDoneRef.current = false;
    setShowSignRequestPopup(false);
    setIsInitInProgress(false);
    setInitFailedMessage('');
    setInitProgress({ percent: 0, message: '' });
  }, [address]);

  // Unified gate for opening the initialization modal
  async function maybeOpenInitModalByRedis(targetChainId) {
    const id = toNum(targetChainId ?? chainId);
    console.log('[DEBUG] maybeOpenInitModalByRedis: targetChainId=', targetChainId, 'calculated id=', id, 'address=', address, 'railgunWalletId=', railgunWalletId);
    if (id == null || !address) {
      console.log('[DEBUG] Early return: invalid id or no address');
      return false;
    }

    // Special case: If no railgunWalletId (new wallet, initial signature request), always open modal
    if (!railgunWalletId) {
      console.log('[DEBUG] No railgunWalletId - opening modal for initial setup');
      if (!showSignRequestPopup) setShowSignRequestPopup(true);
      setIsInitInProgress(true);
      const label =
        id === 1 ? 'Ethereum' :
        id === 42161 ? 'Arbitrum' :
        id === 137 ? 'Polygon' :
        id === 56 ? 'BNB Chain' : `Chain ${id}`;
      setInitProgress({ percent: 0, message: `Setting up your LexieVault on ${label} Network...` });
      return true;
    }

    // Wait for Railgun engine: Check local readiness first
    let ready;
    try {
      ready = await checkChainReady();
      console.log('[DEBUG] checkChainReady result:', ready);
    } catch (e) {
      console.error('[DEBUG] checkChainReady error:', e);
      ready = false; // Fallback: assume not ready on error
    }
    if (ready === true) {
      console.log('[DEBUG] Engine reports chain ready - not opening modal');
      setShowSignRequestPopup(false);
      setIsInitInProgress(false);
      return false;
    }

    // Only if not ready locally, check Redis
    const scanned = await isChainScanned(address, railgunWalletId, id);
    console.log('[DEBUG] isChainScanned result:', scanned);

    if (scanned === true) {
      console.log('[DEBUG] Redis confirms scanned - not opening modal');
      setShowSignRequestPopup(false);
      setIsInitInProgress(false);
      return false;
    }

    if (scanned === false) {
      console.log('[DEBUG] Redis confirms not scanned - opening modal');
      if (!showSignRequestPopup) setShowSignRequestPopup(true);
      setIsInitInProgress(true);
      const label =
        id === 1 ? 'Ethereum' :
        id === 42161 ? 'Arbitrum' :
        id === 137 ? 'Polygon' :
        id === 56 ? 'BNB Chain' : `Chain ${id}`;
      setInitProgress({ percent: 0, message: `Setting up your LexieVault on ${label} Network...` });
      return true;
    }

    // scanned === null (error/unknown): do nothing, assume issue but don't lock
    console.log('[DEBUG] Scanned is null - not opening modal');
    return false;
  }

  // Disconnect handler: clear local/session flags and reset UI state before actual disconnect
  const handleDisconnect = useCallback(async () => {
    try {
      // Clear per-address guide flag
      try { if (address) { localStorage.removeItem(`railgun-guide-seen-${address.toLowerCase()}`); } } catch {}
      // Clear any session flags
      try { sessionStorage.clear(); } catch {}
      // Reset WalletConnect/Wagmi cached sessions so QR code is fresh next time
      try {
        const lc = localStorage;
        if (lc) {
          try { lc.removeItem('wagmi.store'); } catch {}
          try { lc.removeItem('walletconnect'); } catch {}
          try { lc.removeItem('WALLETCONNECT_DEEPLINK_CHOICE'); } catch {}
          // Remove any wc@ v2 keys and web3modal caches
          try {
            const keys = Object.keys(lc);
            keys.forEach((k) => {
              if (k.startsWith('wc@') || k.startsWith('wc:') || k.toLowerCase().includes('walletconnect') || k.toLowerCase().includes('web3modal')) {
                try { lc.removeItem(k); } catch {}
              }
            });
          } catch {}
        }
      } catch {}
      // Reset local UI state
      try { setCurrentLexieId(''); } catch {}
      try { setPointsBalance(null); } catch {}
      try { setHasRedisWalletData(null); } catch {}
      try {
        setShowSignRequestPopup(false);
        setIsInitInProgress(false);
        setInitFailedMessage('');
        setInitProgress({ percent: 0, message: '' });
      } catch {}
    } finally {
      try { await disconnectWallet(); } catch {}
    }
  }, [address, disconnectWallet]);

  // Listen for transaction lock/unlock events from PrivacyActions
  useEffect(() => {
    const handleTransactionStart = () => {
      console.log('[WalletPage] 🔒 Transaction started, locking UI');
      setIsTransactionLocked(true);
      setActiveTransactionMonitors(prev => {
        const newCount = prev + 1;
        console.log(`[WalletPage] 📊 Transaction monitor count increased: ${newCount}`);
        return newCount;
      });
    };

    const handleTransactionComplete = () => {
      console.log('[WalletPage] 📋 Transaction form reset completed');
      // Don't unlock UI here - let the monitor completion handle it
    };

    // Listen for transaction monitor completion to unlock transactions
    const handleTransactionMonitorComplete = (event) => {
      const { transactionType, found, elapsedTime } = event.detail;
      console.log(`[WalletPage] ✅ Transaction monitor completed for ${transactionType} (${found ? 'found' : 'timeout'}) in ${elapsedTime/1000}s`);

      setActiveTransactionMonitors(prev => {
        const newCount = prev - 1;
        console.log(`[WalletPage] 📊 Transaction monitor count decreased: ${newCount}`);

        // Only unlock UI when ALL monitors have completed
        if (newCount === 0) {
          console.log('[WalletPage] 🔓 All transaction monitors completed, unlocking UI');
          setIsTransactionLocked(false);
        } else {
          console.log(`[WalletPage] 🔒 Still ${newCount} transaction monitor(s) running, keeping UI locked`);
        }

        return newCount;
      });

      // Points award on completion (LexieID-gated)
      try {
        if (!currentLexieId) return;
        const detail = event?.detail || {};
        const txHash = (detail.txHash || detail.hash || '').toString();
        const usdValue = Number(detail.usdValue || detail.usd || 0);
        if (!txHash) return;
        // Allow awarding even if usdValue missing; backend enforces min and idempotency
        fetch('/api/wallet-metadata?action=rewards-award', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lexieId: currentLexieId, txHash, usdValue })
        }).then(async (r) => {
          const json = await r.json().catch(() => ({}));
          if (r.ok && json?.success && typeof json.balance === 'number') {
            setPointsBalance(json.balance);
          } else if (r.ok && json?.ok && typeof json.balance === 'number') {
            setPointsBalance(json.balance);
          } else if (r.ok && json?.idempotent) {
            // fallback refresh
            fetch(`/api/wallet-metadata?action=rewards-balance&lexieId=${encodeURIComponent(currentLexieId)}`).then(res => res.json()).then(b => {
              if (b?.success && typeof b.balance === 'number') setPointsBalance(b.balance);
            }).catch(() => {});
          }
        }).catch(() => {});
      } catch {}
    };

    // Also listen for balance update completion as backup
    const handleBalanceUpdateComplete = (event) => {
      console.log('[WalletPage] 🔓 Balance update completed (backup unlock)');
      setIsTransactionLocked(false);
      setActiveTransactionMonitors(0); // Reset counter as backup
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('privacy-transaction-start', handleTransactionStart);
      window.addEventListener('privacy-transaction-complete', handleTransactionComplete);
      window.addEventListener('transaction-monitor-complete', handleTransactionMonitorComplete);
      window.addEventListener('railgun-public-refresh', handleBalanceUpdateComplete);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('privacy-transaction-start', handleTransactionStart);
        window.removeEventListener('privacy-transaction-complete', handleTransactionComplete);
        window.removeEventListener('transaction-monitor-complete', handleTransactionMonitorComplete);
        window.removeEventListener('railgun-public-refresh', handleBalanceUpdateComplete);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Reset readiness when dependencies change to avoid stale "complete" state on chain switch
      if (mounted) setIsChainReady(false);
      if (!canUseRailgun || !railgunWalletId || !address) return;
      try {
        const ready = await checkChainReady();
        if (mounted) setIsChainReady(!!ready);
      } catch {
        if (mounted) setIsChainReady(false);
      }
    })();
    return () => { mounted = false; };
  }, [canUseRailgun, railgunWalletId, address, chainId]);

  // Event listeners for vault balance refresh state (always available in WalletPage)
  useEffect(() => {
    // Public balances events are ignored for UI gating; only private events control the spinner
    const onPrivateStart = () => {
      console.log('[WalletPage] Private balances refresh started - showing spinner');
      setIsRefreshingBalances(true);
    };
    const onPrivateComplete = () => {
      console.log('[WalletPage] Private balances refresh completed - hiding spinner');
      setIsRefreshingBalances(false);
    };
    window.addEventListener('vault-private-refresh-start', onPrivateStart);
    window.addEventListener('vault-private-refresh-complete', onPrivateComplete);
    return () => {
      window.removeEventListener('vault-private-refresh-start', onPrivateStart);
      window.removeEventListener('vault-private-refresh-complete', onPrivateComplete);
    };
  }, []);

  // Full refresh: SDK refresh + Redis persist, then UI reload (public from chain + private from Redis)
  const refreshBalances = useCallback(async () => {
    try {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-start')); } catch {}
      console.log('[WalletPage] 🔄 Full refresh — SDK refresh + Redis persist, then UI fetch...');

      // Step 1: Trigger SDK refresh + persist authoritative balances to Redis
      try {
        if (railgunWalletId && address && chainId) {
          const { syncBalancesAfterTransaction } = await import('../../utils/railgun/syncBalances.js');
          await syncBalancesAfterTransaction({
            walletAddress: address,
            walletId: railgunWalletId,
            chainId,
          });
        }
      } catch (sdkErr) {
        console.warn('[WalletPage] ⚠️ SDK refresh + persist failed (continuing to UI refresh):', sdkErr?.message);
      }

      // Step 2: Refresh UI from sources of truth
      await refreshAllBalances();

      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Balances refreshed</div>
                <div className="text-xs text-green-400/80">Public and vault balances updated</div>
              </div>
              <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80">×</button>
            </div>
          </div>
        </div>
      ), { duration: 2500 });
    } catch (error) {
      console.error('[WalletPage] Full refresh failed:', error);
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <div>
                <div className="text-sm">Failed to refresh balances</div>
                <div className="text-xs text-green-400/80">Please try again</div>
              </div>
              <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80">×</button>
            </div>
          </div>
        </div>
      ), { duration: 3500 });
    } finally {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-complete')); } catch {}
    }
  }, [refreshAllBalances, railgunWalletId, address, chainId]);

  // Auto-refresh public balances when wallet connects
  useEffect(() => {
    if (isConnected && address && chainId) {
      console.log('[WalletPage] 🔄 Wallet connected - auto-refreshing public balances...');
      refreshAllBalances();
    }
  }, [isConnected, address, chainId]); // Removed refreshAllBalances to prevent infinite loop

  // Auto-switch to privacy view when Railgun is ready
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      setShowPrivateMode(true);
    }
  }, [canUseRailgun, railgunWalletId]);

  // Re-check readiness immediately after scan completes and Redis updates
  useEffect(() => {
    const onScanComplete = () => {
      // Re-check readiness for the current chain only after Redis has updated scannedChains
      setIsChainReady(false);
      checkChainReady().then((ready) => setIsChainReady(!!ready)).catch(() => setIsChainReady(false));
    };
    window.addEventListener('railgun-scan-complete', onScanComplete);
    return () => window.removeEventListener('railgun-scan-complete', onScanComplete);
  }, [checkChainReady]);

  // Mark initial connect as done once wallet metadata is ready or init completes
  useEffect(() => {
    const markDone = () => { initialConnectDoneRef.current = true; };
    window.addEventListener('railgun-wallet-metadata-ready', markDone);
    window.addEventListener('railgun-init-completed', markDone);
    return () => {
      window.removeEventListener('railgun-wallet-metadata-ready', markDone);
      window.removeEventListener('railgun-init-completed', markDone);
    };
  }, []);

  // Fetch initial points when Lexie ID is available
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentLexieId) { setPointsBalance(null); return; }
      try {
        const resp = await fetch(`/api/wallet-metadata?action=rewards-balance&lexieId=${encodeURIComponent(currentLexieId)}`);
        if (!cancelled && resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json?.success) setPointsBalance(Number(json.balance) || 0);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentLexieId]);

  // Fetch points balance when we have a Lexie ID
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentLexieId) { setPointsBalance(null); return; }
      try {
        const resp = await fetch(`/api/wallet-metadata?action=rewards-balance&lexieId=${encodeURIComponent(currentLexieId)}`);
        if (!cancelled && resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json?.success) setPointsBalance(Number(json.balance) || 0);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentLexieId]);

  // Listen for signature request and init lifecycle events from WalletContext
  useEffect(() => {
    const onSignRequest = async () => {
      await maybeOpenInitModalByRedis(chainId);
    };
    const onInitStarted = async (e) => { await maybeOpenInitModalByRedis(chainId); };
    const onInitProgress = async () => {
      // Gate progress handler to only run while initialization is actually in progress
      if (!isInitInProgress) return;
      const chainLabel = network?.name || (chainId ? `Chain ${chainId}` : 'network');
      setInitProgress((prev) => ({
        percent: prev.percent,
        message: prev.message || `Setting up your LexieVault on ${chainLabel}...`,
      }));
    };
    const onInitCompleted = () => {
      // Do not set to 100% here; wait for Redis scannedChains to confirm
      console.log('[Vault Init] SDK reported completed; awaiting Redis confirmation');
      setInitProgress((prev) => ({ ...prev, message: prev.message || 'Finalizing...' }));
    };
    const onInitFailed = (e) => {
      try { if (syntheticTicker) clearInterval(syntheticTicker); } catch {}
      const msg = e?.detail?.error || 'Initialization failed';
      setInitFailedMessage(msg);
      setIsInitInProgress(false);
      console.warn('[LexieVault Init] Initialization failed:', msg);
    };
    const onPollStart = async () => { if (!initialConnectDoneRef.current) return; await maybeOpenInitModalByRedis(chainId); };
    const onScanStarted = async () => { if (!initialConnectDoneRef.current) return; await maybeOpenInitModalByRedis(chainId); };
    window.addEventListener('railgun-signature-requested', onSignRequest);
    // Begin polling exactly when refreshBalances starts in context
    window.addEventListener('vault-poll-start', onPollStart);
    window.addEventListener('railgun-init-started', onInitStarted); // full init always shows
    window.addEventListener('railgun-scan-started', onScanStarted);
    window.addEventListener('railgun-init-progress', onInitProgress);
    window.addEventListener('railgun-init-completed', onInitCompleted);
    window.addEventListener('railgun-init-failed', onInitFailed);
    return () => {
      window.removeEventListener('railgun-signature-requested', onSignRequest);
      window.removeEventListener('railgun-init-started', onInitStarted);
      window.removeEventListener('vault-poll-start', onPollStart);
      window.removeEventListener('railgun-init-progress', onInitProgress);
      window.removeEventListener('railgun-scan-started', onScanStarted);
      window.removeEventListener('railgun-init-completed', onInitCompleted);
      window.removeEventListener('railgun-init-failed', onInitFailed);
      try { if (window.__LEXIE_INIT_POLL_ID) { clearInterval(window.__LEXIE_INIT_POLL_ID); window.__LEXIE_INIT_POLL_ID = null; } } catch {}
    };
  }, [address, chainId, railgunWalletId, network, checkChainReady, showSignRequestPopup]);

  // Unlock modal using the same readiness flag as Privacy Actions
  useEffect(() => {
    if (showSignRequestPopup && isInitInProgress && isChainReady) {
      setInitProgress({ percent: 100, message: 'Initialization complete' });
      setIsInitInProgress(false);
    }
  }, [isChainReady, isInitInProgress, showSignRequestPopup]);

  // Check if this Railgun address already has a linked Lexie ID
  useEffect(() => {
    if (!railgunAddress) {
      setCurrentLexieId('');
      return;
    }
    (async () => {
      try {
        // Check if this railgun address has a linked Lexie ID
        const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(railgunAddress)}`);
        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json.success && json.lexieID) {
            setCurrentLexieId(json.lexieID);
          } else {
            setCurrentLexieId('');
          }
        } else {
          setCurrentLexieId('');
        }
      } catch {
        setCurrentLexieId('');
      }
    })();
  }, [railgunAddress]);

  // Show signature guide on first-time EOA connection
  useEffect(() => {
    if (isConnected && address && !canUseRailgun && !isInitializingRailgun) {
      // Check if this address has seen the guide before
      const seenGuideKey = `railgun-guide-seen-${address.toLowerCase()}`;
      const hasSeenGuide = localStorage.getItem(seenGuideKey);
      
      if (!hasSeenGuide) {
        // Add small delay to ensure connection is fully established
        const timer = setTimeout(() => {
          setShowSignatureGuide(true);
          // Mark this address as having seen the guide
          localStorage.setItem(seenGuideKey, 'true');
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [isConnected, address, canUseRailgun, isInitializingRailgun]);

  // Get encryption key
  const getEncryptionKey = useCallback(async () => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }

    try {
      const secret = address.toLowerCase();
      const salt = `lexie-railgun-${chainId}`;
      return await deriveEncryptionKey(secret, salt, 100000);
    } catch (error) {
      console.error('[WalletPage] Failed to derive encryption key:', error);
      throw new Error('Failed to derive encryption key');
    }
  }, [address, chainId]);

  // Handle individual token shielding
  const handleShieldToken = useCallback(async (token) => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    const amount = shieldAmounts[token.symbol] || '';
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount to shield');
      return;
    }

    try {
      setIsShielding(true);
      setShieldingTokens(prev => new Set([...prev, token.symbol]));
      
      // Validate token is supported by Railgun
      if (!isTokenSupportedByRailgun(token.address, chainId)) {
        throw new Error(`${token.symbol} is not supported by Railgun on this network`);
      }

      // Check sufficient balance - using direct balance check instead of deprecated function
      const requestedAmount = parseFloat(amount);
      const availableAmount = token.numericBalance || 0;
      
      if (availableAmount < requestedAmount) {
        throw new Error(`Insufficient balance. Available: ${availableAmount} ${token.symbol}`);
      }

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(amount, token.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute shield operation with enhanced logging
      console.log('[WalletPage] About to call shieldTokens with:', {
        railgunWalletId: railgunWalletId ? `${railgunWalletId.slice(0, 8)}...` : 'MISSING',
        hasKey: !!key,
        tokenAddress: token.address,
        tokenDetails: {
          symbol: token.symbol,
          address: token.address,
          hasAddress: !!token.address,
          addressType: typeof token.address,
          addressLength: token.address ? token.address.length : 0
        },
        amountInUnits,
        chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress ? `${railgunAddress.slice(0, 8)}...` : 'MISSING'
      });

      // Validate token address: allow undefined/null for native base tokens (e.g., ETH/MATIC/BNB)
      const isNativeToken = token.address == null; // undefined or null means native token
      if (!isNativeToken && (typeof token.address !== 'string' || !token.address.startsWith('0x') || token.address.length !== 42)) {
        throw new Error(`Invalid token address for ${token.symbol}`);
      }

      // Log token type for debugging
      const tokenType = isNativeToken ? 'NATIVE' : 'ERC20';
      console.log('[WalletPage] About to shield', tokenType, 'token:', token.symbol);
      
      const result = await shieldTokens({
        tokenAddress: token.address,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress,
        walletProvider: await walletProvider()
      });

      // Send the transaction to the blockchain
      toast.dismiss();
      
      console.log('[WalletPage] Sending shield transaction:', result.transaction);
      
      // Get wallet signer
      const walletSigner = await walletProvider();
      
      // Send transaction using signer
      const txResponse = await walletSigner.sendTransaction(result.transaction);
      
      console.log('[WalletPage] Transaction sent:', txResponse);
      
      // Wait for transaction confirmation
      toast.dismiss();
      toast.loading(`Waiting for confirmation...`);
      
      // Note: In a production app, you'd want to wait for confirmation
      // For now, we'll just show success after sending
      
      toast.dismiss();
      toast.success(`Successfully shielded ${amount} ${token.symbol}! TX: ${txResponse.hash}`);
      
      // Clear the amount for this token
      setShieldAmounts(prev => ({ ...prev, [token.symbol]: '' }));
      
      // Enhanced transaction monitoring
      toast.dismiss();
      console.log('[WalletPage] Starting Graph-based shield monitoring...');
      
      try {
        // Import the enhanced transaction monitor
        const { monitorTransactionInGraph } = await import('../../utils/railgun/transactionMonitor');
        
        // Start monitoring with transaction details for optimistic updates
        monitorTransactionInGraph({
          txHash: txResponse.hash,
          chainId: chainConfig.id,
          transactionType: 'shield',
          // Pass transaction details for optimistic UI update and note capture
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            tokenSymbol: token.symbol,
            tokenAddress: token.address,
            decimals: token.decimals,
            amount: amount,
          },
          listener: async (event) => {
            console.log(`[WalletPage] ✅ Shield tx ${txResponse.hash} indexed on chain ${chainConfig.id}`);
            
          }
        })
        .then((result) => {
          if (result.found) {
            console.log(`[WalletPage] Shield monitoring completed in ${result.elapsedTime/1000}s`);
          } else {
            console.warn('[WalletPage] Shield monitoring timed out');
          }
        })
        .catch((error) => {
          console.error('[WalletPage] Shield Graph monitoring failed:', error);
          // Let balance callback handle the update
        });
        
      } catch (monitorError) {
        console.error('[WalletPage] Failed to start shield monitoring:', monitorError);
        // Still rely on balance callback system
      }
      
    } catch (error) {
      console.error('[WalletPage] Shield failed:', error);
      toast.dismiss();
    } finally {
      setIsShielding(false);
      setShieldingTokens(prev => {
        const newSet = new Set(prev);
        newSet.delete(token.symbol);
        return newSet;
      });
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, shieldAmounts, refreshBalancesAfterTransaction, getEncryptionKey, walletProvider]);

  // Handle Shield All functionality
  const handleShieldAll = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    try {
      setIsShielding(true);
      
      // Get tokens that can be shielded from public balances
      const shieldableTokens = publicBalances.filter(token => 
        token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)
      );
      
      if (shieldableTokens.length === 0) {
        toast.error('No tokens available to shield');
        return;
      }

      // Filter out dust balances and prepare tokens
      const tokensToShield = shieldableTokens
        .filter(token => token.numericBalance > 0.001 && isTokenSupportedByRailgun(token.address, chainId))
        .map(token => ({
          address: token.address,
          amount: parseTokenAmount(token.numericBalance.toString(), token.decimals),
          symbol: token.symbol,
        }));

      if (tokensToShield.length === 0) {
        toast.error('No supported tokens with sufficient balance to shield');
        return;
      }

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Shield All functionality temporarily disabled
      toast.error('Shield All functionality not available in current version');
      return;
      
      // Refresh balances after successful transaction
      await refreshBalancesAfterTransaction(railgunWalletId);
      
    } catch (error) {
      console.error('[WalletPage] Shield All failed:', error);
      toast.dismiss();
      toast.error(`Shield All failed: ${error.message}`);
    } finally {
      setIsShielding(false);
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, refreshBalancesAfterTransaction, getEncryptionKey]);

  const handleNetworkSwitch = async (targetChainId) => {
    console.log('[DEBUG] handleNetworkSwitch called with targetChainId=', targetChainId);
    try {
      // Block chain switching until secure vault engine is initialized
      if (!canUseRailgun || !railgunWalletId) {
        console.log('[DEBUG] Blocking switch: canUseRailgun=', canUseRailgun, 'railgunWalletId=', railgunWalletId);
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-yellow-500/30 bg-black/90 text-yellow-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div>
                  <div className="text-sm">Vault engine is starting…</div>
                  <div className="text-xs text-yellow-400/80">Please wait for initialization to complete before switching networks.</div>
                </div>
                <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-yellow-900/30 text-yellow-300/80">×</button>
              </div>
            </div>
          </div>
        ), { duration: 2500 });
        return;
      }
      // Switch network immediately for snappy UX
      console.log('[DEBUG] Switching network to', targetChainId);
      await switchNetwork(targetChainId);
      const targetNetwork = supportedNetworks.find(net => net.id === targetChainId);
      toast.custom((t) => (
        <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Network switched</div>
                <div className="text-xs text-green-400/80">{targetNetwork?.name || `Chain ${targetChainId}`}</div>
              </div>
            </div>
          </div>
        </div>
      ), { duration: 2000 });

      // After switch: single gate
      console.log('[DEBUG] Calling maybeOpenInitModalByRedis after switch');
      try { await maybeOpenInitModalByRedis(targetChainId); } catch (e) { console.error('[DEBUG] Error in maybeOpenInitModalByRedis:', e); }
    } catch (error) {
      console.error('[DEBUG] Error in handleNetworkSwitch:', error);
      toast.error(`Failed to switch network: ${error.message}`);
    }
  };

  const supportedNetworks = [
    { id: 1, name: 'Ethereum', symbol: 'ETH' },
    { id: 137, name: 'Polygon', symbol: 'MATIC' },
    { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
    { id: 56, name: 'BNB Chain', symbol: 'BNB' },
  ];

  const [isChainMenuOpen, setIsChainMenuOpen] = useState(false);
  const [isMobileChainMenuOpen, setIsMobileChainMenuOpen] = useState(false);
  const chainMenuRef = useRef(null);
  const mobileChainMenuRef = useRef(null);

  // Close custom chain menu on outside click or ESC
  useEffect(() => {
    if (!isChainMenuOpen && !isMobileChainMenuOpen) return;
    const onClickOutside = (e) => {
      if (chainMenuRef.current && !chainMenuRef.current.contains(e.target)) {
        setIsChainMenuOpen(false);
      }
      if (mobileChainMenuRef.current && !mobileChainMenuRef.current.contains(e.target)) {
        setIsMobileChainMenuOpen(false);
      }
    };
    const onKey = (e) => { 
      if (e.key === 'Escape') {
        setIsChainMenuOpen(false);
        setIsMobileChainMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isChainMenuOpen, isMobileChainMenuOpen]);

  if (!isConnected) {
    return (
      <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
        {/* Navigation (same as LandingPage) */}
        <nav className="sticky top-0 z-40 w-full p-6 bg-black">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="text-4xl font-bold text-purple-300">
              LEXIEAI
            </div>
            <div className="hidden md:flex space-x-6">
              <a href="/#features" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
              <a href="/#security" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
              <a href="/#beta" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
            </div>
          </div>
        </nav>

        {/* Background overlays (match LandingPage) */}
        <div className="fixed inset-0 z-0">
          {/* Base gradient layers */}
          <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
          {/* Futuristic cityscape silhouette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
          {/* Dynamic grid system */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
          </div>
          {/* Subtle ambient orbs */}
          <div className="absolute inset-0 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute rounded-full animate-pulse"
                style={{ 
                  left: `${20 + i * 30}%`,
                  top: `${20 + i * 20}%`,
                  width: `${200 + i * 100}px`,
                  height: `${200 + i * 100}px`,
                  background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                  animationDelay: `${i * 2}s`,
                  animationDuration: `${6 + i * 2}s`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
          <TerminalWindow
            title="LexieVault-connect"
            statusLabel={isConnecting ? 'WAITING' : 'READY'}
            statusTone={isConnecting ? 'waiting' : 'online'}
            footerLeft={<span>Process: wallet-connect</span>}
            variant="connect"
            className="overflow-hidden"
          >
            <div className="font-mono text-green-300 text-center">
              <WalletIcon className="h-16 w-16 text-emerald-300 mx-auto mb-6" />
              <h2 className="text-2xl font-semibold text-emerald-300 tracking-tight">Connect Wallet</h2>
              <p className="mt-2 text-emerald-300/80 text-center text-sm leading-6">
                Connect your wallet to gain access to the LexieVault features.
            </p>
            
            <div className="space-y-4">
              {/* Auto-detected injected providers (EIP-6963 + legacy) */}
              <InjectedProviderButtons disabled={isConnecting} />

              {/* WalletConnect tile is rendered within InjectedProviderButtons */}
            </div>

              <div className="mt-6 text-sm text-green-400/70 text-center">
              <p>Choose your preferred wallet to connect</p>
                <p className="mt-1 pb-3 text-xs">Connection is zk-secured and encrypted</p>
            </div>
          </div>
          </TerminalWindow>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Navigation (same as LandingPage) */}
      <nav className="sticky top-0 z-40 w-full p-6 bg-black">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-4xl font-bold text-purple-300">
            LEXIEAI
              </div>
          <div className="hidden md:flex space-x-6">
            <a href="/#features" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
            <a href="/#security" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
            <a href="/#beta" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
              </div>
            </div>
      </nav>

      {/* Background overlays (match LandingPage) */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        {/* Futuristic cityscape silhouette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        {/* Dynamic grid system */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>
        {/* Subtle ambient orbs */}
        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div 
              key={i} 
              className="absolute rounded-full animate-pulse"
              style={{ 
                left: `${20 + i * 30}%`,
                top: `${20 + i * 20}%`,
                width: `${200 + i * 100}px`,
                height: `${200 + i * 100}px`,
                background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                animationDelay: `${i * 2}s`,
                animationDuration: `${6 + i * 2}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <TerminalWindow
          title="lexie-ai"
          statusLabel={canUseRailgun ? 'ONLINE' : 'WAITING'}
          statusTone={canUseRailgun ? 'online' : 'waiting'}
          footerLeft={<span>Process: lexie-vault</span>}
          variant="vault"
          className="overflow-visible"
        >
          <div className="font-mono text-green-300 space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-green-500/20 pb-4 gap-2">
              <div>
                <h1 className="text-xl font-bold text-emerald-300">LexieVault</h1>
                <div className="flex items-center space-x-2 text-sm flex-wrap">
                  <span className="text-green-400/80">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  <span className="text-green-400/60">•</span>
                  {currentLexieId ? (
                    <div className="flex items-center space-x-2">
                      <span className="text-purple-300 font-medium">{currentLexieId}</span>
                      {typeof pointsBalance === 'number' && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-purple-600/20 text-purple-200 border border-purple-400/30 px-2 py-0.5 text-[11px]" title="Points = $ value × streak. Min $5. Streak resets if you skip a day.">
                          ✦ {pointsBalance}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(currentLexieId);
                          toast.custom((t) => (
                            <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                              <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                                <div className="px-4 py-3 flex items-center gap-3">
                                  <div className="h-3 w-3 rounded-full bg-emerald-400" />
                                  <div>
                                    <div className="text-sm">Lexie ID copied to clipboard</div>
                                    <div className="text-xs text-green-400/80">{currentLexieId}</div>
                                  </div>
                                  <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80">×</button>
                                </div>
                              </div>
                            </div>
                          ), { duration: 2500 });
                        }}
                        className="inline-flex items-center gap-1 bg-purple-300 hover:bg-purple-400 text-black px-2 py-0.5 rounded text-xs font-medium transition-colors"
                        title="Copy Lexie ID"
                      >
                        <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowLexieModal(true)}
                      className="bg-purple-300 hover:bg-purple-400 text-black px-2 py-0.5 rounded text-xs font-medium transition-colors"
                    >
                      Get a Lexie ID
                    </button>
                  )}
                </div>
                {/* Mobile controls under Lexie ID */}
                <div className="flex items-center gap-2 mt-2 sm:hidden">
                  <div className="relative" ref={mobileChainMenuRef}>
                    <button
                      onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsMobileChainMenuOpen((v) => !v); }}
                      className={`px-2 py-1 text-sm bg-black text-green-300 rounded border border-green-500/40 hover:border-emerald-400 ${(!canUseRailgun || !railgunWalletId) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title={(!canUseRailgun || !railgunWalletId) ? 'Waiting for vault engine to initialize' : 'Select network'}
                      aria-disabled={!canUseRailgun || !railgunWalletId}
                    >
                      {supportedNetworks.find(n => n.id === chainId)?.name || 'Select'}
                      <span className="ml-1">▾</span>
                    </button>
                    {isMobileChainMenuOpen && (
                      <div className="absolute mt-1 left-0 w-40 bg-black text-green-300 border border-green-500/40 rounded shadow-xl overflow-hidden z-50">
                        {supportedNetworks.map((net) => (
                          <button
                            key={net.id}
                            onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsMobileChainMenuOpen(false); handleNetworkSwitch(net.id); }}
                            className={`w-full text-left px-3 py-2 ${(!canUseRailgun || !railgunWalletId) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-900/30 focus:bg-emerald-900/30'} focus:outline-none`}
                            title={(!canUseRailgun || !railgunWalletId) ? 'Waiting for vault engine to initialize' : `Switch to ${net.name}`}
                            aria-disabled={!canUseRailgun || !railgunWalletId}
                          >
                            {net.name}
                          </button>
                        ))}
                        <div className="h-[1px] bg-green-500/40" />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="bg-black hover:bg-red-900/30 text-red-300 px-3 py-1 rounded text-sm border border-red-500/40"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
              {/* Desktop controls in original position */}
              <div className="hidden sm:flex items-center space-x-3">
              <div className="relative" ref={chainMenuRef}>
                <button
                  onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsChainMenuOpen((v) => !v); }}
                  className={`px-2 py-1 text-sm bg-black text-green-300 rounded border border-green-500/40 hover:border-emerald-400 ${(!canUseRailgun || !railgunWalletId) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={(!canUseRailgun || !railgunWalletId) ? 'Waiting for vault engine to initialize' : 'Select network'}
                  aria-disabled={!canUseRailgun || !railgunWalletId}
                >
                  {supportedNetworks.find(n => n.id === chainId)?.name || 'Select'}
                  <span className="ml-1">▾</span>
                </button>
                {isChainMenuOpen && (
                  <div className="absolute mt-1 left-0 w-40 bg-black text-green-300 border border-green-500/40 rounded shadow-xl overflow-hidden z-50">
                    {supportedNetworks.map((net) => (
                      <button
                        key={net.id}
                        onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsChainMenuOpen(false); handleNetworkSwitch(net.id); }}
                        className={`w-full text-left px-3 py-2 ${(!canUseRailgun || !railgunWalletId) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-900/30 focus:bg-emerald-900/30'} focus:outline-none`}
                        title={(!canUseRailgun || !railgunWalletId) ? 'Waiting for vault engine to initialize' : `Switch to ${net.name}`}
                        aria-disabled={!canUseRailgun || !railgunWalletId}
                      >
                        {net.name}
                      </button>
                    ))}
                    <div className="h-[1px] bg-green-500/40" />
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                  className="bg-black hover:bg-red-900/30 text-red-300 px-3 py-1 rounded text-sm border border-red-500/40"
              >
                Disconnect
              </button>
          </div>
        </div>

            {/* Transaction Lock Status */}
            {isTransactionLocked && (
              <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/40 rounded-lg">
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
                  <div>
                    <div className="text-yellow-300 text-sm font-medium">Transaction in Progress</div>
                    <div className="text-yellow-300/80 text-xs">Please wait for balance updates to complete. This may take a few seconds.</div>
                  </div>
                </div>
                <div className="mt-2 text-yellow-300/80 text-xs">
                While you're waiting check out Lexie on <a href="https://t.me/lexie_crypto_bot" className="text-purple-300 hover:underline" target="_blank" rel="noopener noreferrer">Telegram</a> to grab your Lexie ID and play our Titans game to earn airdrop points. 
                </div>
              </div>
            )}

            {/* Boot log */}
            <div className="mb-6">
              <div className="text-xs text-green-400/60 tracking-wide mb-3">LEXIEAI SYSTEM BOOT v2.1.3</div>
              <div className="space-y-1 text-green-300/80 text-xs leading-5 font-mono">
                <div>✓ Vault interface loaded</div>
                <div>✓ Network: {network?.name || 'Unknown'}</div>
                <div>✓ Public balances: {Array.isArray(publicBalances) ? publicBalances.length : 0}</div>
                <div>✓ Vault balances: {Array.isArray(privateBalances) ? privateBalances.length : 0}</div>
                <div>{canUseRailgun ? '✓ Secure vault online' : '… Initializing secure vault'}</div>
                <div className="pt-1 text-emerald-300">Ready for commands...</div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-teal-500/10 my-6"></div>

            {/* Command Panel */}
            <div className="mb-6">
              <div className="text-xs text-green-400/60 mb-3 font-mono">LEXIE TERMINAL • commands</div>
              <div className="flex flex-wrap gap-2 mb-2">
                  <button
                  onClick={refreshBalances}
                  disabled={isLoading || !isConnected || isTransactionLocked}
                  className="px-2 py-1 rounded border border-emerald-400/40 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                >
                  refresh
                  </button>
                    <button
                  onClick={() => setSelectedView('balances')}
                  disabled={isTransactionLocked}
                  className="px-2 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                >
                  balances
                    </button>
                    <button
                  onClick={() => {
                    setActiveAction('shield');
                    setSelectedView('privacy');
                  }}
                  disabled={isTransactionLocked}
                  className="px-2 py-1 rounded border border-purple-300/50 bg-purple-300/10 hover:bg-purple-300/20 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                >
                  add
                    </button>
                    <button
                onClick={() => {
                  setActiveAction('receive');
                  setSelectedView('privacy');
                }}
                disabled={isTransactionLocked}
                className="px-2 py-1 rounded border border-blue-400/40 bg-blue-900/20 hover:bg-blue-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
              >
                receive
              </button>
              <button
                  onClick={() => {
                    setActiveAction('transfer');
                    setSelectedView('privacy');
                  }}
                  disabled={isTransactionLocked}
                  className="px-2 py-1 rounded border border-cyan-400/40 bg-cyan-900/20 hover:bg-cyan-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                >
                  send
              </button>
              <button
                  onClick={() => {
                    setActiveAction('unshield');
                    setSelectedView('privacy');
                  }}
                  disabled={isTransactionLocked}
                  className="px-2 py-1 rounded border border-amber-400/40 bg-amber-900/20 hover:bg-amber-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                >
                  remove
              </button>
              <button
                onClick={() => setSelectedView('history')}
                disabled={isTransactionLocked}
                  className="px-2 py-1 rounded border border-purple-400/40 bg-purple-900/20 hover:bg-purple-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                >
                  history
              </button>
          </div>
        </div>

            {/* Divider */}
            <div className="border-t border-teal-500/10 my-6"></div>

            {/* Wallet Balances */}
            {selectedView === 'balances' && (
              <>
                {/* Private Balances */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-emerald-300 text-sm font-medium font-mono">{network?.name || 'Network'} Vault Balances</div>
                    <div className="flex items-center space-x-2">
                      {canUseRailgun && privateBalances.length > 0 && (
                        <button
                          onClick={() => setShowPrivateBalances(!showPrivateBalances)}
                          className={`px-2 py-0.5 rounded text-xs border ${
                            showPrivateBalances 
                              ? 'bg-emerald-600/30 text-emerald-200 border-emerald-400/40' 
                              : 'bg-black text-green-300 hover:bg-green-900/20 border-green-500/40'
                          }`}
                        >
                          {showPrivateBalances ? 'Hide' : 'Show'}
                        </button>
                      )}
              </div>
            </div>

                  {isRefreshingBalances && (
                    <div className="mb-3 flex items-center gap-2 text-sm text-green-300">
                      <div className="h-4 w-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                      Getting your vault balances...
                    </div>
                  )}

                  {!canUseRailgun ? (
                    <div className="text-center py-4 text-green-400/70 text-xs">
                      Secure vault engine not ready
                  </div>
                  ) : isPrivateBalancesLoading ? (
                    <div className="text-center py-4 text-green-300 text-xs">Getting your vault balances...</div>
                  ) : privateBalances.length === 0 ? (
                    <div className="text-center py-4 text-green-300 text-xs">
                      No vault tokens yet
                      <div className="text-green-400/70 mt-1">Add some tokens to start using secure vault</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-green-200 text-xs">
                        {privateBalances.length} Vault Token{privateBalances.length !== 1 ? 's' : ''}
              </div>

                      {(showPrivateBalances || privateBalances.length <= 3) && 
                        privateBalances.map((token) => (
                          <div key={token.symbol} className="p-2 bg-black/60 rounded text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <div className="text-green-200 font-medium">{token.symbol}</div>
                              <div className="text-green-400/70">• {token.name || `${token.symbol} Token`}</div>
                            </div>
                            <div className="text-green-200">{Number(token.numericBalance).toFixed(6).replace(/\.?0+$/, '')}</div>
                          </div>
                          {token.balanceUSD !== undefined && (
                            <div className="text-right text-green-400/70 mt-1">${typeof token.balanceUSD === 'string' && token.balanceUSD.startsWith('$') ? token.balanceUSD.substring(1) : token.balanceUSD}</div>
                          )}
                        </div>
                        ))
                      }

                      {!showPrivateBalances && privateBalances.length > 3 && (
                        <div className="text-center py-2">
                  <button
                            onClick={() => setShowPrivateBalances(true)}
                            className="text-emerald-300 hover:text-emerald-200 text-xs"
                  >
                            Show {privateBalances.length - 3} more vault tokens
                  </button>
                        </div>
                      )}
              </div>
                  )}
            </div>

                {/* Public Balances */}
                <div className="border-t border-teal-500/10 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-emerald-300 text-sm font-medium font-mono">Public Balances</div>
                    <button
                      onClick={refreshBalances}
                      disabled={isLoading || !isConnected}
                      className="text-emerald-400 hover:text-emerald-300 text-xs disabled:opacity-50"
                    >
                      {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
                
                  <div className="space-y-2">
                    {publicBalances.map((token) => {
                      const isSupported = isTokenSupportedByRailgun(token.address, chainId);
                      const isShieldingThis = shieldingTokens.has(token.symbol);
                      
                      return (
                        <div key={token.symbol} className="p-2 bg-black/60 rounded text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2 min-w-0">
                              <div className="text-green-200 font-medium">{token.symbol}</div>
                              <div className="text-green-400/70 truncate">• {token.name || `${token.symbol} Token`}</div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <div className="text-green-200">{Number(token.numericBalance).toFixed(6).replace(/\.?0+$/, '')}</div>
                            </div>
                          </div>
                          <div className="text-right text-green-400/70 mt-1">${typeof token.balanceUSD === 'string' && token.balanceUSD.startsWith('$') ? token.balanceUSD.substring(1) : token.balanceUSD}</div>
                        </div>
                      );
                    })}
                    
                    {publicBalances.length === 0 && !isLoading && (
                      <div className="text-center py-4 text-green-400/70 text-xs">No tokens found</div>
                    )}
                  </div>
                </div>
              </>
            )}

                        {/* Privacy Actions */}
            {selectedView === 'privacy' && (
              <PrivacyActions activeAction={activeAction} isRefreshingBalances={isRefreshingBalances} />
            )}

            {/* Transaction History */}
            {selectedView === 'history' && (
              <div className="border-t border-teal-500/10 pt-6">
                <div className="text-emerald-300 text-sm font-medium font-mono mb-4">Transaction History</div>
                <TransactionHistory />
              </div>
            )}

          </div>
        </TerminalWindow>
                
        {/* Error Messages */}
        {balanceErrors && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/40 rounded-lg">
            <p className="text-red-300 text-sm">Balance error: {balanceErrors}</p>
                    </div>
        )}

        {/* Last Update Time */}
        {lastUpdateTime && (
          <div className="mt-6 text-center">
            <p className="text-green-500/70 text-xs font-mono">
              Last updated: {new Date(lastUpdateTime).toLocaleTimeString()}
            </p>
                        </div>
        )}

                    </div>

      {/* Lexie ID Modal */}
      {showLexieModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 font-mono">
          <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden">
            {/* Modal Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                            </div>
                <span className="text-sm tracking-wide text-gray-400">lexie-id-setup</span>
                            </div>
                            <button
                onClick={() => {
                  setShowLexieModal(false);
                  setLexieNeedsCode(false);
                  setLexieCode('');
                  setLexieMessage('');
                  setLexieIdInput('');
                }}
                className="text-green-400/70 hover:text-green-300 transition-colors"
              >
                ✕
                            </button>
                      </div>

            {/* Modal Content */}
            <div className="p-6 text-green-300 space-y-4">
                              <div>
                <h3 className="text-lg font-bold text-emerald-300 mb-2">Get Your Lexie ID</h3>
                <p className="text-green-400/80 text-sm">
                  Link your Railgun wallet to a Lexie ID for easy identification and social features.
                </p>
                              </div>

              {canUseRailgun && railgunAddress ? (
                <div className="space-y-4">
                  <div className="bg-black/40 border border-green-500/20 rounded p-3">
                    <div className="text-green-400/80 text-xs mb-2">Enter your Lexie ID:</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={lexieIdInput}
                        onChange={(e) => setLexieIdInput(e.target.value)}
                        placeholder="e.g. LexieLaine123"
                        className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none flex-1"
                        disabled={lexieLinking}
                      />
                      {!lexieNeedsCode ? (
                          <button
                          onClick={async () => {
                            try {
                              setLexieMessage('');
                              setLexieLinking(true);
                              const chosen = (lexieIdInput || '').trim().toLowerCase();
                              if (!chosen || chosen.length < 3) {
                                setLexieMessage('Please enter a valid Lexie ID (3-20 chars).');
                                setLexieLinking(false);
                                return;
                              }
                              // Check status
                              const statusResp = await fetch(`/api/wallet-metadata?action=lexie-status&lexieID=${encodeURIComponent(chosen)}`, { method: 'GET' });
                              if (!statusResp.ok) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                              const statusJson = await statusResp.json();
                              if (!statusJson.success) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                              const exists = !!statusJson.exists; const linked = !!statusJson.linked;
                              if (!exists) {
                                setLexieMessage('This Lexie ID does not exist yet. Please claim it via Telegram.');
                                setLexieLinking(false);
                                return;
                              }
                              if (linked) { setLexieMessage('This ID is taken. Please try another one.'); setLexieLinking(false); return; }
                              // Start linking
                              const startResp = await fetch('/api/wallet-metadata?action=lexie-link-start', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lexieID: chosen, railgunAddress })
                              });
                              const startJson = await startResp.json().catch(() => ({}));
                              if (startResp.status === 404) { setLexieMessage('Lexie ID not found. Please claim it via Telegram.'); setLexieLinking(false); return; }
                              if (!startResp.ok || !startJson.success) { setLexieMessage('Failed to start verification.'); setLexieLinking(false); return; }
                              setLexieNeedsCode(true); setLexieMessage('We sent a 4‑digit code to your Telegram. Enter it below to confirm.');
                            } catch (_) { setLexieMessage('Unexpected error starting Lexie link.'); } finally { setLexieLinking(false); }
                          }}
                          disabled={lexieLinking || !lexieIdInput}
                          className="bg-emerald-600/30 hover:bg-emerald-600/50 disabled:bg-black/40 text-emerald-200 px-3 py-1 rounded text-sm border border-emerald-400/40"
                        >
                          {lexieLinking ? 'Working...' : 'Add'}
                          </button>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={lexieCode}
                            onChange={(e) => setLexieCode(e.target.value)}
                            placeholder="4-digit code"
                            className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none w-20"
                            disabled={lexieLinking}
                          />
                            <button
                            onClick={async () => {
                              try {
                                setLexieLinking(true); setLexieMessage('');
                                const chosen = (lexieIdInput || '').trim().toLowerCase();
                                const verifyResp = await fetch('/api/wallet-metadata?action=lexie-link-verify', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ lexieID: chosen, code: (lexieCode || '').trim() })
                                });
                                const json = await verifyResp.json().catch(() => ({}));
                                if (!verifyResp.ok || !json.success) { setLexieMessage('Verification failed. Check the code and try again.'); return; }
                                setLexieNeedsCode(false); setLexieCode(''); setLexieMessage('✅ Linked successfully to your Railgun wallet.');
                                setCurrentLexieId(chosen);
                                setTimeout(() => {
                                  setShowLexieModal(false);
                                  setLexieIdInput('');
                                  setLexieMessage('');
                                }, 2000);
                              } catch (_) { setLexieMessage('Unexpected verification error.'); } finally { setLexieLinking(false); }
                            }}
                            disabled={lexieLinking || !lexieCode}
                            className="bg-green-600/30 hover:bg-green-600/50 disabled:bg-black/40 text-green-200 px-2 py-1 rounded text-sm border border-green-400/40"
                          >
                            Verify
                            </button>
                            <button
                            onClick={() => { setLexieNeedsCode(false); setLexieCode(''); setLexieMessage(''); }}
                            className="bg-gray-600/30 hover:bg-gray-500/30 text-gray-300 px-2 py-1 rounded text-sm border border-gray-500/40"
                          >
                            Cancel
                            </button>
                          </div>
                      )}
                        </div>
                    {lexieMessage && <div className="mt-2 text-xs text-green-300/80">{lexieMessage}</div>}
                      </div>

                  {/* Instructions */}
                  <div className="bg-purple-900/20 border border-purple-500/40 rounded p-3">
                    <div className="text-purple-300 text-xs font-medium mb-2">Don't have a Lexie ID?</div>
                    <p className="text-purple-200/80 text-xs mb-3">
                      Check Lexie on Telegram to claim your unique Lexie ID:
                    </p>
                    <div className="flex items-center space-x-2">
                      <a
                        href="https://t.me/lexie_crypto_bot"
                        target="_blank"
                        rel="noreferrer"
                        className="bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 px-3 py-1 rounded text-xs border border-purple-400/40 transition-colors"
                      >
                        Open Telegram Bot
                      </a>
                      <span className="text-purple-300/60 text-xs">→ Use /lex command</span>
                    </div>
                </div>
              </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-500/40 rounded p-3">
                  <div className="text-yellow-300 text-xs">
                    Please connect your Railgun wallet first to link a Lexie ID.
            </div>
          </div>
        )}
          </div>
          </div>
          </div>
        )}

      {/* Signature Guide Popup */}
      {showSignatureGuide && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="bg-purple-100 dark:bg-purple-900 rounded-full p-2">
                  <ShieldCheckIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Enable Privacy Features</h3>
              </div>
              <button
                onClick={() => setShowSignatureGuide(false)}
                className="text-gray-400 hover:text-gray-300 transition-colors"
              >
                <XCircleIcon className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-gray-300">
                To unlock Railgun's privacy features, you'll need to sign a message in your wallet. This creates a secure, privacy shield that enables private token balances and transactions.
              </p>
              
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                <p className="text-blue-300 text-sm">
                  <strong>Note:</strong> This signature doesn't cost gas fees and only needs to be done once per wallet.
                </p>
              </div>
              
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => {
                    setShowSignatureGuide(false);
                    // The signature will be automatically triggered by WalletContext
                    toast.success('Look for the signature request in your wallet!');
                  }}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sign-in & Initialization Popup (terminal style; locked until completed) */}
      {showSignRequestPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50 p-4 font-mono">
          <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-sm tracking-wide text-gray-400">vault-sign</span>
              </div>
              {/* No close button until init completes */}
              {isInitInProgress ? (
                <div className="text-yellow-400 text-xs">LOCKED</div>
              ) : null}
            </div>
            <div className="p-6 text-green-300 space-y-4">
              {!isInitInProgress && initProgress.percent < 100 && !initFailedMessage ? (
                <>
                  <h3 className="text-lg font-bold text-emerald-300">Sign to Create Your LexieVault</h3>
                  <p className="text-green-400/80 text-sm">
                    A signature request was sent to your wallet. Please approve this message to begin creating your LexieVault.
                  </p>
                  <div className="bg-black/40 border border-green-500/20 rounded p-3 text-xs">
                    <div>Message preview:</div>
                    <pre className="mt-2 whitespace-pre-wrap text-green-200">LexieVault Creation Address: {address}. Sign this message to create your LexieVault.</pre>
                  </div>
                </>
              ) : initFailedMessage ? (
                <>
                  <h3 className="text-lg font-bold text-red-300">Vault Initialization Failed</h3>
                  <p className="text-red-300/80 text-sm">{initFailedMessage}</p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-emerald-300">Initializing Your LexieVault on {network?.name || 'network'} Network</h3>
                  <p className="text-green-400/80 text-sm">You only need to do this once. This may take a few minutes. Do not close this window.</p>
                  <div className="bg-black/40 border border-green-500/20 rounded p-4 flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full border-2 ${isInitInProgress ? 'border-emerald-400 border-t-transparent animate-spin' : 'border-emerald-400'}`} />
                    <div className="text-xs text-green-400/80 truncate" title={initProgress.message}>
                      {initProgress.message || 'Scanning...'}
                    </div>
                  </div>
                  <div className="mt-2 text-green-400/80 text-xs">
                  While you're waiting check out Lexie on <a href="https://t.me/lexie_crypto_bot" className="text-purple-300 hover:underline" target="_blank" rel="noopener noreferrer">Telegram</a> to grab your Lexie ID and play our Titans game to earn airdrop points. 
                  </div>
                </>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                {!isInitInProgress && initProgress.percent >= 100 && !initFailedMessage ? (
                  <button
                    onClick={() => setShowSignRequestPopup(false)}
                    className="px-3 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 text-xs"
                  >
                    ×
                  </button>
                ) : initFailedMessage ? (
                  <button
                    onClick={() => setShowSignRequestPopup(false)}
                    className="px-3 py-1 rounded border border-red-500/40 bg-black hover:bg-red-900/20 text-xs text-red-300"
                  >
                    Dismiss
                  </button>
                ) : (
                  <button
                    disabled
                    className="px-3 py-1 rounded border border-green-500/40 bg-black/40 text-xs text-green-400/60 cursor-not-allowed"
                  >
                    Please wait…
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const VaultDesktop = () => {
  const [isMobile, setIsMobile] = React.useState(false);
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      setIsReady(true);
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); setIsReady(true); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  if (!isReady) return null;

  if (isMobile) {
    return (
      <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
        <nav className="sticky top-0 z-40 w-full p-6 bg-black">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="text-4xl font-bold text-purple-300">LEXIEAI</div>
          </div>
        </nav>
        <div className="flex items-center justify-center px-6 py-16">
          <div className="max-w-md w-full text-center font-mono text-green-300">
            <div className="text-lg text-green-200 mb-2">Not available on mobile yet…</div>
            <div className="text-green-400/80 text-sm">Please open this page on a desktop to access LexieVault.</div>
          </div>
        </div>
      </div>
    );
  }

  return <VaultDesktopInner />;
};

export default VaultDesktop; 