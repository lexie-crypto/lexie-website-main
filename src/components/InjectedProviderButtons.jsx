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

  const onWalletConnect = () => {
    try { connectWallet('walletconnect'); } catch (e) { console.error(e); }
  };

  // Safe-style ordering
  const ORDER = ['Brave Wallet','Rabby Wallet','MetaMask','Coinbase Wallet','Trust Wallet','OKX Wallet','Bitget Wallet','Phantom'];
  const providersSorted = (providers || []).slice().sort((a, b) => ORDER.indexOf(a.info?.name) - ORDER.indexOf(b.info?.name));

  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
        {/* Always show WalletConnect first */}
        <button
          onClick={() => { setBusyKey('walletconnect'); onWalletConnect(); }}
          disabled={busyKey === 'walletconnect'}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 h-14 sm:px-6 sm:py-4 sm:h-16 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
          aria-label="Connect with WalletConnect"
        >
          <img src="/walletconnect.svg" alt="" aria-hidden="true" className="h-5 w-5 sm:h-6 sm:w-6" />
          <span className="text-emerald-200 font-medium text-sm sm:text-base whitespace-nowrap">WalletConnect</span>
        </button>

        {providersSorted.map((p) => (
          <button
            key={p.info?.uuid || p.info?.rdns || p.info?.name}
            onClick={() => handleClick(p.provider, { name: p.info?.name, id: p.info?.uuid || p.info?.rdns })}
            disabled={disabled || busyKey === (p.info?.uuid || p.info?.rdns || p.info?.name)}
            className={[
              'flex items-center gap-3 rounded-xl border border-white/10 bg-white/5',
              'px-4 py-3 h-14 sm:px-6 sm:py-4 sm:h-16',
              'hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400',
              'disabled:opacity-60 disabled:cursor-not-allowed',
            ].join(' ')}
            aria-label={`Connect ${p.info?.name}`}
          >
            {p.info?.icon ? (
              <img src={p.info.icon} alt="" className="h-5 w-5 sm:h-6 sm:w-6 rounded-md" />
            ) : (
              <span className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden>🦊</span>
            )}
            <span className="text-emerald-200 font-medium text-sm sm:text-base whitespace-nowrap">{p.info?.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default InjectedProviderButtons;


