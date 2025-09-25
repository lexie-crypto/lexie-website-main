import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import useInjectedProviders from '../hooks/useInjectedProviders';
import { useWallet } from '../contexts/WalletContext';

/**
 * Renders detected injected wallets as connect buttons.
 * Clicking a button calls provider.request({ method: 'eth_requestAccounts' }).
 */
const InjectedProviderButtons = ({ disabled }) => {
  const { providers } = useInjectedProviders();
  const { connectWallet, isConnected } = useWallet();
  const [busyKey, setBusyKey] = useState(null);

  // Reset busy state on disconnect to allow reconnection
  useEffect(() => {
    const handleDisconnect = () => {
      console.log('[InjectedProviderButtons] Received force-disconnect event, resetting busyKey');
      setBusyKey(null);
      // Force re-detection of providers after disconnect
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          window.dispatchEvent(new Event('eip6963:requestProvider'));
        }, 200);
      }
    };

    if (typeof window !== 'undefined') {
      console.log('[InjectedProviderButtons] Adding force-disconnect listener');
      window.addEventListener('force-disconnect', handleDisconnect);
      return () => {
        console.log('[InjectedProviderButtons] Removing force-disconnect listener');
        window.removeEventListener('force-disconnect', handleDisconnect);
      };
    }
  }, []);

  // Also reset busy state when providers change (safety net)
  useEffect(() => {
    setBusyKey(null);
  }, [providers]);

  // Reset busy state when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      console.log('[InjectedProviderButtons] Wallet disconnected, resetting busyKey');
      setBusyKey(null);
    }
  }, [isConnected]);


  const handleClick = async (provider, meta) => {
    const key = meta?.id || meta?.name;
    console.log('[InjectedProviderButtons] Setting busy key for', meta?.name, ':', key);
    console.log('[InjectedProviderButtons] Meta object:', meta);
    setBusyKey(key);

    try {
      // Check network BEFORE requesting accounts
      const chainIdHex = await provider.request({ method: 'eth_chainId' });
      const chainId = parseInt(chainIdHex, 16);

      console.log('[InjectedProviderButtons] Current chainId:', chainId);

      // Supported networks: Ethereum (1), Polygon (137), Arbitrum (42161), BNB Chain (56)
      const supportedNetworks = [1, 137, 42161, 56];
      if (!supportedNetworks.includes(chainId)) {
        console.log(`[InjectedProviderButtons] 🚫 Blocking connection on unsupported network (chainId: ${chainId})`);

        // Show toast notification for unsupported network
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-yellow-500/30 bg-black/90 text-yellow-200 shadow-2xl max-w-md">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Unsupported Network</div>
                  <div className="text-xs text-yellow-300/80 mt-1">
                    Your wallet is connected to an unsupported network (Chain ID: {chainId}). Please switch to Ethereum, Arbitrum, Polygon, or BNB Chain to use LexieVault features.
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.dismiss(t.id);
                  }}
                  className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-yellow-900/30 text-yellow-300/80 flex-shrink-0"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ), { duration: 8000 });

        return; // Don't proceed with connection, but don't throw error
      }

      console.log(`[InjectedProviderButtons] ✅ Network supported (chainId: ${chainId}), proceeding with connection`);
      await provider.request({ method: 'eth_requestAccounts' });
      // Use generic injected connector and pass through provider metadata
      await connectWallet('injected', { provider, name: meta?.name, id: meta?.id });
    } catch (err) {
      console.error('Failed to connect provider:', err);
      // Only re-throw if it's not a network validation issue (which we handle with toast)
      if (!err.message?.includes('switch to') && !err.message?.includes('Unsupported network')) {
        throw err; // Re-throw other errors
      }
    } finally {
      console.log('[InjectedProviderButtons] Finally block in handleClick - clearing busy key');
      setBusyKey(null);
    }
  };

  const [showWalletConnectWarning, setShowWalletConnectWarning] = useState(false);

  const onWalletConnect = async () => {
    try {
      setBusyKey('walletconnect');

      // Show pre-connection warning modal
      setShowWalletConnectWarning(true);

      // Wait for user to acknowledge the warning
      await new Promise((resolve, reject) => {
        const checkAcknowledged = () => {
          if (!showWalletConnectWarning) {
            resolve();
          } else {
            setTimeout(checkAcknowledged, 100);
          }
        };
        checkAcknowledged();
      });

      // For WalletConnect, we need to be more aggressive about network validation
      // since the chain is determined by the mobile wallet after QR scan
      console.log('[WalletConnect] Starting WalletConnect connection...');

      await connectWallet('walletconnect');

      // After connection, immediately check if we can determine the chain
      // WalletConnect might not have chainId immediately, so we'll rely on post-connection validation
      console.log('[WalletConnect] Connection established, network validation will happen in WalletContext');

    } catch (e) {
      console.error('[WalletConnect] Connection failed:', e);

      // Provide user-friendly error messages
      if (e.message?.includes('Unsupported network') || e.message?.includes('switch to') || e.message?.includes('Ethereum, Arbitrum, Polygon')) {
        throw new Error('Please ensure your mobile wallet is connected to Ethereum, Arbitrum, Polygon, or BNB Chain before connecting.');
      }

      // Handle other WalletConnect-specific errors
      if (e.message?.includes('User rejected') || e.message?.includes('rejected')) {
        throw new Error('Connection cancelled by user.');
      }

      throw e; // Re-throw other errors
    } finally {
      setBusyKey(null);
      setShowWalletConnectWarning(false);
    }
  };

  // Safe-style ordering
  const ORDER = ['Brave Wallet','Rabby Wallet','MetaMask','Coinbase Wallet','Trust Wallet','OKX Wallet','Bitget Wallet','Phantom'];
  const providersSorted = (providers || []).slice().sort((a, b) => ORDER.indexOf(a.info?.name) - ORDER.indexOf(b.info?.name));

  return (
    <div className="mt-6">
      {/* WalletConnect Pre-Connection Warning Modal */}
      {showWalletConnectWarning && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-mono">
          <div className="bg-gray-900 border border-yellow-500/30 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 rounded-full bg-yellow-400 flex-shrink-0" />
                <div className="text-lg font-semibold text-white">Network Check Required</div>
              </div>
            </div>

            <div className="p-6 text-green-300 space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-bold text-yellow-300 mb-3">⚠️ Important Network Check</h3>
                <p className="text-green-400/80 text-sm mb-4">
                  Before connecting with WalletConnect, please ensure your mobile wallet is connected to one of these supported networks:
                </p>

                <div className="bg-black/40 border border-green-500/20 rounded p-4 mb-6">
                  <div className="grid grid-cols-2 gap-2 text-xs text-green-200">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-blue-400"></div>
                      <span>Ethereum (Mainnet)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-blue-400"></div>
                      <span>Arbitrum</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-purple-400"></div>
                      <span>Polygon</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-yellow-400"></div>
                      <span>BNB Chain</span>
                    </div>
                  </div>
                </div>

                <p className="text-yellow-300/80 text-sm mb-6">
                  If you're on an unsupported network (like Optimism, Base, etc.), the connection will be automatically rejected.
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowWalletConnectWarning(false)}
                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors"
                  >
                    I Understand - Continue
                  </button>
                  <button
                    onClick={() => {
                      setShowWalletConnectWarning(false);
                      setBusyKey(null);
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {providersSorted.length === 0 ? (
        // Center WalletConnect button when no other providers detected
        <div className="flex justify-center">
          <button
            onClick={onWalletConnect}
            disabled={busyKey === 'walletconnect'}
            className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-4 h-16 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
            aria-label="Connect with WalletConnect"
          >
            <img src="/walletconnect.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            <span className="text-emerald-200 font-medium text-base whitespace-nowrap">WalletConnect</span>
          </button>
        </div>
      ) : (
        // Flex layout when other providers are available
        <div className="flex justify-center gap-4 flex-wrap">
          {/* Always show WalletConnect first */}
          <button
            onClick={onWalletConnect}
            disabled={busyKey === 'walletconnect'}
            className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-4 h-16 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
            aria-label="Connect with WalletConnect"
          >
            <img src="/walletconnect.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            <span className="text-emerald-200 font-medium text-base whitespace-nowrap">WalletConnect</span>
          </button>

          {providersSorted.map((p) => {
            const buttonKey = p.info?.uuid || p.info?.rdns || p.info?.name;
            const isButtonDisabled = disabled || busyKey === buttonKey;
            console.log('[InjectedProviderButtons] Rendering button for', p.info?.name, '- buttonKey:', buttonKey, '- busyKey:', busyKey, '- disabled:', isButtonDisabled);

            return (
              <button
                key={buttonKey}
                onClick={() => handleClick(p.provider, { name: p.info?.name, id: p.info?.uuid || p.info?.rdns })}
                disabled={isButtonDisabled}
                className="flex items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-4 h-16 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                aria-label={`Connect ${p.info?.name}`}
              >
                {p.info?.icon ? (
                  <img src={p.info.icon} alt="" className="h-6 w-6 rounded-md" />
                ) : (
                  <span className="h-6 w-6" aria-hidden>🦊</span>
                )}
                <span className="text-emerald-200 font-medium text-base whitespace-nowrap">{p.info?.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InjectedProviderButtons;


