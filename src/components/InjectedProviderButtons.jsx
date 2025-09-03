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
          <svg viewBox="0 0 400 400" className="h-6 w-6 rounded-md text-blue-400" aria-hidden>
            <path fill="currentColor" d="M97.7 163.3c54.3-54.3 142.3-54.3 196.6 0l6.6 6.6c2.7 2.7 2.7 7.2 0 9.9l-23 23c-1.3 1.3-3.5 1.3-4.8 0l-9-9c-37-37-97.1-37-134.1 0l-9 9c-1.3 1.3-3.5 1.3-4.8 0l-23-23c-2.7-2.7-2.7-7.2 0-9.9l6.3-6.6zM365 213l20.6 20.6c2.7 2.7 2.7 7.2 0 9.9l-74.1 74.1c-2.7 2.7-7.2 2.7-9.9 0L250.5 267c-.5-.5-1.3-.5-1.8 0l-11.8 11.8c-17.4 17.4-45.5 17.4-62.9 0L162.2 267c-.5-.5-1.3-.5-1.8 0l-51.1 51.1c-2.7 2.7-7.2 2.7-9.9 0l-74.1-74.1c-2.7-2.7-2.7-7.2 0-9.9L45.9 213c2.7-2.7 7.2-2.7 9.9 0l74.1 74.1c2.7 2.7 7.2 2.7 9.9 0l51.1-51.1c.5-.5 1.3-.5 1.8 0l11.8 11.8c17.4 17.4 45.5 17.4 62.9 0l11.8-11.8c.5-.5 1.3-.5 1.8 0l51.1 51.1c2.7 2.7 7.2 2.7 9.9 0l74.1-74.1c2.7-2.7 2.7-7.2 0-9.9L375 213c-2.7-2.7-7.2-2.7-9.9 0z"/>
          </svg>
          <span className="text-emerald-200 font-medium whitespace-nowrap">WalletConnect</span>
        </button>
      </div>
    </div>
  );
};

export default InjectedProviderButtons;


