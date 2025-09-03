import React, { useState } from 'react';
import useInjectedProviders from '../hooks/useInjectedProviders';
import { useWallet } from '../contexts/WalletContext';

/**
 * Renders detected injected wallets as connect buttons.
 * Clicking a button calls provider.request({ method: 'eth_requestAccounts' }).
 */
const InjectedProviderButtons = ({ disabled }) => {
  const { providers } = useInjectedProviders();
  const { connectWallet } = useWallet();
  const [busyKey, setBusyKey] = useState(null);

  const handleClick = async (provider, meta) => {
    try {
      const key = meta?.id || meta?.name;
      setBusyKey(key);
      await provider.request({ method: 'eth_requestAccounts' });
      // Use generic injected connector and pass through provider metadata
      await connectWallet('injected', { provider, name: meta?.name, id: meta?.id });
    } catch (err) {
      console.error('Failed to connect provider:', err);
    } finally {
      setBusyKey(null);
    }
  };

  if (!providers || providers.length === 0) return null;

  const onWalletConnect = () => {
    try { connectWallet('walletconnect'); } catch (e) { console.error(e); }
  };

  // Safe-style ordering
  const ORDER = ['Brave Wallet','Rabby Wallet','MetaMask','Coinbase Wallet','Trust Wallet','OKX Wallet','Bitget Wallet','Phantom'];
  const providersSorted = (providers || []).slice().sort((a, b) => ORDER.indexOf(a.info?.name) - ORDER.indexOf(b.info?.name));

  return (
    <div className="mt-6">
      <div className="grid grid-cols-3 gap-6">
        {providersSorted.map((p) => (
          <button
            key={p.info?.uuid || p.info?.rdns || p.info?.name}
            onClick={() => handleClick(p.provider, { name: p.info?.name, id: p.info?.uuid || p.info?.rdns })}
            disabled={disabled || busyKey === (p.info?.uuid || p.info?.rdns || p.info?.name)}
            className={[
              'flex items-center gap-4 rounded-xl border border-white/10 bg-white/5',
              'px-6 py-4 h-16',
              'hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400',
              'disabled:opacity-60 disabled:cursor-not-allowed',
            ].join(' ')}
            aria-label={`Connect ${p.info?.name}`}
          >
            {p.info?.icon ? (
              <img src={p.info.icon} alt="" className="h-6 w-6 rounded-md" />
            ) : (
              <span className="h-6 w-6" aria-hidden>🦊</span>
            )}
            <span className="text-emerald-200 font-medium whitespace-nowrap">{p.info?.name}</span>
          </button>
        ))}

        {/* WalletConnect tile */}
        <button
          onClick={() => { setBusyKey('walletconnect'); onWalletConnect(); }}
          disabled={busyKey === 'walletconnect'}
          className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 px-6 py-4 h-16 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
          aria-label="Connect with WalletConnect"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-blue-400" aria-hidden="true">
            <path fill="currentColor" d="M3.6 8.4c3.4-3.4 8.9-3.4 12.3 0l.5.5.5-.5c3.4-3.4 8.9-3.4 12.3 0l.6.6c.3.3.3.8 0 1.1l-1.9 1.9c-.3.3-.8.3-1.1 0l-.3-.3c-2.5-2.5-6.6-2.5-9.1 0l-.4.4c-.3.3-.8.3-1.1 0l-.4-.4c-2.5-2.5-6.6-2.5-9.1 0l-.3.3c-.3.3-.8.3-1.1 0L3 10.1c-.3-.3-.3-.8 0-1.1l.6-.6zm16 5.5 1.9 1.9c.3.3.3.8 0 1.1l-3.9 3.9c-.3.3-.8.3-1.1 0l-2.2-2.2a.3.3 0 0 0-.4 0l-.5.5a3 3 0 0 1-4.2 0l-.5-.5a.3.3 0 0 0-.4 0L6 20.8c-.3.3-.8.3-1.1 0l-3.9-3.9c-.3-.3-.3-.8 0-1.1l1.9-1.9c.3-.3.8-.3 1.1 0l3.9 3.9c.3.3.8.3 1.1 0L11.2 16a.3.3 0 0 1 .4 0l.5.5a3 3 0 0 0 4.2 0l.5-.5a.3.3 0 0 1 .4 0l2.2 2.2c.3.3.8.3 1.1 0l3.9-3.9c.3-.3.3-.8 0-1.1l-1.9-1.9c-.3-.3-.8-.3-1.1 0z"/>
          </svg>
          <span className="text-emerald-200 font-medium whitespace-nowrap">WalletConnect</span>
        </button>
      </div>
    </div>
  );
};

export default InjectedProviderButtons;


