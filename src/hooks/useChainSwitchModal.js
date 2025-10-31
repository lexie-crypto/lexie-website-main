import { useState, useEffect, useRef } from 'react';

export const useChainSwitchModal = () => {
  const [showSignRequestPopup, setShowSignRequestPopup] = useState(false);
  const [initProgress, setInitProgress] = useState({ percent: 0, message: '' });
  const [isInitInProgress, setIsInitInProgress] = useState(false);
  const [initFailedMessage, setInitFailedMessage] = useState('');
  const [bootstrapProgress, setBootstrapProgress] = useState({ percent: 0, active: false });
  const [initializingChainId, setInitializingChainId] = useState(null);
  const [scanComplete, setScanComplete] = useState(false);

  const bootstrapLockedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);

  // Helper to get network name by chain ID
  const getNetworkNameById = (chainId) => {
    return {
      1: 'Ethereum',
      137: 'Polygon',
      42161: 'Arbitrum',
      56: 'BNB Chain'
    }[Number(chainId)] || `Chain ${chainId}`;
  };

  // Handle persist metadata (modal unlock)
  const handlePersistMetadata = async () => {
    // This would be implemented with the actual logic
    console.log(`🔓 Modal unlocking - marking chain ${initializingChainId} as scanned`);
  };

  // Start chain switch modal
  const startChainSwitch = (chainId, networkName) => {
    console.log('[ChainSwitchModal] Starting modal for chain', chainId);
    setInitializingChainId(chainId);
    setShowSignRequestPopup(true);
    setIsInitInProgress(true);
    setScanComplete(false);
    setBootstrapProgress(prev => prev.percent < 100 ? { percent: 0, active: true } : prev);
    setInitProgress({
      percent: 0,
      message: `Setting up your LexieVault on ${networkName} Network...`
    });
  };

  // Update progress
  const updateProgress = (progress, message) => {
    setInitProgress({ percent: progress, message: message || initProgress.message });
  };

  // Update bootstrap progress
  const updateBootstrapProgress = (chainId, progress) => {
    const newPercent = Math.round(progress * 100) / 100;
    setInitializingChainId(chainId);

    setBootstrapProgress(prev => {
      const finalPercent = bootstrapLockedRef.current && newPercent < prev.percent ? prev.percent : newPercent;
      return { percent: finalPercent, active: true };
    });

    if (newPercent >= 100 && !bootstrapLockedRef.current) {
      bootstrapLockedRef.current = true;
      const networkName = getNetworkNameById(chainId);
      setInitProgress(prev => ({
        ...prev,
        message: `Creating your LexieVault on ${networkName} Network...`
      }));
    }
  };

  // Complete chain switch
  const completeChainSwitch = () => {
    console.log('[ChainSwitchModal] Completing modal');
    setScanComplete(true);
    setIsInitInProgress(false);
    setInitProgress({ percent: 100, message: 'Chain switch complete!' });
  };

  // Fail chain switch
  const failChainSwitch = (error) => {
    console.log('[ChainSwitchModal] Failing modal with error:', error);
    setInitFailedMessage(error);
    setIsInitInProgress(false);
  };

  // Reset modal state
  const resetModal = () => {
    setShowSignRequestPopup(false);
    setIsInitInProgress(false);
    setInitFailedMessage('');
    setInitProgress({ percent: 0, message: '' });
    setBootstrapProgress({ percent: 0, active: false });
    setScanComplete(false);
    bootstrapLockedRef.current = false;
  };

  // Listen for chain switch events
  useEffect(() => {
    const onInitStarted = (e) => {
      const chainId = e?.detail?.chainId || initializingChainId;
      const networkName = getNetworkNameById(chainId);
      startChainSwitch(chainId, networkName);
    };

    const onScanStarted = (e) => {
      if (!initialConnectDoneRef.current) return;
      const chainId = e?.detail?.chainId || initializingChainId;
      const networkName = getNetworkNameById(chainId);
      startChainSwitch(chainId, networkName);
    };

    const onBootstrapProgress = (e) => {
      const { chainId, progress } = e.detail;
      updateBootstrapProgress(chainId, progress);
    };

    const onScanComplete = () => {
      completeChainSwitch();
    };

    const onInitFailed = (e) => {
      const error = e?.detail?.error || 'Chain switch failed';
      failChainSwitch(error);
    };

    // Listen for events
    window.addEventListener('railgun-init-started', onInitStarted);
    window.addEventListener('railgun-scan-started', onScanStarted);
    window.addEventListener('chain-bootstrap-progress', onBootstrapProgress);
    window.addEventListener('railgun-scan-complete', onScanComplete);
    window.addEventListener('railgun-init-failed', onInitFailed);

    return () => {
      window.removeEventListener('railgun-init-started', onInitStarted);
      window.removeEventListener('railgun-scan-started', onScanStarted);
      window.removeEventListener('chain-bootstrap-progress', onBootstrapProgress);
      window.removeEventListener('railgun-scan-complete', onScanComplete);
      window.removeEventListener('railgun-init-failed', onInitFailed);
    };
  }, [initializingChainId]);

  // Mark initial connect as done
  useEffect(() => {
    const markDone = () => { initialConnectDoneRef.current = true; };
    window.addEventListener('railgun-wallet-metadata-ready', markDone);
    window.addEventListener('railgun-init-completed', markDone);
    return () => {
      window.removeEventListener('railgun-wallet-metadata-ready', markDone);
      window.removeEventListener('railgun-init-completed', markDone);
    };
  }, []);

  // Reset modal when it closes
  useEffect(() => {
    if (!showSignRequestPopup) {
      setBootstrapProgress({ percent: 0, active: false });
      bootstrapLockedRef.current = false;
    }
  }, [showSignRequestPopup]);

  return {
    // State
    showSignRequestPopup,
    initProgress,
    isInitInProgress,
    initFailedMessage,
    bootstrapProgress,
    initializingChainId,
    scanComplete,

    // Functions
    startChainSwitch,
    updateProgress,
    updateBootstrapProgress,
    completeChainSwitch,
    failChainSwitch,
    resetModal,
    handlePersistMetadata,
    setInitializingChainId,

    // Helpers
    getNetworkNameById
  };
};
