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
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);

  if (!isOpen) return null;

  const handleNetworkSelect = async (network) => {
    console.log(`[Returning User Modal] User selected chain ${network.id}, current wallet chainId: ${walletChainId}`);
    setSelectedChainId(network.id);
    setInitializingChainId(network.id);
    setIsModalChainMenuOpen(false);

    // If wallet is on different chain, switch it
    if (walletChainId !== network.id) {
      setIsSwitchingNetwork(true);
      try {
        await switchNetwork(network.id);
        console.log(`[Returning User Modal] Successfully switched wallet to chain ${network.id}`);
      } catch (error) {
        console.error(`[Returning User Modal] Failed to switch wallet to chain ${network.id}:`, error);
      } finally {
        setIsSwitchingNetwork(false);
      }
    }
  };

  const handleConfirm = () => {
    console.log('[Returning User Modal] 🚀 Confirm button clicked, calling onConfirm callback');
    onConfirm();
  };

  // Button should be enabled as soon as a chain is selected
  // The actual network switch and balance refresh will happen in the callback
  const isConfirmDisabled = !selectedChainId;

  return (
    <>
      {/* Blocking backdrop - prevents all interactions */}
      <div className="fixed inset-0 bg-black/80 backdrop-blur-[2px] z-[99]" />
      <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 font-mono">
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
              Choose a blockchain network to continue with your LexieVault.
            </p>
          </div>

          {/* Chain Selection */}
          <div className="space-y-2">
            <div className="text-green-200 text-sm font-medium">Select Network:</div>
            <div className="relative">
                <button
                  onClick={() => setIsModalChainMenuOpen((v) => !v)}
                  disabled={isSwitchingNetwork}
                  className="px-3 py-2 bg-black/60 border border-emerald-500/40 rounded-md text-emerald-200 font-mono text-sm flex items-center gap-2 hover:bg-black/80 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        onClick={() => handleNetworkSelect(network)}
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
              Choose your preferred network to access your vault on that blockchain.
            </div>
          </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleConfirm}
                disabled={isConfirmDisabled || isSwitchingNetwork}
                className={`flex-1 py-2.5 px-4 rounded border transition-all duration-200 text-sm font-medium ${
                  isConfirmDisabled || isSwitchingNetwork
                    ? 'bg-gray-700/30 text-gray-500 cursor-not-allowed border-gray-500/40'
                    : 'bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-200 border-emerald-400/40 hover:border-emerald-400'
                }`}
              >
                {isSwitchingNetwork
                  ? 'Switching Network...'
                  : !selectedChainId
                  ? 'Select Network First'
                  : 'Continue to Vault'
                }
              </button>
              <button
                onClick={onCancel}
                disabled={isSwitchingNetwork}
                className="flex-1 bg-gray-700/30 hover:bg-gray-700/50 text-gray-300 py-2.5 px-4 rounded border border-gray-500/40 hover:border-gray-400 transition-all duration-200 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>

            {isSwitchingNetwork && (
              <div className="flex items-center justify-center gap-2 text-yellow-300/80 text-xs mt-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-400"></div>
                <span>Switching wallet network...</span>
              </div>
            )}

            {!selectedChainId && !isSwitchingNetwork && (
              <div className="text-center text-yellow-300/80 text-xs mt-2">
                Please select a network above to continue
              </div>
            )}
        </div>
      </div>
    </div>
    </>
  );
};

export default ReturningUserChainSelectionModal;
