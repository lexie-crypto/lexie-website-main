import React, { useState, useRef } from 'react';

// Titans Game component that loads the actual game from game.lexiecrypto.com
const TitansGame = ({ lexieId, walletAddress, embedded, theme, onLoad, onError, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef(null);

  const gameUrl = `https://game.lexiecrypto.com/?lexieId=${encodeURIComponent(lexieId)}&walletAddress=${encodeURIComponent(walletAddress || '')}&embedded=true&theme=${theme || 'terminal'}`;

  const handleIframeLoad = () => {
    setIsLoading(false);
    onLoad && onLoad();
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
    onError && onError(new Error('Failed to load Titans game'));
  };

  if (hasError) {
    return (
      <div className="w-full bg-gradient-to-br from-purple-900/20 to-blue-900/20 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-6 max-w-md mx-auto px-6">
          <div className="text-6xl">⚠️</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-red-300">Game Unavailable</h2>
            <p className="text-red-200/80 text-sm">
              Sorry, the LexieTitans game couldn't be loaded right now.
            </p>
          </div>
          <div className="bg-black/40 border border-red-500/30 rounded-lg p-4">
            <div className="text-sm text-red-300/70">
              Please try again later or check your internet connection.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-black relative flex flex-col">
      {isLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 to-blue-900/20 flex items-center justify-center z-10">
          <div className="text-center space-y-6 max-w-md mx-auto px-6">
            <div className="text-6xl">🎮</div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-purple-300">Loading LexieTitans Game</h2>
              <p className="text-purple-200/80 text-sm">
                Welcome to LexieTitans, <span className="text-emerald-300 font-mono">@{lexieId}</span>!
              </p>
            </div>
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            </div>
            <div className="text-xs text-purple-400/60">
              Initializing game systems...
            </div>
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={gameUrl}
        className="w-full flex-1 border-0"
        style={{ minHeight: '100vh' }}
        title="Titans Game"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-modals"
      />
    </div>
  );
};

// Mobile Titans Game Modal Component
const MobileTitansGame = ({ isOpen, onClose, lexieId, walletAddress }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-60 w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-700 flex items-center justify-center text-white font-bold text-lg"
        aria-label="Close game"
      >
        ×
      </button>

      {/* Game content */}
      <div className="w-full h-full">
        <TitansGame
          lexieId={lexieId}
          walletAddress={walletAddress}
          embedded={true}
          theme="terminal"
          onLoad={() => {}}
          onError={() => {}}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

export default MobileTitansGame;
