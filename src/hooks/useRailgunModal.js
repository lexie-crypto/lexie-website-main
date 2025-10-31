/**
 * Custom hook for managing Railgun initialization modal state and events
 * Handles both wallet creation and chain switching modal flows
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export const useRailgunModal = ({
  activeChainId,
  network,
  checkChainReady,
  getNetworkNameById
}) => {
  // Modal state
  const [showSignRequestPopup, setShowSignRequestPopup] = useState(false);
  const [initProgress, setInitProgress] = useState({ percent: 0, message: '' });
  const [isInitInProgress, setIsInitInProgress] = useState(false);
  const [initFailedMessage, setInitFailedMessage] = useState('');
  const [bootstrapProgress, setBootstrapProgress] = useState({ percent: 0, active: false });
  const [initializingChainId, setInitializingChainId] = useState(null);
  const [scanComplete, setScanComplete] = useState(false);

  // Refs
  const bootstrapLockedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);

  // Helper to reset modal state
  const resetModalState = useCallback(() => {
    setShowSignRequestPopup(false);
    setIsInitInProgress(false);
    setInitFailedMessage('');
    setInitProgress({ percent: 0, message: '' });
    setBootstrapProgress({ percent: 0, active: false });
    setScanComplete(false);
    bootstrapLockedRef.current = false;
  }, []);

  // Event handlers - simplified to avoid initialization issues
  const eventHandlersRef = useRef({});

  // Initialize event handlers only once
  if (!eventHandlersRef.current.onSignRequest) {
    eventHandlersRef.current = {
      onSignRequest: () => {
        setShowSignRequestPopup(true);
        setIsInitInProgress(false);
        setInitProgress({ percent: 0, message: '' });
        setInitFailedMessage('');
        console.log('[RailgunModal] Signature requested - showing modal');
      },

      onInitStarted: (e) => {
        setShowSignRequestPopup(true);
        setScanComplete(false);
        setIsInitInProgress(true);
        setBootstrapProgress(prev => prev.percent < 100 ? { percent: 0, active: true } : prev);
        setInitFailedMessage('');

        const chainToInit = e?.detail?.chainId || activeChainId;
        setInitializingChainId(chainToInit);

        const chainLabel = getNetworkNameById ? getNetworkNameById(chainToInit) : `Chain ${chainToInit}`;
        setInitProgress({ percent: 0, message: `Setting up your LexieVault on ${chainLabel} Network...` });
        console.log('[RailgunModal] Initialization started');
      },

      onScanStarted: async (e) => {
        if (!initialConnectDoneRef.current) return;

        try {
          if (checkChainReady) {
            const ready = await checkChainReady();
            if (!ready) eventHandlersRef.current.onInitStarted(e);
          } else {
            eventHandlersRef.current.onInitStarted(e);
          }
        } catch {
          eventHandlersRef.current.onInitStarted(e);
        }
      },

      onInitProgress: () => {
        const chainLabel = network?.name || (activeChainId ? `Chain ${activeChainId}` : 'network');
        setInitProgress((prev) => ({
          percent: prev.percent,
          message: prev.message || `Setting up your LexieVault on ${chainLabel}...`,
        }));
      },

      onInitCompleted: () => {
        console.log('[RailgunModal] SDK reported completed; awaiting confirmation');
        setInitProgress((prev) => ({ ...prev, message: prev.message || 'Finalizing...' }));
      },

      onInitFailed: (e) => {
        const msg = e?.detail?.error || 'Initialization failed';
        setInitFailedMessage(msg);
        setIsInitInProgress(false);
        console.warn('[RailgunModal] Initialization failed:', msg);
      },

      onVaultInitComplete: () => {
        console.log('[RailgunModal] Force unlocking initialization modal');
        setIsInitInProgress(false);
        setInitProgress({ percent: 100, message: 'Initialization complete' });
      },

      onRailgunInitForceUnlock: () => {
        console.log('[RailgunModal] Railgun initialization completed - modal will unlock when scanning completes');
        setInitProgress({ percent: 95, message: 'Railgun ready - completing chain scan...' });
      },

      onBootstrapProgress: (e) => {
        const { chainId: eventChainId, progress } = e.detail;
        setInitializingChainId(eventChainId);

        const bootstrapNetworkName = getNetworkNameById ? getNetworkNameById(eventChainId) : `Chain ${eventChainId}`;

        console.log('[RailgunModal] Bootstrap progress event:', {
          eventChainId,
          progress,
          currentChainId: activeChainId,
          networkName: bootstrapNetworkName
        });

        const newPercent = Math.round(progress * 100) / 100;
        console.log('[RailgunModal] Updating progress bar for chain', eventChainId, 'progress:', progress, '->', newPercent + '%');

        setBootstrapProgress(prev => {
          const finalPercent = bootstrapLockedRef.current && newPercent < prev.percent ? prev.percent : newPercent;
          return { percent: finalPercent, active: true };
        });

        if (newPercent >= 100 && !bootstrapLockedRef.current) {
          bootstrapLockedRef.current = true;
          setInitProgress(prev => ({
            ...prev,
            message: `Creating your LexieVault on ${bootstrapNetworkName} Network...`
          }));
        }
      }
    };
  }

  // Set up event listeners
  useEffect(() => {
    const handlers = eventHandlersRef.current;

    if (typeof window !== 'undefined') {
      window.addEventListener('railgun-signature-requested', handlers.onSignRequest);
      window.addEventListener('railgun-init-started', handlers.onInitStarted);
      window.addEventListener('railgun-scan-started', handlers.onScanStarted);
      window.addEventListener('railgun-init-progress', handlers.onInitProgress);
      window.addEventListener('railgun-init-completed', handlers.onInitCompleted);
      window.addEventListener('railgun-init-failed', handlers.onInitFailed);
      window.addEventListener('vault-initialization-complete', handlers.onVaultInitComplete);
      window.addEventListener('railgun-init-force-unlock', handlers.onRailgunInitForceUnlock);
      window.addEventListener('chain-bootstrap-progress', handlers.onBootstrapProgress);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('railgun-signature-requested', handlers.onSignRequest);
        window.removeEventListener('railgun-init-started', handlers.onInitStarted);
        window.removeEventListener('railgun-scan-started', handlers.onScanStarted);
        window.removeEventListener('railgun-init-progress', handlers.onInitProgress);
        window.removeEventListener('railgun-init-completed', handlers.onInitCompleted);
        window.removeEventListener('railgun-init-failed', handlers.onInitFailed);
        window.removeEventListener('vault-initialization-complete', handlers.onVaultInitComplete);
        window.removeEventListener('railgun-init-force-unlock', handlers.onRailgunInitForceUnlock);
        window.removeEventListener('chain-bootstrap-progress', handlers.onBootstrapProgress);
      }
    };
  }, []); // Empty dependency array since handlers are stable

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

  // Reset bootstrap progress when modal closes
  useEffect(() => {
    if (!showSignRequestPopup) {
      setBootstrapProgress({ percent: 0, active: false });
      bootstrapLockedRef.current = false; // Reset the 100% lock
    }
  }, [showSignRequestPopup]);

  // Re-check readiness immediately after scan completes
  useEffect(() => {
    const onScanComplete = () => {
      console.log('[RailgunModal] Chain scanning completed - unlocking modal');
      setScanComplete(true);
      setInitProgress({ percent: 100, message: 'Vault ready - initialization complete!' });
      setIsInitInProgress(false);
      checkChainReady().then((ready) => {
        // Modal will close based on scanComplete state
      }).catch(() => {
        // Modal will still close
      });
    };
    window.addEventListener('railgun-scan-complete', onScanComplete);
    return () => window.removeEventListener('railgun-scan-complete', onScanComplete);
  }, [checkChainReady]);

  return {
    // Modal state
    showSignRequestPopup,
    initProgress,
    isInitInProgress,
    initFailedMessage,
    bootstrapProgress,
    initializingChainId,
    scanComplete,

    // Modal controls
    resetModalState,
    setShowSignRequestPopup,
    setIsInitInProgress,
    setInitProgress,
    setBootstrapProgress,
    setScanComplete
  };
};
