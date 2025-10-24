import React from 'react';
import { X } from 'lucide-react';

const VaultInfoModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-[100] p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
        {/* Modal Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">vault-info</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-green-400 text-xs">INFO</div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors"
              aria-label="Close info modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 text-green-300 space-y-6 overflow-y-auto max-h-[calc(90vh-80px)]">

          {/* What is LexieVault */}
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-emerald-300">What is LexieVault?</h3>
            <div className="bg-black/40 border border-green-500/20 rounded p-4">
              <p className="text-green-400/80 text-sm leading-6">
                LexieVault is your incognito, secure DeFi vault powered by the Railgun Protocol.
                It provides confidentiality-focused DeFi tools while maintaining the security and
                functionality of traditional DeFi platforms. Your funds are encrypted using zero-knowledge
                proofs, ensuring complete confidentiality for your transactions.
              </p>
            </div>
          </div>

          {/* Window Controls */}
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-emerald-300">Window Controls</h3>
            <div className="bg-black/40 border border-gray-500/20 rounded p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div>
                    <div className="text-red-300 font-medium text-sm">CLOSE</div>
                    <div className="text-red-400/80 text-xs">Closes the current window</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div>
                    <div className="text-yellow-300 font-medium text-sm">MINIMIZE</div>
                    <div className="text-yellow-400/80 text-xs">Hides the window to the taskbar</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <div className="text-green-300 font-medium text-sm">MAXIMIZE</div>
                    <div className="text-green-400/80 text-xs">Expands window to fill the screen</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Command Functions */}
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-emerald-300">Command Functions</h3>
            <div className="grid gap-3">

              <div className="bg-black/40 border border-purple-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-purple-300 font-medium text-sm">ADD</span>
                  <span className="text-purple-400/60 text-xs">→ Adds tokens to your vault</span>
                </div>
                <p className="text-purple-200/80 text-xs leading-5">
                  Move tokens from your connected wallet into the LexieVault. These tokens become
                  encrypted and their transaction history is hidden for maximum confidentiality.
                </p>
              </div>

              <div className="bg-black/40 border border-blue-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-blue-300 font-medium text-sm">RECEIVE</span>
                  <span className="text-blue-400/60 text-xs">→ Use the link or QR code for others to send funds to your vault</span>
                </div>
                <p className="text-blue-200/80 text-xs leading-5">
                  Creates a shareable link and QR code that others can use to send tokens
                  directly to your vault. Share these with anyone you want to receive funds from.
                </p>
              </div>

              <div className="bg-black/40 border border-cyan-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-cyan-300 font-medium text-sm">SEND</span>
                  <span className="text-cyan-400/60 text-xs">→ Send tokens from your vault to any address</span>
                </div>
                <p className="text-cyan-200/80 text-xs leading-5">
                  Send tokens from your vault to any address. You can send to public addresses
                  or other LexieVaults. All transactions maintain confidentiality through zero-knowledge proofs.
                </p>
              </div>

              <div className="bg-black/40 border border-amber-500/20 rounded p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-amber-300 font-medium text-sm">REMOVE</span>
                  <span className="text-amber-400/60 text-xs">→ Remove tokens from your vault to your connected wallet</span>
                </div>
                <p className="text-amber-200/80 text-xs leading-5">
                  Move tokens out of the LexieVault back to your connected public wallet.
                  This makes the tokens visible on the public blockchain again.
                </p>
              </div>

            </div>
          </div>

          {/* Additional Info */}
          <div className="bg-black/40 border border-emerald-500/20 rounded p-4">
            <div className="text-emerald-300 text-xs font-medium mb-2">💡 Pro Tips:</div>
            <div className="text-emerald-200/80 text-xs space-y-1">
              <div>• Always verify recipient addresses before sending</div>
              <div>• Click on Lexie at the bottom right to chat with her</div>
              <div>• Use LexieID for easy P2P transfers between vault users</div>
              <div>• Transaction history is available in the History tab</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default VaultInfoModal;
