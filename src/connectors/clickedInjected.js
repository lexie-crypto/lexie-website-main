// Minimal ESM connector that always returns the clicked EIP-1193 provider
// Usage: connect({ connector: clickedInjectedConnector(provider, name) })

import { getAddress } from 'viem';

export function clickedInjectedConnector(provider, name = 'Injected') {
  return {
    id: 'injected-clicked',
    name,
    type: 'injected',
    async connect() {
      // First try to get existing accounts
      let accounts = (await provider?.request?.({ method: 'eth_accounts' })) || [];

      // If no accounts, request permission and re-read
      if (!accounts || accounts.length === 0) {
        try {
          await provider?.request?.({ method: 'eth_requestAccounts' });
          accounts = (await provider?.request?.({ method: 'eth_accounts' })) || [];
        } catch (error) {
          // If request fails, continue with empty accounts
          console.warn('[clickedInjectedConnector] eth_requestAccounts failed:', error);
        }
      }

      const account = accounts[0] ? getAddress(accounts[0]) : undefined;
      const chainIdHex = await provider?.request?.({ method: 'eth_chainId' });
      const chainId = Number(chainIdHex);
      return {
        account,
        chain: { id: chainId, unsupported: false },
        provider,
      };
    },
    async disconnect() {
      // Try to disconnect from the provider if it has a disconnect method
      try {
        if (provider?.disconnect) {
          await provider.disconnect();
        }
      } catch (e) {
        // Ignore disconnect errors
      }
    },
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


