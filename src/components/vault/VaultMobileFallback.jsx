import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import useInjectedProviders from '../../hooks/useInjectedProviders';
import PrivacyActions from '../PrivacyActions';
import TransactionHistory from '../TransactionHistory';
import InjectedProviderButtons from '../InjectedProviderButtons.jsx';
import {
  shieldTokens,
  parseTokenAmount,
  isTokenSupportedByRailgun,
} from '../../utils/railgun/actions';

// Load Eruda for mobile debugging
const loadEruda = async () => {
  if (typeof window !== 'undefined' && !window.eruda) {
    try {
      // Load Eruda script
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.onload = () => {
        if (window.eruda) {
          window.eruda.init();
          window.eruda.hide();
        }
      };
      document.head.appendChild(script);
    } catch (error) {
      console.warn('Failed to load Eruda:', error);
    }
  }
};

const toggleEruda = () => {
  if (window.eruda) {
    if (window.eruda._isShow) {
      window.eruda.hide();
    } else {
      window.eruda.show();
    }
  } else {
    loadEruda().then(() => {
      if (window.eruda) {
        window.eruda.show();
      }
    });
  }
};

// Mobile Vault Component - Full desktop functionality adapted for mobile
const MobileVault = () => {
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
    walletProvider,
    checkChainReady,
    walletConnectValidating,
    shouldShowLexieIdModal,
    clearLexieIdModalFlag,
    showLexieIdChoiceModal,
    handleLexieIdChoice,
    onLexieIdLinked,
    ensureChainScanned,
  } = useWallet();

  // Window management hooks
  const footerContent = useMemo(() => <span>Process: lexie-vault</span>, []);

  // Memoize status values to prevent re-mounting
  const statusConfig = useMemo(() => ({
    statusLabel: canUseRailgun ? 'ONLINE' : 'WAITING',
    statusTone: canUseRailgun ? 'online' : 'waiting'
  }), [canUseRailgun]);

  const { providers } = useInjectedProviders();

  const {
    publicBalances,
    privateBalances,
    loading: isLoading,
    error: balanceErrors,
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    lastUpdateTime,
    loadPrivateBalancesFromMetadata,
    isPrivateBalancesLoading,
  } = useBalances();

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [selectedView, setSelectedView] = useState('balances');
  const [activeAction, setActiveAction] = useState('shield');
  const [showPrivateBalances, setShowPrivateBalances] = useState(false);
  const [isShielding, setIsShielding] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
  const [activeTransactionMonitors, setActiveTransactionMonitors] = useState(0);
  const [shieldingTokens, setShieldingTokens] = useState(new Set());
  const [shieldAmounts, setShieldAmounts] = useState({});
  const [showSignRequestPopup, setShowSignRequestPopup] = useState(false);
  const [initProgress, setInitProgress] = useState({ percent: 0, message: '' });
  const [isInitInProgress, setIsInitInProgress] = useState(false);
  const [initFailedMessage, setInitFailedMessage] = useState('');
  const [bootstrapProgress, setBootstrapProgress] = useState({ percent: 0, active: false });
  const bootstrapLockedRef = useRef(false); // Prevents progress from resetting below 100% once reached

  // Lexie ID linking state
  const [lexieIdInput, setLexieIdInput] = useState('');
  const [lexieLinking, setLexieLinking] = useState(false);
  const [lexieCode, setLexieCode] = useState('');
  const [lexieNeedsCode, setLexieNeedsCode] = useState(false);
  const [lexieMessage, setLexieMessage] = useState('');
  const [showLexieModal, setShowLexieModal] = useState(false);
  const [currentLexieId, setCurrentLexieId] = useState('');
  const [pointsBalance, setPointsBalance] = useState(null);
  const [pointsBreakdown, setPointsBreakdown] = useState(null);
  const [showTitansGame, setShowTitansGame] = useState(false);
  const [showLexieChat, setShowLexieChat] = useState(false);

  // Handle LexieID linking and game opening
  const handleLexieIdLink = useCallback((lexieId, autoOpenGame = false) => {
    setCurrentLexieId(lexieId);
    // Set localStorage for Titans game integration
    if (lexieId && address) {
      localStorage.setItem("connectedWallet", address.toLowerCase());
      localStorage.setItem("linkedLexieId", lexieId);
      console.log('[Vault] Set localStorage for Titans integration:', { address: address.toLowerCase(), lexieId });
    } else if (!lexieId) {
      // Clear localStorage when unlinking
      localStorage.removeItem("connectedWallet");
      localStorage.removeItem("linkedLexieId");
    }
    // Auto-open Titans game only when explicitly requested (when user chooses LexieID)
    if (lexieId && autoOpenGame) {
      setTimeout(() => {
        setShowTitansGame(true);
        // Signal to WalletContext that Lexie ID linking is complete
        onLexieIdLinked();
      }, 1000); // Small delay to allow UI to settle
    } else {
      // Signal completion without auto-opening game
      onLexieIdLinked();
    }
  }, [address, onLexieIdLinked]);

  // Cross-platform verification state
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationLexieId, setVerificationLexieId] = useState('');
  const [verificationExpiresAt, setVerificationExpiresAt] = useState(0);
  const [verificationTimeLeft, setVerificationTimeLeft] = useState(0);

  // Local state to show a refreshing indicator for Vault Balances
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);

  // Chain readiness state
  const [isChainReady, setIsChainReady] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);

  const network = getCurrentNetwork();

  // Supported networks array
  const supportedNetworks = [
    { id: 1, name: 'Ethereum', symbol: 'ETH' },
    { id: 137, name: 'Polygon', symbol: 'MATIC' },
    { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
    { id: 56, name: 'BNB Chain', symbol: 'BNB' },
  ];

  // Check if current network is supported
  const isNetworkSupported = chainId && supportedNetworks.some(net => net.id === chainId);

  // Track if we were just disconnected due to unsupported network
  const [wasDisconnectedForUnsupportedNetwork, setWasDisconnectedForUnsupportedNetwork] = useState(false);

  // Reset the unsupported network flag when we reconnect
  useEffect(() => {
    if (isConnected) {
      setWasDisconnectedForUnsupportedNetwork(false);
    }
  }, [isConnected]);

  // Listen for WalletConnect disconnect events due to unsupported network
  useEffect(() => {
    const handleUnsupportedNetworkDisconnect = () => {
      setWasDisconnectedForUnsupportedNetwork(true);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('walletconnect-unsupported-network', handleUnsupportedNetworkDisconnect);
      return () => window.removeEventListener('walletconnect-unsupported-network', handleUnsupportedNetworkDisconnect);
    }
  }, []);

  // Chain menu state
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

  // Simple Redis check for scanned chains (exact EOA address, no normalization)
  const checkRedisScannedChains = useCallback(async (targetChainId = null) => {
    if (!address || !railgunWalletId) return null;

    const checkChainId = targetChainId || chainId;
    if (!checkChainId) return null;

    try {
      console.log('[VaultDesktop] Checking Redis hydratedChains/scannedChains for:', {
        address, // exact EOA address
        railgunWalletId,
        checkChainId: Number(checkChainId)
      });

      // Use exact EOA address as provided - no normalization
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);

      if (response.status === 404) {
        console.log('[VaultDesktop] No wallet metadata in Redis - needs initialization');
        return false;
      }

      if (!response.ok) {
        console.warn('[VaultDesktop] Redis check failed:', response.status);
        return null;
      }

      const data = await response.json();
      const walletKeys = Array.isArray(data.keys) ? data.keys : [];

      // Use same logic as ensureChainScanned - find key by walletId only (EOA check via API)
      const matchingKey = walletKeys.find(key => key.walletId === railgunWalletId) || null;

      if (!matchingKey) {
        console.log('[VaultDesktop] No matching wallet key found in Redis');
        return false;
      }

      // Check both hydratedChains and scannedChains arrays
      const hydratedChains = Array.isArray(matchingKey?.hydratedChains)
        ? matchingKey.hydratedChains
        : (Array.isArray(matchingKey?.meta?.hydratedChains) ? matchingKey.meta.hydratedChains : []);

      const scannedChains = Array.isArray(matchingKey?.scannedChains)
        ? matchingKey.scannedChains
        : (Array.isArray(matchingKey?.meta?.scannedChains) ? matchingKey.meta.scannedChains : []);

      const normalizedHydratedChains = hydratedChains
        .map(n => (typeof n === 'string' && n?.startsWith?.('0x') ? parseInt(n, 16) : Number(n)))
        .filter(n => Number.isFinite(n));

      const normalizedScannedChains = scannedChains
        .map(n => (typeof n === 'string' && n?.startsWith?.('0x') ? parseInt(n, 16) : Number(n)))
        .filter(n => Number.isFinite(n));

      const isChainHydrated = normalizedHydratedChains.includes(Number(checkChainId));
      const isChainScanned = normalizedScannedChains.includes(Number(checkChainId));
      const isChainReady = isChainHydrated || isChainScanned;

      console.log('[VaultDesktop] Redis check result:', {
        chainId: Number(checkChainId),
        hydratedChains: normalizedHydratedChains,
        scannedChains: normalizedScannedChains,
        isChainHydrated,
        isChainScanned,
        isChainReady
      });

      return isChainReady;

    } catch (error) {
      console.error('[VaultDesktop] Redis check error:', error);
      return null;
    }
  }, [address, railgunWalletId, chainId]);

  // Remove the complex modal gating logic - we'll use the same approach as old WalletPage

  // Helper function to get network name
  const getNetworkName = (id) => {
    const networks = {
      1: 'Ethereum',
      42161: 'Arbitrum',
      137: 'Polygon',
      56: 'BNB Chain'
    };
    return networks[id] || `Chain ${id}`;
  };

  // Check Redis on wallet connect - wait for Railgun initialization to complete first
  useEffect(() => {
    if (isConnected && address && railgunWalletId && chainId && isRailgunInitialized) {
      console.log('[VaultDesktop] Wallet connected and Railgun initialized - checking Redis for scanned chains');
      (async () => {
        // Don't re-init if modal is already open
        if (showSignRequestPopup) {
          console.log('[VaultDesktop] Modal already open, skipping Redis check');
          return;
        }

        // Retry Redis check with backoff to handle race with metadata writes
        let scanned = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          scanned = await checkRedisScannedChains();
          if (scanned !== null) break; // Got a definitive answer
          if (attempt < 3) {
            console.log(`[VaultDesktop] Redis check attempt ${attempt} returned null, retrying in 300ms...`);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        if (scanned === false || scanned === null) {
          console.log('[VaultDesktop] Chain not scanned on connect - showing modal');
          setShowSignRequestPopup(true);
          setIsInitInProgress(true);
          setBootstrapProgress(prev => prev.percent < 100 ? { percent: 0, active: true } : prev);
          setScanComplete(false);
          const networkName = getNetworkName(chainId);
          setInitProgress({
            percent: 0,
            message: `Setting up your LexieVault on ${networkName} Network...`
          });
        } else {
          console.log('[VaultDesktop] Chain already scanned on connect - no modal needed');
        }
      })();
    }
  }, [isConnected, address, railgunWalletId, chainId, isRailgunInitialized, checkRedisScannedChains, showSignRequestPopup]);

  // Track when initial connection hydration is complete
  const initialConnectDoneRef = React.useRef(false);

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

  // Reset modal state when address changes
  useEffect(() => {
    setShowSignRequestPopup(false);
    setIsInitInProgress(false);
    setInitFailedMessage('');
    setInitProgress({ percent: 0, message: '' });
  }, [address]);

  // Update chain readiness
  useEffect(() => {
    let mounted = true;
    (async () => {
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
  }, [canUseRailgun, railgunWalletId, address, chainId, checkChainReady]);

  // Disconnect handler
  const handleDisconnect = useCallback(async () => {
    try {
      // Unload all Railgun wallets/state before disconnecting
      try {
        const { clearAllWallets } = await import('../../utils/railgun/wallet');
        const clearWallets = await clearAllWallets();
      } catch {}
      // Clear per-address guide flag
      if (address) {
        try {
          localStorage.removeItem(`railgun-guide-seen-${address.toLowerCase()}`);
        } catch {}
      }

      // Clear session flags
      try { sessionStorage.clear(); } catch {}

      // Reset local UI state
      handleLexieIdLink(''); // This will clear localStorage
      setPointsBalance(null);
      setPointsBreakdown(null);
      setShowSignRequestPopup(false);
      setIsInitInProgress(false);
      setInitFailedMessage('');
      setInitProgress({ percent: 0, message: '' });

      // Dispatch transaction completion event to unlock UI globally (similar to txn cancellation)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
          detail: {
            transactionType: 'disconnect',
            found: false, // Disconnect cancelled any ongoing processes
            elapsedTime: 0,
            error: 'User disconnected'
          }
        }));

        // Dispatch abort-all-requests event to cancel any ongoing processes
        window.dispatchEvent(new CustomEvent('abort-all-requests'));
      }
    } finally {
      try {
        await disconnectWallet();
        // Auto-refresh page to ensure clean state after disconnect
        if (typeof window !== 'undefined') {
          console.log('[VaultDesktop] Auto-refreshing page after disconnect for clean state');
          window.location.reload();
        }
      } catch {}
    }
  }, [address, disconnectWallet]);

  // Listen for transaction lock/unlock events
  useEffect(() => {
    const handleTransactionStart = () => {
      console.log('[VaultDesktop] Transaction started, locking UI');
      setIsTransactionLocked(true);
      setActiveTransactionMonitors(prev => prev + 1);
    };

    const handleTransactionComplete = () => {
      console.log('[VaultDesktop] Transaction form reset completed');
    };

    const handleTransactionMonitorComplete = (event) => {
      const { transactionType, found, elapsedTime } = event.detail;
      console.log(`[VaultDesktop] Transaction monitor completed for ${transactionType} (${found ? 'found' : 'timeout'}) in ${elapsedTime/1000}s`);

      setActiveTransactionMonitors(prev => {
        const newCount = prev - 1;
        if (newCount === 0) {
          console.log('[VaultDesktop] All transaction monitors completed, unlocking UI');
          setIsTransactionLocked(false);
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
            fetch(`/api/wallet-metadata?action=rewards-balance&lexieId=${encodeURIComponent(currentLexieId)}`)
              .then(res => res.json())
              .then(b => {
                if (b?.success && typeof b.balance === 'number') setPointsBalance(b.balance);
              }).catch(() => {});
          }
        }).catch(() => {});
      } catch {}
    };

    const handleBalanceUpdateComplete = (event) => {
      console.log('[VaultDesktop] Balance update completed (backup unlock)');
      setIsTransactionLocked(false);
      setActiveTransactionMonitors(0);
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
  }, [currentLexieId]);

  // Event listeners for vault balance refresh state
  useEffect(() => {
    const onPrivateStart = () => {
      console.log('[VaultDesktop] Private balances refresh started - showing spinner');
      setIsRefreshingBalances(true);
    };
    const onPrivateComplete = () => {
      console.log('[VaultDesktop] Private balances refresh completed - hiding spinner');
      setIsRefreshingBalances(false);
    };
    window.addEventListener('vault-private-refresh-start', onPrivateStart);
    window.addEventListener('vault-private-refresh-complete', onPrivateComplete);
    return () => {
      window.removeEventListener('vault-private-refresh-start', onPrivateStart);
      window.removeEventListener('vault-private-refresh-complete', onPrivateComplete);
    };
  }, []);

  // Full refresh: SDK refresh + Redis persist, then UI reload
  const refreshBalances = useCallback(async (showToast = true) => {
    try {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-start')); } catch {}
      console.log('[VaultDesktop] Full refresh — SDK refresh + Redis persist, then UI fetch...');

      // Step 0: Ensure chain has been scanned for private transfers (critical for discovering transfers before first shield)
      try {
        if (canUseRailgun && railgunWalletId && address && chainId) {
          console.log('[VaultDesktop] Ensuring chain is scanned before refresh...');
          await ensureChainScanned(chainId);
        }
      } catch (scanErr) {
        console.warn('[VaultDesktop] Chain scan check failed (continuing with refresh):', scanErr?.message);
      }

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
        console.warn('[VaultDesktop] SDK refresh + persist failed (continuing to UI refresh):', sdkErr?.message);
      }

      // Step 2: Refresh UI from sources of truth
      await refreshAllBalances();

      if (showToast) {
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
      }
    } catch (error) {
      console.error('[VaultDesktop] Full refresh failed:', error);
      if (showToast) {
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
      }
    } finally {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-complete')); } catch {}
    }
  }, [refreshAllBalances, railgunWalletId, address, chainId]);

  // Auto-refresh balances when wallet connects and Railgun is ready (full refresh including private transfers)
  useEffect(() => {
    if (isConnected && address && chainId && canUseRailgun && railgunWalletId) {
      console.log('[VaultDesktop] Wallet connected and Railgun ready - auto-refreshing balances...');
      refreshBalances(false); // Full refresh but no toast notification
    }
  }, [isConnected, address, chainId, canUseRailgun, railgunWalletId, refreshBalances]);

  // Auto-switch to privacy view when Railgun is ready
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      setShowPrivateMode(true);
    }
  }, [canUseRailgun, railgunWalletId]);

  // Re-check readiness immediately after scan completes
  useEffect(() => {
    const onScanComplete = () => {
      console.log('[VaultDesktop] Chain scanning completed - unlocking modal');
      setScanComplete(true);
      setIsInitInProgress(false); // Unlock modal now that scanning is complete
      setInitProgress({ percent: 100, message: 'Vault ready - initialization complete!' });
      setIsChainReady(false);
      checkChainReady().then((ready) => setIsChainReady(!!ready)).catch(() => setIsChainReady(false));
    };
    window.addEventListener('railgun-scan-complete', onScanComplete);
    return () => window.removeEventListener('railgun-scan-complete', onScanComplete);
  }, [checkChainReady]);

  // Fetch initial points when Lexie ID is available
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentLexieId || !isRailgunInitialized) {
        setPointsBalance(null);
        setPointsBreakdown(null);
        return;
      }
      try {
        // First get game points from titans-be via proxy with HMAC
        let gamePoints = 0;
        let referralPoints = 0;
        try {
          const titansResp = await fetch(`/api/wallet-metadata?action=get-game-points&lexieId=${encodeURIComponent(currentLexieId)}`);
          if (titansResp.ok) {
            const gameData = await titansResp.json().catch(() => ({}));
            gamePoints = Number(gameData.gamePoints) || 0;
            referralPoints = Number(gameData.referralPoints) || 0;
            console.log(`[VaultDesktop] ✅ Got game points for ${currentLexieId}: game=${gamePoints}, referral=${referralPoints}`);
          } else {
            console.log(`[VaultDesktop] ⚠️ Titans API proxy error for ${currentLexieId}: ${titansResp.status}`);
          }
        } catch (gameError) {
          console.warn(`[VaultDesktop] ⚠️ Failed to fetch game points for ${currentLexieId}:`, gameError?.message);
        }

        // Then combine with vault points via rewards API
        const resp = await fetch(`/api/wallet-metadata?action=rewards-combined-balance&lexieId=${encodeURIComponent(currentLexieId)}&gamePoints=${gamePoints}&referralPoints=${referralPoints}`);
        if (!cancelled && resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json?.success) {
            setPointsBalance(Number(json.total) || 0);
            setPointsBreakdown(json.breakdown);
          }
        }
      } catch (error) {
        console.error('[VaultDesktop] Error fetching combined points:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [currentLexieId, isRailgunInitialized]);

  // Listen for points update events
  useEffect(() => {
    const handlePointsUpdated = async () => {
      if (!currentLexieId) return;

      console.log('[VaultDesktop] 🔄 Refreshing points balance after award...');

      try {
        // First get fresh game points from titans-be via proxy with HMAC
        let gamePoints = 0;
        let referralPoints = 0;
        try {
          const titansResp = await fetch(`/api/wallet-metadata?action=get-game-points&lexieId=${encodeURIComponent(currentLexieId)}`);
          if (titansResp.ok) {
            const gameData = await titansResp.json().catch(() => ({}));
            gamePoints = Number(gameData.gamePoints) || 0;
            referralPoints = Number(gameData.referralPoints) || 0;
            console.log(`[VaultDesktop] 🔄 Refreshed game points for ${currentLexieId}: game=${gamePoints}, referral=${referralPoints}`);
          } else {
            console.log(`[VaultDesktop] ⚠️ Titans API proxy error during refresh for ${currentLexieId}: ${titansResp.status}`);
          }
        } catch (gameError) {
          console.warn(`[VaultDesktop] ⚠️ Failed to refresh game points for ${currentLexieId}:`, gameError?.message);
        }

        // Then combine with latest vault points via rewards API
        const resp = await fetch(`/api/wallet-metadata?action=rewards-combined-balance&lexieId=${encodeURIComponent(currentLexieId)}&gamePoints=${gamePoints}&referralPoints=${referralPoints}`);

        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json?.success) {
            const newBalance = Number(json.total) || 0;
            const previousBalance = pointsBalance;
            console.log('[VaultDesktop] ✅ Points balance updated:', newBalance);

            setPointsBalance(newBalance);
            setPointsBreakdown(json.breakdown);

            // Show success toast if points actually increased
            if (previousBalance !== null && newBalance > previousBalance) {
              try {
                toast.custom((t) => (
                  React.createElement(
                    'div',
                    {
                      className: `font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`,
                      style: { zIndex: 9999 }
                    },
                    React.createElement(
                      'div',
                      { className: 'rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl' },
                      React.createElement(
                        'div',
                        { className: 'px-4 py-3 flex items-center gap-3' },
                        [
                          React.createElement('div', { key: 'dot', className: 'h-3 w-3 rounded-full bg-emerald-400' }),
                          React.createElement(
                            'div',
                            { key: 'text' },
                            `Points updated! You now have ${newBalance} points`
                          ),
                          React.createElement(
                            'button',
                            {
                              key: 'close',
                              type: 'button',
                              'aria-label': 'Dismiss',
                              onClick: (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toast.dismiss(t.id);
                              },
                              className: 'ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer'
                            },
                            '×'
                          )
                        ]
                      )
                    )
                  )
                ), { duration: 3000 });
              } catch (toastError) {
                console.warn('[VaultDesktop] Could not show points update toast:', toastError);
              }
            }
          } else {
            console.warn('[VaultDesktop] Points balance response not successful:', json);
          }
        } else {
          console.warn('[VaultDesktop] Points balance fetch failed:', resp.status);
        }
      } catch (error) {
        console.error('[VaultDesktop] Error fetching points balance:', error);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('points-updated', handlePointsUpdated);
      console.log('[VaultDesktop] 🎧 Points update event listener registered');
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('points-updated', handlePointsUpdated);
        console.log('[VaultDesktop] 🔇 Points update event listener removed');
      }
    };
  }, [currentLexieId]);

  // Update countdown timer for verification code
  useEffect(() => {
    if (!showVerificationModal || verificationTimeLeft <= 0) return;

    const interval = setInterval(() => {
      setVerificationTimeLeft(prev => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          setShowVerificationModal(false);
          setVerificationCode('');
          setVerificationLexieId('');
          setVerificationExpiresAt(0);
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showVerificationModal, verificationTimeLeft]);

  // Listen for signature request and init lifecycle events (like old WalletPage)
  useEffect(() => {
    const onSignRequest = () => {
      setShowSignRequestPopup(true);
      setIsInitInProgress(false);
      setInitProgress({ percent: 0, message: '' });
      setInitFailedMessage('');
      console.log('[VaultDesktop] Signature requested - showing modal');
    };

    const onInitStarted = (e) => {
      // Open modal when init/scan starts
      if (!showSignRequestPopup) {
        setShowSignRequestPopup(true);
      }
      setScanComplete(false);
      setIsInitInProgress(true);
      // Guard reset-to-0: don't reset progress if already at 100%
      setBootstrapProgress(prev => prev.percent < 100 ? { percent: 0, active: true } : prev);
      setInitFailedMessage('');
      const chainLabel = network?.name || (chainId ? `Chain ${chainId}` : 'network');
      setInitProgress({ percent: 0, message: `Setting up your LexieVault on ${chainLabel} Network...` });
      console.log('[VaultDesktop] Initialization started');
    };

    const onInitProgress = () => {
      const chainLabel = network?.name || (chainId ? `Chain ${chainId}` : 'network');
      setInitProgress((prev) => ({
        percent: prev.percent,
        message: prev.message || `Setting up your LexieVault on ${chainLabel}...`,
      }));
    };

    const onInitCompleted = () => {
      // Do not set to 100% here; wait for checkChainReady to confirm
      console.log('[VaultDesktop] SDK reported completed; awaiting confirmation');
      setInitProgress((prev) => ({ ...prev, message: prev.message || 'Finalizing...' }));
    };

    const onInitFailed = (e) => {
      const msg = e?.detail?.error || 'Initialization failed';
      setInitFailedMessage(msg);
      setIsInitInProgress(false);
      console.warn('[VaultDesktop] Initialization failed:', msg);
    };

    // Begin polling exactly when refreshBalances starts in context (like old WalletPage)
    const onPollStart = async (e) => {
      // Do not show init modal on initial connect fast-path; only after initial connect
      if (!initialConnectDoneRef.current) return;

      try {
        const ready = await checkChainReady();
        if (!ready) onInitStarted(e);
      } catch {
        onInitStarted(e);
      }
    };

    const onScanStarted = async (e) => {
      // Same guard: avoid modal during initial connect
      if (!initialConnectDoneRef.current) return;

      try {
        const ready = await checkChainReady();
        if (!ready) onInitStarted(e);
      } catch {
        onInitStarted(e);
      }
    };

    window.addEventListener('railgun-signature-requested', onSignRequest);
    window.addEventListener('vault-poll-start', onPollStart);
    window.addEventListener('railgun-init-started', onInitStarted); // full init always shows
    window.addEventListener('railgun-scan-started', onScanStarted);
    window.addEventListener('railgun-init-progress', onInitProgress);
    window.addEventListener('railgun-init-completed', onInitCompleted);
    window.addEventListener('railgun-init-failed', onInitFailed);

    // Force unlock modal when initialization is complete
    const onVaultInitComplete = () => {
      console.log('[VaultDesktop] Force unlocking initialization modal');
      setIsInitInProgress(false);
      setInitProgress({ percent: 100, message: 'Initialization complete' });
      // Don't reset bootstrap progress - let it stay at 100% until modal closes
    };
    window.addEventListener('vault-initialization-complete', onVaultInitComplete);

    // Railgun initialization completed - only unlock modal if scanning is also complete
    const onRailgunInitForceUnlock = () => {
      console.log('[VaultDesktop] Railgun initialization completed - modal will unlock when scanning completes');
      // Don't set isInitInProgress=false here - wait for scanning to complete
      // Don't set scanComplete=true here - let actual scanning completion do that
      setInitProgress({ percent: 95, message: 'Railgun ready - completing chain scan...' });
    };
    window.addEventListener('railgun-init-force-unlock', onRailgunInitForceUnlock);

      // Handle bootstrap progress updates
      const onBootstrapProgress = (e) => {
        const { chainId: eventChainId, progress } = e.detail;
        console.log('[VaultDesktop] Bootstrap progress event:', { eventChainId, progress, currentChainId: chainId, networkName: network?.name });

        // Always update progress bar during bootstrap (only one chain at a time)
        const newPercent = Math.round(progress * 100) / 100;
        console.log('[VaultDesktop] Updating progress bar for chain', eventChainId, 'progress:', progress, '->', newPercent + '%');

        // Lock at 100% once reached - don't allow it to go below 100% until modal closes
        setBootstrapProgress(prev => {
          const finalPercent = bootstrapLockedRef.current && newPercent < prev.percent ? prev.percent : newPercent;
          return { percent: finalPercent, active: true };
        });

        // When bootstrap reaches 100%, lock it and change message to "Creating..."
        if (newPercent >= 100 && !bootstrapLockedRef.current) {
          bootstrapLockedRef.current = true;
          const networkName = network?.name || `Chain ${eventChainId}`;
          setInitProgress(prev => ({
            ...prev,
            message: `Creating your LexieVault on ${networkName} Network...`
          }));
        }
      };
    window.addEventListener('chain-bootstrap-progress', onBootstrapProgress);

    return () => {
      window.removeEventListener('railgun-signature-requested', onSignRequest);
      window.removeEventListener('railgun-init-started', onInitStarted);
      window.removeEventListener('vault-poll-start', onPollStart);
      window.removeEventListener('railgun-init-progress', onInitProgress);
      window.removeEventListener('railgun-scan-started', onScanStarted);
      window.removeEventListener('railgun-init-completed', onInitCompleted);
      window.removeEventListener('railgun-init-failed', onInitFailed);
      window.removeEventListener('vault-initialization-complete', onVaultInitComplete);
      window.removeEventListener('railgun-init-force-unlock', onRailgunInitForceUnlock);
      window.removeEventListener('chain-bootstrap-progress', onBootstrapProgress);
    };
  }, [address, chainId, railgunWalletId, network, checkChainReady, showSignRequestPopup]);

  // Unlock modal using the same readiness flag as old WalletPage
  useEffect(() => {
    if (showSignRequestPopup && isInitInProgress && scanComplete && isChainReady) {
      setInitProgress({ percent: 100, message: 'Initialization complete' });
      setIsInitInProgress(false);
      // Keep progress bar at 100% until modal closes, will reset when modal opens again
    }
  }, [scanComplete, isChainReady, isInitInProgress, showSignRequestPopup]);

  // Reset bootstrap progress when modal closes
  useEffect(() => {
    if (!showSignRequestPopup) {
      setBootstrapProgress({ percent: 0, active: false });
      bootstrapLockedRef.current = false; // Reset the 100% lock
    }
  }, [showSignRequestPopup]);

  // Auto-open Lexie ID modal for new wallet creation
  useEffect(() => {
    if (shouldShowLexieIdModal && !currentLexieId) {
      console.log('[VaultDesktop] 🎉 New wallet created - opening Lexie ID modal');
      setShowLexieModal(true);
      clearLexieIdModalFlag(); // Clear the flag
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-purple-500/30 bg-black/90 text-purple-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-purple-400" />
              <div>
                <div className="text-sm">Get Your LexieID</div>
                <div className="text-xs text-purple-400/80">
                  Claim your LexieID for easy transfers and to play LexieTitans!
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }}
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-purple-900/30 text-purple-300/80"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ), { duration: 5000 });
    }
  }, [shouldShowLexieIdModal, currentLexieId, clearLexieIdModalFlag]);

  // Check if this Railgun address already has a linked Lexie ID
  useEffect(() => {
    if (!railgunAddress) {
      handleLexieIdLink('');
      return;
    }
    (async () => {
      try {
        const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(railgunAddress)}`);
        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json.success && json.lexieID) {
            handleLexieIdLink(json.lexieID);
          } else {
            handleLexieIdLink('');
          }
        } else {
          handleLexieIdLink('');
        }
      } catch {
        handleLexieIdLink('');
      }
    })();
  }, [railgunAddress]);

  // Get encryption key
  const getEncryptionKey = useCallback(async () => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }

    try {
      const { deriveEncryptionKey } = await import('../../utils/railgun/wallet');
      const secret = address.toLowerCase();
      const salt = `lexie-railgun-${chainId}`;
      return await deriveEncryptionKey(secret, salt, 100000);
    } catch (error) {
      console.error('[VaultDesktop] Failed to derive encryption key:', error);
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

      // Check sufficient balance
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

      console.log('[VaultDesktop] About to call shieldTokens with:', {
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

      // Validate token address: allow undefined/null for native base tokens
      const isNativeToken = token.address == null;
      if (!isNativeToken && (typeof token.address !== 'string' || !token.address.startsWith('0x') || token.address.length !== 42)) {
        throw new Error(`Invalid token address for ${token.symbol}`);
      }

      const tokenType = isNativeToken ? 'NATIVE' : 'ERC20';
      console.log('[VaultDesktop] About to shield', tokenType, 'token:', token.symbol);

      const result = await shieldTokens({
        tokenAddress: token.address,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress,
        walletProvider: await walletProvider()
      });

      toast.dismiss();
      console.log('[VaultDesktop] Sending shield transaction:', result.transaction);

      // Get wallet signer
      const walletSigner = await walletProvider();

      // Send transaction using signer
      const txResponse = await walletSigner.sendTransaction(result.transaction);
      console.log('[VaultDesktop] Transaction sent:', txResponse);

      toast.dismiss();
      toast.loading(`Waiting for confirmation...`);

      toast.dismiss();
      toast.success(`Successfully shielded ${amount} ${token.symbol}! TX: ${txResponse.hash}`);

      // Clear the amount for this token
      setShieldAmounts(prev => ({ ...prev, [token.symbol]: '' }));

      // Enhanced transaction monitoring
      toast.dismiss();
      console.log('[VaultDesktop] Starting Graph-based shield monitoring...');

      try {
        const { monitorTransactionInGraph } = await import('../../utils/railgun/transactionMonitor.js');

        monitorTransactionInGraph({
          txHash: txResponse.hash,
          chainId: chainConfig.id,
          transactionType: 'shield',
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            railgunAddress: railgunAddress,
            tokenSymbol: token.symbol,
            tokenAddress: token.address,
            decimals: token.decimals,
            amount: amount,
          },
          listener: async (event) => {
            console.log(`[VaultDesktop] Shield tx ${txResponse.hash} indexed on chain ${chainConfig.id}`);
          }
        })
        .then((result) => {
          if (result.found) {
            console.log(`[VaultDesktop] Shield monitoring completed in ${result.elapsedTime/1000}s`);
          } else {
            console.warn('[VaultDesktop] Shield monitoring timed out');
          }
        })
        .catch((error) => {
          console.error('[VaultDesktop] Shield Graph monitoring failed:', error);
        });

      } catch (monitorError) {
        console.error('[VaultDesktop] Failed to start shield monitoring:', monitorError);
      }

    } catch (error) {
      console.error('[VaultDesktop] Shield failed:', error);
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

  // Handle network switch
  const handleNetworkSwitch = async (targetChainId) => {
    console.log('[VaultDesktop] handleNetworkSwitch called with targetChainId=', targetChainId);
    try {
      // Block chain switching until secure vault engine is initialized
      if (!canUseRailgun || !railgunWalletId) {
        console.log('[VaultDesktop] Blocking switch: canUseRailgun=', canUseRailgun, 'railgunWalletId=', railgunWalletId);
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
      console.log('[VaultDesktop] Switching network to', targetChainId);
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

      // After switch: check Redis for target chain
      const scanned = await checkRedisScannedChains(targetChainId);
      if (scanned === false || scanned === null) {
        console.log('[VaultDesktop] Target chain not scanned - showing modal');
        setShowSignRequestPopup(true);
        setIsInitInProgress(true);
        // Guard reset-to-0: don't reset progress if already at 100%
        setBootstrapProgress(prev => prev.percent < 100 ? { percent: 0, active: true } : prev);
        const chainLabel = targetNetwork?.name || `Chain ${targetChainId}`;
        setInitProgress({ percent: 0, message: `Setting up your LexieVault on ${chainLabel} Network...` });
      } else {
        console.log('[VaultDesktop] Target chain already scanned - no modal needed');
      }
    } catch (error) {
      console.error('[VaultDesktop] Error in handleNetworkSwitch:', error);
      toast.error(`Failed to switch network: ${error.message}`);
    }
  };

  const modules = [
    { id: 'home', name: 'Home', color: 'text-green-300' },
    { id: 'vault', name: 'LexieVault', color: 'text-purple-300' },
    { id: 'chat', name: 'LexieChat', color: 'text-blue-300' },
    { id: 'titans', name: 'LexieTitans', color: 'text-orange-300' }
  ];

  const handleModuleSwitch = (moduleId) => {
    if (moduleId === activeModule) return;

    setIsTransitioning(true);
    setMenuOpen(false);

    setTimeout(() => {
      setActiveModule(moduleId);
      setIsTransitioning(false);
    }, 200);
  };

  const renderModuleContent = () => {
    switch (activeModule) {
      case 'home':
        return (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
            <div className="text-center space-y-8">
              <div className="space-y-4">
                <div className="text-lg text-green-300/80">Mobile Terminal</div>
              </div>

              <div className="bg-black/40 border border-green-500/30 rounded-lg p-6 max-w-sm">
                <div className="space-y-4">
                  <div className="text-sm text-green-300/70">
                    Welcome to LexieOS Mobile
                  </div>
                  <div className="text-xs text-green-400/60 space-y-2">
                    <div>• Access your vault securely</div>
                    <div>• Chat with LexieAI</div>
                    <div>• Play LexieTitans</div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-green-500/50">
                Tap the menu (☰) to navigate
              </div>
            </div>
          </div>
        );

      case 'vault':
        if (!railgunFunctions || !VaultDesktopInner) {
          return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
              <div className="text-center space-y-4">
                <div className="text-green-300">Loading LexieVault...</div>
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
                </div>
              </div>
            </div>
          );
        }
        return (
          <WindowProvider>
            <VaultDesktopInner
              mobileMode={true}
              deriveEncryptionKey={railgunFunctions.deriveEncryptionKey}
              clearAllWallets={railgunFunctions.clearAllWallets}
            />
          </WindowProvider>
        );

      case 'chat':
        return (
          <div className="flex flex-col min-h-[calc(100vh-80px)]">
            <div className="flex-1 p-4 space-y-4">
              <div className="text-center py-8">
                <div className="text-2xl font-bold text-blue-300">LexieChat</div>
                <div className="text-sm text-blue-300/70 mt-2">AI Assistant Terminal</div>
              </div>

              <div className="bg-black/40 border border-blue-500/30 rounded-lg p-4">
                <div className="text-sm text-blue-300/80">
                  Chat interface would load here...
                </div>
              </div>
            </div>
          </div>
        );

      case 'titans':
        return (
          <div className="flex flex-col min-h-[calc(100vh-80px)]">
            <div className="flex-1 p-4 space-y-4">
              <div className="text-center py-8">
                <div className="text-2xl font-bold text-orange-300">LexieTitans</div>
                <div className="text-sm text-orange-300/70 mt-2">Blockchain Gaming</div>
              </div>

              <div className="bg-black/40 border border-orange-500/30 rounded-lg p-4">
                <div className="text-sm text-orange-300/80">
                  Game interface would load here...
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentModule = modules.find(m => m.id === activeModule);

  // Show error screen if there's a React error
  if (hasError) {
    return (
      <div className="relative min-h-screen w-full bg-black text-white overflow-hidden flex items-center justify-center">
        <div className="text-center space-y-4 px-6">
          <div className="text-3xl font-bold text-red-300">System Error</div>
          <div className="text-sm text-red-300/70">Something went wrong with the mobile interface</div>
          <div className="text-xs text-red-400/60 bg-black/40 p-3 rounded border border-red-500/30 max-w-sm">
            {errorMessage}
          </div>
          <button
            onClick={() => {
              setHasError(false);
              setErrorMessage('');
              window.location.reload();
            }}
            className="bg-red-600/30 hover:bg-red-600/50 text-red-200 py-2 px-4 rounded border border-red-400/40 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
      </div>

      {/* Header Bar */}
      <div className="relative z-20 flex items-center justify-between px-4 py-3 bg-black/80 border-b border-green-500/20">
        <div className="flex items-center space-x-2">
          <div className="text-green-400 text-xl font-mono">&gt;</div>
          <div className="text-purple-300 text-sm font-mono">
            LEXIEAI
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={toggleEruda}
            className="text-green-400 hover:text-green-300 transition-colors text-lg p-1"
            aria-label="Debug Tools"
            title="Open Eruda Debug Tools"
          >
            ⚙️
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-green-400 hover:text-green-300 transition-colors text-xl p-1"
            aria-label="Menu"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Slide-out Menu */}
      <div className={`fixed top-0 right-0 h-full w-64 bg-black/95 border-l border-green-500/20 z-30 transform transition-transform duration-300 ease-in-out ${
        menuOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="pt-16 px-6">
          <div className="space-y-2">
            {modules.map((module) => (
              <button
                key={module.id}
                onClick={() => handleModuleSwitch(module.id)}
                className={`w-full text-left py-3 px-4 rounded border transition-all duration-200 font-mono ${
                  activeModule === module.id
                    ? 'bg-green-900/30 border-green-400/50 text-green-300'
                    : 'border-transparent hover:border-green-500/30 text-green-400/70 hover:text-green-300'
                }`}
              >
                {module.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu Overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className={`relative z-10 transition-opacity duration-200 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}>
        {renderModuleContent()}
      </div>

      {/* Terminal Flicker Effect */}
      <div className="fixed inset-0 pointer-events-none z-40">
        <div className="absolute inset-0 bg-green-400/5 animate-pulse opacity-0"></div>
      </div>
    </div>
  );
};

const VaultMobileFallback = () => {
  return <LexieMobileShell />;
};

export default VaultMobileFallback;


