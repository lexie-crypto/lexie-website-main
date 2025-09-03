import React from 'react';
import useInjectedProviders from '../hooks/useInjectedProviders';
import { useWallet } from '../contexts/WalletContext';

/**
 * Renders detected injected wallets as connect buttons.
 * Clicking a button calls provider.request({ method: 'eth_requestAccounts' }).
 */
const InjectedProviderButtons = ({ disabled }) => {
  const { providers } = useInjectedProviders();
  const { connectWallet } = useWallet();

  const handleClick = async (provider, meta) => {
    try {
      await provider.request({ method: 'eth_requestAccounts' });
      // Use generic injected connector and pass through provider metadata
      await connectWallet('injected', { provider, name: meta?.name, id: meta?.id });
    } catch (err) {
      console.error('Failed to connect provider:', err);
    }
  };

  if (!providers || providers.length === 0) return null;

  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <button
          key={`${p.id || p.name}`}
          onClick={() => handleClick(p.provider, p)}
          disabled={disabled}
          className="w-full bg-emerald-600/30 hover:bg-emerald-600/50 disabled:bg-black/40 disabled:cursor-not-allowed text-emerald-200 py-3 px-6 rounded font-medium transition-colors flex items-center justify-center space-x-2 border border-emerald-400/40"
        >
          {p.icon && (p.icon.startsWith('data:') || p.icon.startsWith('http')) ? (
            <img src={p.icon} alt={p.name} className="w-5 h-5" />
          ) : (
            <span>{p.icon || '💼'}</span>
          )}
          <span>Connect {p.name}</span>
        </button>
      ))}
    </div>
  );
};

export default InjectedProviderButtons;


