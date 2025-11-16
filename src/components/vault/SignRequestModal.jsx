import React from 'react';

const SignRequestModal = ({
  isOpen,
  isInitInProgress,
  initProgress,
  initFailedMessage,
  address,
  getNetworkNameById,
  initializingChainId,
  activeChainId,
  bootstrapProgress,
  railgunWalletId,
  railgunAddress,
  onPersistMetadata,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50 p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden scrollbar-none">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">vault-sign</span>
          </div>
          {isInitInProgress ? (
            <div className="text-yellow-400 text-xs">LOCKED</div>
          ) : null}
        </div>
        <div className="p-6 text-green-300 space-y-4">
          {!isInitInProgress && initProgress.percent < 100 && !initFailedMessage ? (
            <>
              <h3 className="text-lg font-bold text-emerald-300">Sign to Create Your LexieVault</h3>
              <p className="text-green-400/80 text-sm">
                A signature request was sent to your wallet. Please approve this message to begin creating your LexieVault.
              </p>
              <div className="bg-black/40 border border-green-500/20 rounded p-3 text-xs">
                <div>Message preview:</div>
                <pre className="mt-2 whitespace-pre-wrap text-green-200">LexieVault Creation Address: {address}. Sign this message to create your LexieVault.</pre>
              </div>
            </>
          ) : initFailedMessage ? (
            <>
              <h3 className="text-lg font-bold text-red-300">Vault Initialization Failed</h3>
              <p className="text-red-300/80 text-sm">{initFailedMessage}</p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-emerald-300">Initializing Your LexieVault on {getNetworkNameById(initializingChainId || activeChainId)} Network</h3>
              <p className="text-green-400/80 text-sm">You only need to do this once. This may take a few minutes. Do not close this window.</p>
              <div className="bg-black/40 border border-green-500/20 rounded p-4 space-y-3">
                {bootstrapProgress.active && bootstrapProgress.percent > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-green-400/80">
                      <span>
                        {Math.min(bootstrapProgress.percent, isInitInProgress ? 99 : 100) === 100
                          ? 'vault setup complete you can now close the window 🎉'
                          : Math.min(bootstrapProgress.percent, isInitInProgress ? 99 : 100) === 99
                          ? 'Syncing vault to the Zk Network...'
                          : 'Loading blockchain data...'}
                      </span>
                      <span>{Math.min(bootstrapProgress.percent, isInitInProgress ? 99 : 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-emerald-400 to-green-400 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${Math.min(bootstrapProgress.percent, isInitInProgress ? 99 : 100)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className={`h-5 w-5 rounded-full border-2 ${isInitInProgress || bootstrapProgress.active ? 'border-emerald-400 border-t-transparent animate-spin' : 'border-emerald-400'}`} />
                    <div className="text-xs text-green-400/80 truncate" title={bootstrapProgress.active ? (bootstrapProgress.percent === 100 ? 'vault setup complete you can now close the window 🎉' : bootstrapProgress.percent === 99 ? 'Syncing vault to the Zk Network...' : 'Loading blockchain data...') : initProgress.message}>
                      {bootstrapProgress.active ? (bootstrapProgress.percent === 100 ? 'vault setup complete you can now close the window 🎉' : bootstrapProgress.percent === 99 ? 'Syncing vault to the Zk Network...' : 'Loading blockchain data...') : (initProgress.message || 'Scanning...')}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-2">
                <div className="text-green-400/60 text-xs text-center">
                  🔐 Your vault is being created securely using zero-knowledge cryptography.
                </div>
              </div>
            </>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            {!isInitInProgress && initProgress.percent >= 100 && !initFailedMessage ? (
              <button
                onClick={async () => {
                  // Mark chain as scanned when modal unlocks successfully
                  try {
                    console.log(`🔓 Modal unlocking - marking chain ${activeChainId} as scanned for wallet ${railgunWalletId}`);
                    await onPersistMetadata();
                  } catch (scanError) {
                    console.warn(`⚠️ Error marking chain ${activeChainId} as scanned on modal unlock:`, scanError);
                  }

                  onClose();
                }}
                className="px-3 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 text-xs"
              >
                ×
              </button>
            ) : initFailedMessage ? (
              <button
                onClick={onClose}
                className="px-3 py-1 rounded border border-red-500/40 bg-black hover:bg-red-900/20 text-xs text-red-300"
              >
                Dismiss
              </button>
            ) : (
              <button
                disabled
                className="px-3 py-1 rounded border border-green-500/40 bg-black/40 text-xs text-green-400/60 cursor-not-allowed"
              >
                Please wait…
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignRequestModal;
