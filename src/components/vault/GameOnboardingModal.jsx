import React from 'react';

const GameOnboardingModal = ({ isOpen, onChoice, lexieId }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-[100] p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden scrollbar-none">
        {/* Modal Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">game-onboarding</span>
          </div>
          <div className="text-green-400 text-xs">WAITING</div>
        </div>

        {/* Modal Content */}
        <div className="p-6 text-green-300 space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-emerald-300">WELCOME @{lexieId || 'USER'}</h3>
            <p className="text-green-400/80 text-sm leading-5">
              Your LexieVault is being set up in the background. Want to play LexieTitans while you wait?
            </p>
          </div>

          {/* Terminal-style instructions */}
          <div className="bg-black/40 border border-green-500/20 rounded p-3">
            <div className="text-green-200 text-xs mb-2 font-medium">While you play:</div>
            <div className="text-green-300/80 text-xs space-y-1">
              <div>• Your vault continues initializing</div>
              <div>• Earn points and rewards</div>
              <div>• Game loads in a separate window</div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => onChoice(true)}
              className="flex-1 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-200 py-2.5 px-4 rounded border border-emerald-400/40 hover:border-emerald-400 transition-all duration-200 text-sm font-medium"
            >
              Yes, play LexieTitans
            </button>
            <button
              onClick={() => onChoice(false)}
              className="flex-1 bg-purple-700/30 hover:bg-purple-700/50 text-gray-300 py-2.5 px-4 rounded border border-purple-500/40 hover:border-purple-400 transition-all duration-200 text-sm font-medium"
            >
              No, wait in vault
            </button>
          </div>

          {/* Footer info */}
          <div className="text-center">
            <div className="text-green-300/60 text-xs">
              🎮 You can always open the game later from the vault interface or navbar
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameOnboardingModal;
