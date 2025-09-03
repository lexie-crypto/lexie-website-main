// Minimal ESM connector that always returns the clicked EIP-1193 provider
// Usage: connect({ connector: clickedInjectedConnector(provider, name) })

import { getAddress } from 'viem';

export function clickedInjectedConnector(provider, name = 'Injected') {
  return {
    id: 'injected-clicked',
    name,
    type: 'injected',
    async connect() {
      try { await provider?.request?.({ method: 'eth_requestAccounts' }); } catch {}
      const accounts = (await provider?.request?.({ method: 'eth_accounts' })) || [];
      const account = accounts[0] ? getAddress(accounts[0]) : undefined;
      const chainIdHex = await provider?.request?.({ method: 'eth_chainId' });
      const chainId = Number(chainIdHex);
      return {
        account,
        chain: { id: chainId, unsupported: false },
        provider,
      };
    },
    async disconnect() { /* no-op */ },
    async getProvider() { return provider; },
    async getChainId() {
      const id = await provider?.request?.({ method: 'eth_chainId' });
      return Number(id);
    },
    async getAccounts() {
      const accs = (await provider?.request?.({ method: 'eth_accounts' })) || [];
      return accs.map((a) => getAddress(a));
    },
    onAccountsChanged(handler) { try { provider?.on?.('accountsChanged', handler); } catch {} },
    onChainChanged(handler) { try { provider?.on?.('chainChanged', handler); } catch {} },
    onDisconnect(handler) { try { provider?.on?.('disconnect', handler); } catch {} },
  };
}


