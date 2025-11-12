/**
 * Wallet Page - Main wallet interface with privacy features
 * Integrates external wallet connection and Railgun privacy functionality
 */

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
import { RefreshCw, Info } from 'lucide-react';

import { useWallet } from '../../contexts/WalletContext';
import { useWindowStore, WindowProvider } from '../../contexts/windowStore.jsx';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts.js';
import TerminalWindow from '../ui/TerminalWindow.jsx';
import WindowShell from '../window/WindowShell.jsx';
import Taskbar from '../window/Taskbar.jsx';
import useBalances from '../../hooks/useBalances';
import useInjectedProviders from '../../hooks/useInjectedProviders';
import PrivacyActions from '../PrivacyActions';
import TransactionHistory from '../TransactionHistory';
import VaultInfoModal from './VaultInfoModal';
import InjectedProviderButtons from '../InjectedProviderButtons.jsx';
import {
  shieldTokens,
  parseTokenAmount,
  isTokenSupportedByRailgun,
} from '../../utils/railgun/actions';
import { deriveEncryptionKey, clearAllWallets } from '../../utils/railgun/wallet';
import { syncBalancesAfterTransaction } from '../../utils/railgun/syncBalances';
import LexieIdChoiceModal from './LexieIdChoiceModal';
import LexieIdModal from './LexieIdModal';
import CrossPlatformVerificationModal from './CrossPlatformVerificationModal';
import GameOnboardingModal from './GameOnboardingModal';
import SignRequestModal from './SignRequestModal';
import { useChainSwitchModal } from '../../hooks/useChainSwitchModal';
import SignatureConfirmationModal from './SignatureConfirmationModal';
import ReturningUserChainSelectionModal from './ReturningUserChainSelectionModal';
import { Navbar } from '../Navbar.jsx';
import ChatPage from '../../pages/ChatPage.tsx';

// Titans Game component that loads the actual game from game.lexiecrypto.com
const TitansGame = ({ lexieId, walletAddress, embedded, theme, onLoad, onError, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef(null);

  const gameUrl = `https://game.lexiecrypto.com/?lexieId=${encodeURIComponent(lexieId)}&walletAddress=${encodeURIComponent(walletAddress || '')}&embedded=true&theme=${theme || 'terminal'}`;

  const handleIframeLoad = () => {
    setIsLoading(false);
    onLoad && onLoad();
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
    onError && onError(new Error('Failed to load Titans game'));
  };

  if (hasError) {
    return (
      <div className="w-full bg-gradient-to-br from-purple-900/20 to-blue-900/20 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-6 max-w-md mx-auto px-6">
          <div className="text-6xl">⚠️</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-red-300">Game Unavailable</h2>
            <p className="text-red-200/80 text-sm">
              Sorry, the LexieTitans game couldn't be loaded right now.
            </p>
          </div>
          <div className="bg-black/40 border border-red-500/30 rounded-lg p-4">
            <div className="text-sm text-red-300/70">
              Please try again later or check your internet connection.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black relative flex flex-col">
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 to-blue-900/20 flex items-center justify-center z-10">
          <div className="text-center space-y-6 max-w-md mx-auto px-6">
            <div className="text-6xl">🎮</div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-purple-300">Loading LexieTitans Game</h2>
              <p className="text-purple-200/80 text-sm">
                Welcome to LexieTitans, <span className="text-emerald-300 font-mono">@{lexieId}</span>!
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            </div>
            <div className="text-xs text-purple-400/60">
              Initializing game systems...
            </div>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={gameUrl}
        className="w-full flex-1 border-0"
        style={{ minHeight: '100vh' }}
        title="Titans Game"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-modals"
      />
    </div>
  );
};


// Titans Game Window Component
const TitansGameWindow = ({ lexieId, walletAddress, onClose }) => {
  return (
    <div className="h-full w-full bg-black text-green-300 font-mono overflow-auto scrollbar-terminal">
      <div className="min-h-full w-full">
        <TitansGame
          lexieId={lexieId}
          walletAddress={walletAddress}
          embedded={true}
          theme="terminal"
          onLoad={() => {}}
          onError={() => {}}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

const VaultDesktopInner = ({ mobileMode = false }) => {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  const {
    isConnected,
    isConnecting,
    address,
    chainId: walletChainId,
    railgunWalletId,
    railgunAddress,
    isRailgunInitialized,
    isInitializingRailgun,
    canUseRailgun,
    railgunError,
    connectWallet,
    disconnectWallet,
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
  const { getWindowState, reopenWindow } = useWindowStore();
  useKeyboardShortcuts();

  // Memoize footer content to prevent re-mounting
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
  } = useBalances(activeChainId);

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [selectedView, setSelectedView] = useState('balances');
  const [activeAction, setActiveAction] = useState('shield');
  const [showPrivateBalances, setShowPrivateBalances] = useState(false);
  const [isShielding, setIsShielding] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
  const [activeTransactionMonitors, setActiveTransactionMonitors] = useState(0);
  const [shieldingTokens, setShieldingTokens] = useState(new Set());
  const [shieldAmounts, setShieldAmounts] = useState({});

  // Use the chain switch modal hook
  const {
    showSignRequestPopup,
    initProgress,
    isInitInProgress,
    initFailedMessage,
    bootstrapProgress,
    initializingChainId,
    scanComplete,
    handlePersistMetadata,
    resetModal,
    setInitializingChainId,
    getNetworkNameById: modalGetNetworkNameById
  } = useChainSwitchModal();


  // Helper to get network name by chain ID
  const getNetworkNameById = (chainId) => {
    return {
      1: 'Ethereum',
      137: 'Polygon',
      42161: 'Arbitrum',
      56: 'BNB Chain'
    }[Number(chainId)] || `Chain ${chainId}`;
  };


  // Lexie ID linking state - now managed by LexieIdModal component
  const [showLexieModal, setShowLexieModal] = useState(false);
  const [currentLexieId, setCurrentLexieId] = useState('');
  const [pointsBalance, setPointsBalance] = useState(null);
  const [pointsBreakdown, setPointsBreakdown] = useState(null);
  const [showTitansGame, setShowTitansGame] = useState(false);
  const [showLexieChat, setShowLexieChat] = useState(false);
  const [showGameOnboardingModal, setShowGameOnboardingModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [pendingLexieId, setPendingLexieId] = useState('');

  // Chat visibility for desktop WindowShell
  const isLexieChatVisible = showLexieChat;

  // Signature confirmation from WalletContext
  const {
    showSignatureConfirmation,
    pendingSignatureMessage,
    confirmSignature,
    cancelSignature,
    switchNetwork,
    showReturningUserChainModal,
    handleReturningUserChainChoice,
  } = useWallet();

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

    // For new users, show game onboarding modal to ask if they want to play
    if (lexieId && autoOpenGame) {
      setPendingLexieId(lexieId);
      setShowGameOnboardingModal(true);
      // Don't signal completion yet - wait for game onboarding choice
    } else {
      // Signal completion without opening game
      onLexieIdLinked();
    }
  }, [address, onLexieIdLinked, isMobile]);

  // Handle game onboarding choice
  const handleGameOnboardingChoice = useCallback((wantsToPlay) => {
    setShowGameOnboardingModal(false);

    if (wantsToPlay && pendingLexieId) {
      if (isMobile) {
        // Open game in new tab on mobile
        setTimeout(() => {
          const gameUrl = `https://game.lexiecrypto.com/?lexieId=${encodeURIComponent(pendingLexieId)}&walletAddress=${encodeURIComponent(address || '')}&embedded=true&theme=terminal`;
          window.open(gameUrl, '_blank');
        }, 500); // Small delay to allow modal to close
      } else {
        // Open embedded game on desktop
        setTimeout(() => {
          setShowTitansGame(true);
        }, 500); // Small delay to allow modal to close
      }
    }

    // Always signal completion
    onLexieIdLinked();
    setPendingLexieId('');
  }, [pendingLexieId, isMobile, onLexieIdLinked, address]);

  // Cross-platform verification state - now managed by CrossPlatformVerificationModal component
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  // Selected chain state - load from localStorage, no default
  const [selectedChainId, setSelectedChainId] = useState(() => {
    try {
      const saved = localStorage.getItem('lexie-selected-chain');
      const parsed = saved ? parseInt(saved, 10) : null;
      // Validate that the saved chain is still supported
      const isValidChain = parsed && supportedNetworks.some(net => net.id === parsed);
      const chainId = isValidChain ? parsed : null;
      console.log('[VaultDesktop] Loaded chain selection from localStorage:', { saved, parsed, isValidChain, chainId });
      return chainId;
    } catch (error) {
      console.warn('[VaultDesktop] Failed to load chain selection from localStorage:', error);
      return null; // No fallback
    }
  });

  // Chain readiness state
  const [isChainReady, setIsChainReady] = useState(false);

  // Supported networks array
  const supportedNetworks = [
    { id: 1, name: 'Ethereum', symbol: 'ETH' },
    { id: 137, name: 'Polygon', symbol: 'POL' },
    { id: 42161, name: 'Arbitrum', symbol: 'ETH'},
    { id: 56, name: 'BNB Chain', symbol: 'BNB' },
  ];

  // Use selectedChainId as the PRIMARY chain for all vault operations
  // Fall back to wallet's chainId if no selection made
  const activeChainId = selectedChainId || walletChainId;
  const network = selectedChainId
    ? { id: selectedChainId, name: {1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 56: 'BNB Chain'}[selectedChainId] || `Chain ${selectedChainId}` }
    : getCurrentNetwork();

  // Persist selectedChainId to localStorage whenever it changes
  useEffect(() => {
    if (selectedChainId && supportedNetworks.some(net => net.id === selectedChainId)) {
      try {
        localStorage.setItem('lexie-selected-chain', selectedChainId.toString());
        console.log('[VaultDesktop] Saved selectedChainId to localStorage:', selectedChainId);
      } catch (error) {
        console.warn('[VaultDesktop] Failed to save selectedChainId to localStorage:', error);
      }
    }
  }, [selectedChainId, supportedNetworks]);

  // Update selectedChainId when wallet chain changes (for chain switches), but only if user hasn't selected a chain yet
  useEffect(() => {
    if (walletChainId && supportedNetworks.some(net => net.id === walletChainId) && selectedChainId === null) {
      console.log('[VaultDesktop] Wallet chain changed, setting initial selectedChainId:', walletChainId);
      setSelectedChainId(walletChainId);
      // Persist to localStorage (already handled by the above useEffect)
    }
  }, [walletChainId, supportedNetworks, selectedChainId]);

  // Set global variable for modal unlock utility to access current chain
  React.useEffect(() => {
    if (typeof window !== 'undefined' && activeChainId) {
      window.__LEXIE_ACTIVE_CHAIN_ID = activeChainId;
    }
  }, [activeChainId]);

  // Check if current network is supported
  const isNetworkSupported = walletChainId && supportedNetworks.some(net => net.id === walletChainId);

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


  // Simple Redis check for scanned chains (exact EOA address, no normalization)
  const checkRedisScannedChains = useCallback(async (targetChainId = null) => {
    if (!address || !railgunWalletId) return null;
    
    const checkChainId = targetChainId || activeChainId;
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
        chainId: Number(activeChainId),
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
  }, [address, railgunWalletId, activeChainId]);

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
  }, [canUseRailgun, railgunWalletId, address, activeChainId, checkChainReady]);

  // Disconnect handler
  const handleDisconnect = useCallback(async () => {
    try {
      // Unload all Railgun wallets/state before disconnecting
      try {
        await clearAllWallets();
      } catch {}
      // Clear per-address guide flag
      if (address) {
        try { 
          localStorage.removeItem(`railgun-guide-seen-${address.toLowerCase()}`); 
        } catch {}
      }
      
      // Clear session flags
      try { sessionStorage.clear(); } catch {}
      
      // Reset WalletConnect/Wagmi cached sessions
      try {
        const lc = localStorage;
        if (lc) {
          try { lc.removeItem('wagmi.store'); } catch {}
          try { lc.removeItem('walletconnect'); } catch {}
          try { lc.removeItem('WALLETCONNECT_DEEPLINK_CHOICE'); } catch {}
          
          const keys = Object.keys(lc);
          keys.forEach((k) => {
            if (k.startsWith('wc@') || k.startsWith('wc:') || 
                k.toLowerCase().includes('walletconnect') || 
                k.toLowerCase().includes('web3modal')) {
              try { lc.removeItem(k); } catch {}
            }
          });
        }
      } catch {}
      
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

  // Auto-unlock transaction lock after 1 minute as safety fallback
  useEffect(() => {
    if (!isTransactionLocked) return;

    console.log('[VaultDesktop] ⏰ Starting 2-minute safety timeout for transaction lock');

    const timeoutId = setTimeout(() => {
      console.log('[VaultDesktop] ⏰ Safety timeout reached - auto-unlocking transaction UI');
      setIsTransactionLocked(false);
      setActiveTransactionMonitors(0);
    }, 120000); // 60 seconds

    return () => {
      console.log('[VaultDesktop] ⏰ Clearing safety timeout (transaction completed normally)');
      clearTimeout(timeoutId);
    };
  }, [isTransactionLocked]);



  // Placeholder functions for command bar icons
  const handleRefresh = useCallback(async () => {
    console.log('[VaultDesktop] Refresh clicked');
    try {
      // Trigger full SDK balance refresh to discover new private transfers
      if (canUseRailgun && railgunWalletId && address && walletChainId) {
        console.log('[VaultDesktop] Triggering SDK balance refresh for private transfers...');
        await syncBalancesAfterTransaction({
          walletAddress: address,
          walletId: railgunWalletId,
          chainId: walletChainId,
        });
        console.log('[VaultDesktop] SDK balance refresh completed');
      }

      // Then refresh from Redis (which should now have updated balances)
      await refreshAllBalances();
      console.log('[VaultDesktop] Balance refresh completed');
    } catch (error) {
      console.error('[VaultDesktop] Balance refresh failed:', error);
    }
  }, [refreshAllBalances, canUseRailgun, railgunWalletId, address, walletChainId]);

  const handleInfoClick = useCallback(() => {
    console.log('[VaultDesktop] Info clicked - opening documentation');
    window.open('https://lexie-crypto.gitbook.io/lexie-crypto/', '_blank');
  }, []);


  // Auto-switch to privacy view when Railgun is ready
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      setShowPrivateMode(true);
    }
  }, [canUseRailgun, railgunWalletId]);


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


  // Countdown timer for verification code - now handled by CrossPlatformVerificationModal component


  // Auto-open Lexie ID modal for new wallet creation
  useEffect(() => {
    if (shouldShowLexieIdModal && !currentLexieId) {
      console.log('[VaultDesktop] 🎉 New wallet created - opening Lexie ID modal');

      setShowLexieModal(true);
      clearLexieIdModalFlag(); // Clear the flag

      // Optional toast
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
    if (!address || !walletChainId) {
      throw new Error('Wallet not connected');
    }

    try {
      const secret = address.toLowerCase();
      const salt = `lexie-railgun-${activeChainId}`;
      return await deriveEncryptionKey(secret, salt, 100000);
    } catch (error) {
      console.error('[VaultDesktop] Failed to derive encryption key:', error);
      throw new Error('Failed to derive encryption key');
    }
  }, [address, activeChainId]);

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
      if (!isTokenSupportedByRailgun(token.address, activeChainId)) {
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
      const chainConfig = { type: network.name.toLowerCase(), id: activeChainId };

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
  }, [canUseRailgun, railgunWalletId, address, activeChainId, network, shieldAmounts, refreshBalancesAfterTransaction, getEncryptionKey, walletProvider]);


  const [isChainMenuOpen, setIsChainMenuOpen] = useState(false);
  const [isMobileChainMenuOpen, setIsMobileChainMenuOpen] = useState(false);
  const [isModalChainMenuOpen, setIsModalChainMenuOpen] = useState(false);
  const chainMenuRef = useRef(null);
  const mobileChainMenuRef = useRef(null);

  // Close custom chain menu on outside click or ESC
  useEffect(() => {
    if (!isChainMenuOpen && !isMobileChainMenuOpen && !isModalChainMenuOpen) return;
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
        setIsModalChainMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isChainMenuOpen, isMobileChainMenuOpen, isModalChainMenuOpen]);

  if (!isConnected || (isConnected && !isNetworkSupported) || walletConnectValidating) {
    return (
      <div className="relative h-screen w-full bg-black text-white overflow-x-hidden scrollbar-terminal">
        {/* Background overlays */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
          </div>
          <div className="absolute inset-0 overflow-hidden scrollbar-terminal">
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
            statusLabel={wasDisconnectedForUnsupportedNetwork ? 'NETWORK ERROR' : (isConnecting ? 'WAITING' : 'READY')}
            statusTone={wasDisconnectedForUnsupportedNetwork ? 'error' : (isConnecting ? 'waiting' : 'online')}
            footerLeft={<span>Process: wallet-connect</span>}
            variant="connect"
            className="overflow-hidden"
          >
            <div className="font-mono text-green-300 text-center">
              <WalletIcon className="h-16 w-16 text-emerald-300 mx-auto mb-6" />
              <h2 className="text-2xl font-semibold text-emerald-300 tracking-tight">Connect Wallet</h2>
              <p className="mt-2 text-emerald-300/80 text-center text-sm leading-6">
                {wasDisconnectedForUnsupportedNetwork
                  ? "Your wallet was disconnected because it's connected to an unsupported network. Please switch to Ethereum, Arbitrum, Polygon, or BNB Chain and try again."
                  : "Connect your wallet to gain access to the LexieVault features."
                }
              </p>

              <div className="space-y-4">
                <InjectedProviderButtons disabled={isConnecting} selectedChainId={selectedChainId} />
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
    <div className="relative h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Background overlays */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>
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

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8">
        <WindowShell
          id="lexie-vault-terminal"
          title="lexie-vault"
          appType="vault"
          statusLabel={statusConfig.statusLabel}
          statusTone={statusConfig.statusTone}
          footerLeft={footerContent}
          variant="vault"
          fullscreen={false}
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
                  <span className="text-purple-300/60">•</span>
                  {currentLexieId ? (
                    <div className="flex items-center space-x-2">
                      <span className="text-purple-300 font-medium">{currentLexieId}</span>
                      <ClipboardDocumentIcon
                        className="h-3.5 w-3.5 text-purple-300 hover:text-purple-400 cursor-pointer transition-colors"
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
                        title="Copy Lexie ID"
                      />
                      <span
                        className="ml-2 text-purple-300"
                        title={
                          pointsBreakdown
                            ? `Vault Points: ${pointsBreakdown.vault?.toFixed(2) || '0.00'}\nGame Points: ${pointsBreakdown.game?.toFixed(2) || '0.00'}`
                            : "Points = $ value × streak. Min $5. Streak resets if you skip a day."
                        }
                      >
                        <span className="text-purple-300/60">•</span> points{' '}
                        {pointsBalance !== null && pointsBalance !== undefined ? pointsBalance.toFixed(2) : '0.00'}
                      </span>
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
                      {supportedNetworks.find(n => n.id === activeChainId)?.name || 'Select'}
                      <span className="ml-1">▾</span>
                    </button>
                    {isMobileChainMenuOpen && (
                      <div className="absolute mt-1 left-0 w-40 bg-black text-green-300 border border-green-500/40 rounded shadow-xl overflow-hidden scrollbar-none z-[2000]">
                        {supportedNetworks.map((net) => (
                          <button
                            key={net.id}
                            onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsMobileChainMenuOpen(false); setSelectedChainId(net.id); switchNetwork(net.id); }}
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
                {currentLexieId && (
                  <button
                    onClick={() => {
                      const windowState = getWindowState('titans-game-terminal');
                      // If window exists and is closed, reopen it first
                      if (windowState && windowState.isClosed) {
                        reopenWindow('titans-game-terminal');
                      }
                      setShowTitansGame(true);
                    }}
                    className="bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 px-3 py-1 rounded text-sm border border-purple-400/40 transition-colors"
                    title="Play LexieTitans Game"
                  >
                    Play Titans!
                  </button>
                )}
                <div className="relative" ref={chainMenuRef}>
                  <button
                    onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsChainMenuOpen((v) => !v); }}
                    className={`px-2 py-1 text-sm bg-black text-green-300 rounded border border-green-500/40 hover:border-emerald-400 ${(!canUseRailgun || !railgunWalletId) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={(!canUseRailgun || !railgunWalletId) ? 'Waiting for vault engine to initialize' : 'Select network'}
                    aria-disabled={!canUseRailgun || !railgunWalletId}
                  >
                    {supportedNetworks.find(n => n.id === activeChainId)?.name || 'Select'}
                    <span className="ml-1">▾</span>
                  </button>
                  {isChainMenuOpen && (
                    <div className="absolute mt-1 left-0 w-40 bg-black text-green-300 border border-green-500/40 rounded shadow-xl overflow-hidden scrollbar-none z-50">
                      {supportedNetworks.map((net) => (
                        <button
                          key={net.id}
                          onClick={() => { if (!canUseRailgun || !railgunWalletId) return; setIsChainMenuOpen(false); setSelectedChainId(net.id); switchNetwork(net.id); }}
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
              </div>
            )}

            {/* Boot log */}
            <div className="mb-6">
              <div className="text-xs text-green-400/60 tracking-wide mb-3">LEXIEAI SYSTEM BOOT v2.1.3</div>
              <div className="space-y-1 text-green-300/80 text-xs leading-5 font-mono">
                <div>✓ Vault interface loaded</div>
                <div>✓ Network: {network?.name || 'Unknown'}</div>
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
              <div className="flex justify-between items-center mb-2">
                {/* Left-aligned command buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedView('balances')}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="View all wallet balances"
                  >
                    balances
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction('contacts');
                      setSelectedView('privacy');
                    }}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-pink-400/40 bg-pink-900/20 hover:bg-pink-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="Manage your contacts"
                  >
                    contacts
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction('shield');
                      setSelectedView('privacy');
                    }}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-purple-300/50 bg-purple-300/10 hover:bg-purple-300/20 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="Add tokens to your vault from your connected wallet"
                  >
                    add
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction('receive');
                      setSelectedView('privacy');
                    }}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-blue-400/40 bg-blue-900/20 hover:bg-blue-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="Receive tokens to your vault from any address"
                  >
                    receive
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction('transfer');
                      setSelectedView('privacy');
                    }}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-cyan-400/40 bg-cyan-900/20 hover:bg-cyan-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="Send tokens from your vault to any address"
                  >
                    send
                  </button>
                  <button
                    onClick={() => {
                      setActiveAction('unshield');
                      setSelectedView('privacy');
                    }}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-amber-400/40 bg-amber-900/20 hover:bg-amber-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="Remove tokens from your vault to your connected wallet"
                  >
                    remove
                  </button>
                  <button
                    onClick={() => setSelectedView('history')}
                    disabled={isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="px-2 py-1 rounded border border-purple-400/40 bg-purple-900/20 hover:bg-purple-900/40 disabled:bg-gray-600/20 disabled:cursor-not-allowed text-xs"
                    title="View your transaction history"
                  >
                    history
                  </button>
                </div>

                {/* Right-aligned icon buttons - Hidden on mobile */}
                <div className="hidden md:flex gap-2">
                <button
                    onClick={handleInfoClick}
                    className="p-1.5 rounded border border-blue-400/40 bg-blue-900/20 hover:bg-blue-900/40 transition-all duration-200 hover:shadow-lg hover:shadow-blue-400/20"
                    title="Information"
                    aria-label="Info"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={isLoading || !isConnected || isTransactionLocked || !canUseRailgun || !railgunWalletId}
                    className="p-1.5 rounded border border-emerald-400/40 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg hover:shadow-emerald-400/20"
                    title="Refresh all wallet balances"
                    aria-label="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
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
                      {/* Mobile-only refresh and info buttons */}
                      <div className="flex md:hidden gap-1 ml-2">
                      <button
                          onClick={handleInfoClick}
                          className="p-1.5 rounded border border-blue-400/40 bg-blue-900/20 hover:bg-blue-900/40 transition-all duration-200 hover:shadow-lg hover:shadow-blue-400/20"
                          title="Information"
                          aria-label="Info"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleRefresh}
                          disabled={isLoading || !isConnected || isTransactionLocked || !canUseRailgun || !railgunWalletId}
                          className="p-1.5 rounded border border-emerald-400/40 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg hover:shadow-emerald-400/20"
                          title="Refresh all wallet balances"
                          aria-label="Refresh"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>


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
                  <div className="flex items-center mb-4">
                    <div className="text-emerald-300 text-sm font-medium font-mono">{network?.name || 'Network'} Public Balances</div>
                  </div>

                  <div className="space-y-2">
                    {(() => {
                      const filteredBalances = publicBalances.filter(token => {
                        const usdValue = parseFloat(token.balanceUSD || '0');
                        return usdValue >= 0.01;
                      });
                      return (
                        <>
                          {filteredBalances.map((token) => {
                            const isSupported = isTokenSupportedByRailgun(token.address, walletChainId);
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

                          {filteredBalances.length === 0 && !isLoading && (
                            <div className="text-center py-4 text-green-400/70 text-xs">No tokens found</div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}

            {/* Privacy Actions */}
            {selectedView === 'privacy' && (
              <PrivacyActions activeAction={activeAction} />
            )}

            {/* Transaction History */}
            {selectedView === 'history' && (
              <div className="border-t border-teal-500/10 pt-6">
                <div className="text-emerald-300 text-sm font-medium font-mono mb-4">Transaction History</div>
                <TransactionHistory />
              </div>
            )}

          </div>
        </WindowShell>

        {/* Error Messages */}
        {balanceErrors && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/40 rounded-lg">
            <p className="text-red-300 text-sm">Balance error: {balanceErrors}</p>
          </div>
        )}


      </div>

      <LexieIdChoiceModal
        isOpen={showLexieIdChoiceModal}
        onChoice={handleLexieIdChoice}
      />

      <GameOnboardingModal
        isOpen={showGameOnboardingModal}
        onChoice={handleGameOnboardingChoice}
        lexieId={pendingLexieId}
      />

      <LexieIdModal
        isOpen={showLexieModal}
        address={address}
        railgunAddress={railgunAddress}
        onLexieIdLinked={handleLexieIdLink}
        onClose={() => {
                                  setShowLexieModal(false);
                                  setLexieIdInput('');
                                  setLexieMessage('');
        }}
      />

      <CrossPlatformVerificationModal
        isOpen={showVerificationModal}
        onClose={() => setShowVerificationModal(false)}
      />

      <VaultInfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
      />

      <SignRequestModal
        isOpen={showSignRequestPopup}
        isInitInProgress={isInitInProgress}
        initProgress={initProgress}
        initFailedMessage={initFailedMessage}
        address={address}
        getNetworkNameById={getNetworkNameById}
        initializingChainId={initializingChainId}
        activeChainId={activeChainId}
        bootstrapProgress={bootstrapProgress}
        railgunWalletId={railgunWalletId}
        railgunAddress={railgunAddress}
        onPersistMetadata={handlePersistMetadata}
        onClose={resetModal}
      />

      <SignatureConfirmationModal
        isOpen={showSignatureConfirmation}
        selectedChainId={selectedChainId}
        setSelectedChainId={setSelectedChainId}
        setInitializingChainId={setInitializingChainId}
        supportedNetworks={supportedNetworks}
        walletChainId={walletChainId}
        switchNetwork={switchNetwork}
        pendingSignatureMessage={pendingSignatureMessage}
        onConfirm={() => confirmSignature(selectedChainId)}
        onCancel={cancelSignature}
      />

      <ReturningUserChainSelectionModal
        isOpen={showReturningUserChainModal}
        selectedChainId={selectedChainId}
        setSelectedChainId={setSelectedChainId}
        setInitializingChainId={setInitializingChainId}
        supportedNetworks={supportedNetworks}
        walletChainId={walletChainId}
        switchNetwork={switchNetwork}
        onConfirm={() => handleReturningUserChainChoice(true)}
        onCancel={() => handleReturningUserChainChoice(false)}
      />

      {/* Taskbar for minimized windows - Hidden on mobile */}
      {!mobileMode && <Taskbar />}

      {/* Titans Game Window */}
      {showTitansGame && (
        <WindowShell
          id="titans-game-terminal"
          title="titans-game"
          appType="game"
          statusLabel="Playing"
          statusTone="success"
          footerLeft="Process: titans-game"
          footerRight={`@lex:${currentLexieId}`}
          variant="game"
          fullscreen={mobileMode}
          onClose={() => setShowTitansGame(false)}
          initialSize={{ width: 1000, height: 700 }}
          initialPosition={{ x: 50, y: 50 }}
          minSize={{ width: 800, height: 600 }}
          className="z-[99]"
        >
          <TitansGameWindow
            lexieId={currentLexieId}
            walletAddress={address}
            onClose={() => setShowTitansGame(false)}
          />
        </WindowShell>
      )}

      {/* LexieAI Chat Window - Desktop */}
      {isLexieChatVisible && !isMobile && (
        <WindowShell
          id="lexie-chat-terminal"
          title="lexie-chat"
          appType="chat"
          statusLabel="Enable Degen Mode"
          statusTone="online"
          footerLeft="LexieAI Chat Terminal"
          footerRight="Secure LexieAI Communication Channel"
          variant="vault"
          fullscreen={false}
          onClose={() => setShowLexieChat(false)}
          initialSize={{ width: 1000, height: 700 }}
          initialPosition={{ x: 200, y: 100 }}
          minSize={{ width: 800, height: 600 }}
          className="z-[98]"
        >
          <ChatPage />
        </WindowShell>
      )}


      {/* Logo in top left - redirects to main site - only on desktop */}
      {!isMobile && (
        <div className="absolute md:top-6 md:left-5 -top-2 left-1 z-50 md:pl-6">
          <a
            href="https://www.lexiecrypto.com"
            className="hover:opacity-80 transition-opacity"
          >
            <span className="text-4xl font-bold text-purple-300">LEXIEAI</span>
          </a>
        </div>
      )}

      {/* Lexie Logo - Only show on desktop */}
      {!mobileMode && (
        <div className="fixed bottom-2 right-1 z-10">
          <img
            src="/lexie.png"
            alt="Lexie"
            className="w-[320px] h-[320px] opacity-80 hover:opacity-80 transition-opacity cursor-pointer"
            title="Click here to open up LexieChat"
            onClick={() => {
              const windowState = getWindowState('lexie-chat-terminal');
              // If window exists and is closed, reopen it first
              if (windowState && windowState.isClosed) {
                reopenWindow('lexie-chat-terminal');
              }
              setShowLexieChat(true);
            }}
          />
        </div>
      )}
    </div>
  );
};

const VaultDesktop = ({ externalWindowProvider = false }) => {
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
      <div className="min-h-screen bg-black">
        <Navbar />
        <WindowProvider>
          <VaultDesktopInner mobileMode={true} />
        </WindowProvider>
      </div>
    );
  }

  // If external WindowProvider is provided (like in WalletPage), don't wrap with our own
  if (externalWindowProvider) {
    return <VaultDesktopInner />;
  }

  return (
    <WindowProvider>
      <VaultDesktopInner />
    </WindowProvider>
  );
};

export default VaultDesktop;

