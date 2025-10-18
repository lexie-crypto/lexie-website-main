import React, { useState } from 'react';

const ReturningUserChainSelectionModal = ({
  isOpen,
  selectedChainId,
  setSelectedChainId,
  setInitializingChainId,
  supportedNetworks,
  walletChainId,
  switchNetwork,
  onConfirm,
  onCancel
}) => {
  const [isModalChainMenuOpen, setIsModalChainMenuOpen] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50 p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden scrollbar-none">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">vault-network-select</span>
          </div>
          <button
            onClick={onCancel}
            className="text-green-400/70 hover:text-green-300 transition-colors text-lg"
            title="Cancel"
          >
            ×
          </button>
        </div>
        <div className="p-6 text-green-300 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-emerald-300 mb-2">Welcome Back to LexieVault</h3>
            <p className="text-green-400/80 text-sm">
              Your privacy wallet is ready. Choose the blockchain network to continue with your vault.
            </p>
          </div>

          {/* Chain Selection */}
          <div className="space-y-2">
            <div className="text-green-200 text-sm font-medium">Select Network:</div>
            <div className="relative">
              <button
                onClick={() => setIsModalChainMenuOpen((v) => !v)}
                className="px-3 py-2 bg-black/60 border border-emerald-500/40 rounded-md text-emerald-200 font-mono text-sm flex items-center gap-2 hover:bg-black/80 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-all duration-200"
                aria-haspopup="listbox"
                aria-expanded={isModalChainMenuOpen}
              >
                {supportedNetworks.find(n => n.id === selectedChainId)?.name || 'Choose Network'}
                <span className="ml-1">▾</span>
              </button>
              {isModalChainMenuOpen && (
                <>
                  {/* Backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setIsModalChainMenuOpen(false)} />
                  {/* Dropdown */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 z-20 mt-1 bg-black/95 border border-emerald-500/40 rounded-md shadow-2xl min-w-48">
                    {supportedNetworks.map((network) => (
                      <button
                        key={network.id}
                        type="button"
                        onClick={async () => {
                          console.log(`[Returning User Modal] User selected chain ${network.id}, current wallet chainId: ${walletChainId}`);
                          setSelectedChainId(network.id);
                          setInitializingChainId(network.id); // Track which chain we're initializing
                          setIsModalChainMenuOpen(false);
                          // Also switch the wallet to the selected network
                          try {
                            await switchNetwork(network.id);
                            console.log(`[Returning User Modal] Successfully switched wallet to chain ${network.id}, wallet should now be on chainId: ${network.id}`);
                          } catch (error) {
                            console.error(`[Returning User Modal] Failed to switch wallet to chain ${network.id}:`, error);
                          }
                        }}
                        className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-emerald-900/20 transition-colors duration-150 ${network.id === selectedChainId ? 'bg-emerald-900/30' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-base">{network.logo}</div>
                          <div>
                            <div className="font-medium text-emerald-200 text-sm">{network.name}</div>
                          </div>
                        </div>
                        {selectedChainId === network.id && (
                          <span className="text-emerald-400">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-500/40 rounded p-3">
            <div className="text-blue-300 text-xs font-medium mb-1">🔄 Network Selection:</div>
            <div className="text-blue-200/80 text-xs">
              Choose your preferred network to access your vault balances and privacy features on that blockchain.
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onConfirm}
              disabled={!selectedChainId || walletChainId !== selectedChainId}
              className={`flex-1 py-2.5 px-4 rounded border transition-all duration-200 text-sm font-medium ${
                !selectedChainId || walletChainId !== selectedChainId
                  ? 'bg-gray-700/30 text-gray-500 cursor-not-allowed border-gray-500/40'
                  : 'bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-200 border-emerald-400/40 hover:border-emerald-400'
              }`}
            >
              {!selectedChainId
                ? 'Select Network First'
                : walletChainId !== selectedChainId
                ? 'Switching Network...'
                : 'Continue to Vault'
              }
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-gray-700/30 hover:bg-gray-700/50 text-gray-300 py-2.5 px-4 rounded border border-gray-500/40 hover:border-gray-400 transition-all duration-200 text-sm font-medium"
            >
              Cancel
            </button>
          </div>

          {(!selectedChainId || walletChainId !== selectedChainId) && (
            <div className="text-center text-yellow-300/80 text-xs mt-2">
              {!selectedChainId
                ? 'Please select a network above to continue'
                : 'Waiting for wallet to switch networks...'
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReturningUserChainSelectionModal;
