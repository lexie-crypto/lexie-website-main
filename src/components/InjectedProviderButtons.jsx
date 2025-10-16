import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import useInjectedProviders from '../hooks/useInjectedProviders';
import { useWallet } from '../contexts/WalletContext';

/**
 * Renders detected injected wallets as connect buttons.
 * Clicking a button calls provider.request({ method: 'eth_requestAccounts' }).
 * Attempts to switch to selectedChainId before requesting accounts.
 */
const InjectedProviderButtons = ({ disabled, selectedChainId }) => {
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
    console.log('[InjectedProviderButtons] Selected chain ID:', selectedChainId);
    setBusyKey(key);

    try {
      // If a chain is selected, attempt to switch to it first
      if (selectedChainId) {
        const targetChainHex = `0x${selectedChainId.toString(16)}`;
        console.log(`[InjectedProviderButtons] 🔄 Attempting to switch to chain ${selectedChainId} (${targetChainHex})`);

        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainHex }],
          });
          console.log(`[InjectedProviderButtons] ✅ Successfully switched to chain ${selectedChainId}`);
        } catch (switchError) {
          console.warn(`[InjectedProviderButtons] ⚠️ Chain switch failed for chain ${selectedChainId}:`, switchError);

          // Handle specific chain switch errors
          if (switchError.code === 4902) {
            // Chain not added to wallet - try to add it
            console.log(`[InjectedProviderButtons] 🔗 Chain ${selectedChainId} not added to wallet, attempting to add...`);

            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const networkConfigs = {
              1: { // Ethereum
                chainId: '0x1',
                chainName: 'Ethereum Mainnet',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: [`${origin}/api/rpc?chainId=1&provider=auto`],
                blockExplorerUrls: ['https://etherscan.io/']
              },
              137: { // Polygon
                chainId: '0x89',
                chainName: 'Polygon Mainnet',
                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                rpcUrls: [`${origin}/api/rpc?chainId=137&provider=auto`],
                blockExplorerUrls: ['https://polygonscan.com/']
              },
              42161: { // Arbitrum
                chainId: '0xa4b1',
                chainName: 'Arbitrum One',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: [`${origin}/api/rpc?chainId=42161&provider=auto`],
                blockExplorerUrls: ['https://arbiscan.io/']
              },
              56: { // BNB Chain
                chainId: '0x38',
                chainName: 'BNB Smart Chain',
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                rpcUrls: [`${origin}/api/rpc?chainId=56&provider=auto`],
                blockExplorerUrls: ['https://bscscan.com/']
              }
            };

            const networkConfig = networkConfigs[selectedChainId];
            if (networkConfig) {
              try {
                await provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [networkConfig],
                });
                console.log(`[InjectedProviderButtons] ✅ Successfully added chain ${selectedChainId}`);

                // Now try switching again
                await provider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: targetChainHex }],
                });
                console.log(`[InjectedProviderButtons] ✅ Successfully switched to newly added chain ${selectedChainId}`);
              } catch (addError) {
                console.error(`[InjectedProviderButtons] ❌ Failed to add chain ${selectedChainId}:`, addError);
                throw new Error(`Please add the ${networkConfig.chainName} network to your wallet manually and try again.`);
              }
            } else {
              throw new Error(`Unsupported chain ID: ${selectedChainId}`);
            }
          } else if (switchError.code === 4001) {
            // User rejected the request
            throw new Error('Chain switch cancelled by user.');
          } else {
            // Other chain switch error
            throw new Error(`Failed to switch to the selected network. Please switch to the correct network manually.`);
          }
        }
      }

      // Request accounts after chain switching (if any)
      console.log('[InjectedProviderButtons] 🔑 Requesting accounts...');
      await provider.request({ method: 'eth_requestAccounts' });

      // Use generic injected connector and pass through provider metadata
      await connectWallet('injected', { provider, name: meta?.name, id: meta?.id });
    } catch (err) {
      console.error('Failed to connect provider:', err);

      // Show user-friendly error message for chain-related issues
      if (err.message?.includes('switch to') || err.message?.includes('add') || err.message?.includes('network')) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-yellow-500/30 bg-black/90 text-yellow-200 shadow-2xl max-w-md">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Network Setup Required</div>
                  <div className="text-xs text-yellow-300/80 mt-1">
                    {err.message}
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
        return; // Don't proceed with connection
      }

      // Re-throw other errors
      throw err;
    } finally {
      console.log('[InjectedProviderButtons] Finally block in handleClick - clearing busy key');
      setBusyKey(null);
    }
  };

  const onWalletConnect = async () => {
    try {
      setBusyKey('walletconnect');

      // Show user guidance about the selected network
      const networkNames = {
        1: 'Ethereum',
        137: 'Polygon',
        42161: 'Arbitrum',
        56: 'BNB Chain'
      };

      const selectedNetworkName = networkNames[selectedChainId] || 'Ethereum';

      console.log(`[WalletConnect] Starting WalletConnect connection...`);
      console.log(`[WalletConnect] User selected network: ${selectedNetworkName} (chain ID: ${selectedChainId})`);

      // Show a toast to guide the user about network selection
      if (selectedChainId && selectedChainId !== 1) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-blue-500/30 bg-black/90 text-blue-200 shadow-2xl max-w-md">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Network Selection Required</div>
                  <div className="text-xs text-blue-300/80 mt-1">
                    After scanning the QR code, please select <strong>{selectedNetworkName}</strong> in your mobile wallet to create your vault on the correct network.
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.dismiss(t.id);
                  }}
                  className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-blue-900/30 text-blue-300/80 flex-shrink-0"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ), { duration: 10000 });
      }

      await connectWallet('walletconnect');

      // After connection, wait a moment for chainId to be available and validate
      console.log('[WalletConnect] Connection established, waiting for chain validation...');

      // Wait for chainId to be available (WalletConnect can be slow)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if we're on the correct network
      try {
        const walletConnectConnector = window?.wagmi?.connectors?.find(c => c.id === 'walletConnect');
        if (walletConnectConnector) {
          const provider = await walletConnectConnector.getProvider();
          if (provider) {
            const chainIdHex = await provider.request({ method: 'eth_chainId' });
            const connectedChainId = parseInt(chainIdHex, 16);

            console.log(`[WalletConnect] Connected to chain ${connectedChainId}, selected chain ${selectedChainId}`);

            if (connectedChainId !== selectedChainId) {
              const networkNames = {
                1: 'Ethereum',
                137: 'Polygon',
                42161: 'Arbitrum',
                56: 'BNB Chain'
              };
              const connectedNetworkName = networkNames[connectedChainId] || `Chain ${connectedChainId}`;
              const selectedNetworkName = networkNames[selectedChainId] || `Chain ${selectedChainId}`;

              toast.custom((t) => (
                <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                  <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl max-w-md">
                    <div className="px-4 py-3 flex items-start gap-3">
                      <div className="h-5 w-5 rounded-full bg-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">Wrong Network Selected</div>
                        <div className="text-xs text-red-300/80 mt-1">
                          You selected <strong>{selectedNetworkName}</strong> but connected to <strong>{connectedNetworkName}</strong>.
                          Please disconnect and select <strong>{selectedNetworkName}</strong> in your mobile wallet.
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={(e) => {
                          e.stopPropagation();
                          toast.dismiss(t.id);
                        }}
                        className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80 flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ), { duration: 15000 });

              // Disconnect to let them try again
              setTimeout(() => {
                if (window?.wagmi?.disconnect) {
                  window.wagmi.disconnect();
                }
              }, 1000);

              return; // Don't proceed
            }
          }
        }
      } catch (chainCheckError) {
        console.warn('[WalletConnect] Could not verify chain:', chainCheckError);
        // Continue anyway if we can't check
      }

      console.log('[WalletConnect] Chain validation completed successfully');

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


