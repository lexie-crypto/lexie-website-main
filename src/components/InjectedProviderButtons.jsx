import React, { useState, useEffect } from 'react';
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

    // Safety timeout - reset busyKey after 30 seconds in case of hang
    const safetyTimeout = setTimeout(() => {
      console.log('[InjectedProviderButtons] Safety timeout - resetting busyKey');
      setBusyKey(null);
    }, 30000);

    try {
      // Just like WalletConnect - let wagmi handle the connection through the clickedInjectedConnector
      await connectWallet('injected', { provider, name: meta?.name, id: meta?.id });
      console.log('[InjectedProviderButtons] Connection successful');
    } catch (err) {
      console.error('Failed to connect provider:', err);
      // Don't re-throw - we handle it here
    } finally {
      clearTimeout(safetyTimeout);
      console.log('[InjectedProviderButtons] Clearing busy key');
      setBusyKey(null);
    }
  };

  const onWalletConnect = async () => {
    console.log('[InjectedProviderButtons] Setting busy key for WalletConnect: walletconnect');
    setBusyKey('walletconnect');

    // Safety timeout - reset busyKey after 30 seconds in case of hang
    const safetyTimeout = setTimeout(() => {
      console.log('[InjectedProviderButtons] Safety timeout - resetting busyKey for WalletConnect');
      setBusyKey(null);
    }, 30000);

    try {
      await connectWallet('walletconnect');
      console.log('[InjectedProviderButtons] WalletConnect connection successful');
    } catch (e) {
      console.error('WalletConnect connection failed:', e);
      // Don't re-throw - we handle it here
    } finally {
      clearTimeout(safetyTimeout);
      console.log('[InjectedProviderButtons] Clearing busy key for WalletConnect');
      setBusyKey(null);
    }
  };

  // Safe-style ordering
  const ORDER = ['Brave Wallet','Rabby Wallet','MetaMask','Coinbase Wallet','Trust Wallet','OKX Wallet','Bitget Wallet','Phantom'];
  const providersSorted = (providers || []).slice().sort((a, b) => ORDER.indexOf(a.info?.name) - ORDER.indexOf(b.info?.name));

  return (
    <div className="mt-6">
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

          {providersSorted.map((p) => (
            <button
              key={p.info?.uuid || p.info?.rdns || p.info?.name}
              onClick={() => handleClick(p.provider, { name: p.info?.name, id: p.info?.uuid || p.info?.rdns })}
              disabled={disabled || busyKey === (p.info?.uuid || p.info?.rdns || p.info?.name)}
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
            ))}
        </div>
      )}
    </div>
  );
};

export default InjectedProviderButtons;


