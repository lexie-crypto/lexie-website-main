import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const GamePage = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [gameWindow, setGameWindow] = useState(null);

  // Game URLs - you can configure these based on your deployment
  const gameUrls = {
    production: 'https://lexiecrypto.com',
    staging: 'https://staging.lexiecrypto.com',
    chatroom: 'https://chatroom.lexiecrypto.com',
    stagingChatroom: 'https://staging.chatroom.lexiecrypto.com'
  };

  // Default to staging for development
  const defaultGameUrl = gameUrls.staging;

  const openGameInPopup = (gameUrl) => {
    setIsLoading(true);

    try {
      // Calculate popup dimensions (responsive)
      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;
      const popupWidth = Math.min(1200, screenWidth * 0.9);
      const popupHeight = Math.min(800, screenHeight * 0.9);
      const left = (screenWidth - popupWidth) / 2;
      const top = (screenHeight - popupHeight) / 2;

      // Popup window features
      const features = [
        `width=${popupWidth}`,
        `height=${popupHeight}`,
        `left=${left}`,
        `top=${top}`,
        'scrollbars=yes',
        'resizable=yes',
        'status=yes',
        'toolbar=no',
        'menubar=no',
        'location=no',
        'directories=no'
      ].join(',');

      // Open the game in a popup window
      const popup = window.open(
        gameUrl,
        'lexieTitansGame',
        features
      );

      if (!popup) {
        toast.error('Popup blocked! Please allow popups for this site and try again.');
        setIsLoading(false);
        return;
      }

      // Store reference to the popup window
      setGameWindow(popup);

      // Handle popup close
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          setGameWindow(null);
          toast.success('Game window closed');
        }
      }, 1000);

      // Focus the popup window
      popup.focus();

      // Handle popup load
      popup.onload = () => {
        setIsLoading(false);
        toast.success('Titans game loaded successfully!');
      };

      // Fallback timeout in case onload doesn't fire
      setTimeout(() => {
        setIsLoading(false);
      }, 3000);

    } catch (error) {
      console.error('Error opening game:', error);
      toast.error('Failed to open game. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGameSelect = (gameUrl, gameName) => {
    toast.loading(`Opening ${gameName}...`, { id: 'game-loading' });
    openGameInPopup(gameUrl);
  };

  const handleDefaultGame = () => {
    handleGameSelect(defaultGameUrl, 'Titans Game');
  };

  const closeGameWindow = () => {
    if (gameWindow && !gameWindow.closed) {
      gameWindow.close();
      setGameWindow(null);
      toast.success('Game window closed');
    }
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (gameWindow && !gameWindow.closed) {
        gameWindow.close();
      }
    };
  }, [gameWindow]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-sm border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/')}
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                ← Back to Home
              </button>
              <h1 className="text-2xl font-bold text-white">Titans Game</h1>
            </div>
            {gameWindow && !gameWindow.closed && (
              <button
                onClick={closeGameWindow}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Close Game
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-white mb-4">
            Play Titans Game
          </h2>
          <p className="text-xl text-gray-300">
            Choose your game environment and start playing!
          </p>
        </div>

        {/* Game Options */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Default Game Card */}
          <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8 hover:border-purple-400/50 transition-all duration-300">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Play Titans</h3>
              <p className="text-gray-400 mb-6">
                Open the Titans game in a new window and start your adventure!
              </p>
              <button
                onClick={handleDefaultGame}
                disabled={isLoading}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading Game...
                  </div>
                ) : (
                  '🎮 Play Game'
                )}
              </button>
            </div>
          </div>

          {/* Environment Selection Card */}
          <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Choose Environment</h3>
              <p className="text-gray-400 mb-6">
                Select your preferred game environment
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => handleGameSelect(gameUrls.production, 'Production Game')}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🌟 Production
                </button>
                <button
                  onClick={() => handleGameSelect(gameUrls.staging, 'Staging Game')}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🧪 Staging
                </button>
                <button
                  onClick={() => handleGameSelect(gameUrls.chatroom, 'Chatroom Game')}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  💬 Chatroom
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8">
          <h3 className="text-xl font-bold text-white mb-4">How to Play</h3>
          <div className="grid md:grid-cols-2 gap-6 text-gray-300">
            <div>
              <h4 className="font-semibold text-purple-400 mb-2">🎯 Getting Started</h4>
              <ul className="space-y-2 text-sm">
                <li>• Click "Play Game" to open Titans in a new window</li>
                <li>• If popup is blocked, allow popups for this site</li>
                <li>• Login with your Lexie ID when prompted</li>
                <li>• Choose your force side and start playing!</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-purple-400 mb-2">🎮 Game Features</h4>
              <ul className="space-y-2 text-sm">
                <li>• Battle other Titans in epic combat</li>
                <li>• Upgrade your Titan with power boosts</li>
                <li>• Join quests and earn rewards</li>
                <li>• Compete on leaderboards</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GamePage;
