import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import MobileTitansGame from './MobileTitansGame.jsx';
import WindowShell from './window/WindowShell.jsx';
import ChatPage from '../pages/ChatPage.tsx';

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTitansGameOpen, setIsTitansGameOpen] = useState(false);
  const [isLexieChatOpen, setIsLexieChatOpen] = useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  // Get wallet context for game data
  const { address } = useWallet();

  // Get lexieId from localStorage (same way as VaultDesktop)
  const currentLexieId = localStorage.getItem('linkedLexieId');

  // Mobile detection for chat window
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  // Mobile: sticky (scrolls with page), Desktop: fixed (stays at top)
  const baseClasses = "sticky md:fixed top-0 md:left-0 md:right-0 z-40 w-full p-6 bg-black";
  const containerClasses = "max-w-7xl mx-auto flex justify-between items-center";

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <>
      {/* FIXED: Added relative positioning to navbar container */}
      <nav className={`${baseClasses} relative`}>
        <div className={containerClasses}>
          {/* Logo - Far Left */}
          <a href="/" className="text-4xl font-bold text-purple-300 hover:text-white transition-colors flex-shrink-0">
            LEXIEAI
          </a>

          {/* Desktop Navigation - Right */}
          <div className="hidden md:flex items-center space-x-6">
            <a href="https://lexie-crypto.gitbook.io/lexie-crypto/" className="text-lg font-bold text-purple-300 hover:text-purple-100 transition-all duration-200">
              Documentation
            </a>
            <a
              href="https://staging.app.lexiecrypto.com/lexievault"
              className="inline-flex items-center px-6 py-2 bg-purple-300 text-black font-bold rounded-lg shadow-lg hover:bg-purple-300 transition-all duration-300 transform hover:scale-105"
            >
              Launch App →
            </a>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={toggleMobileMenu}
            className="md:hidden text-purple-300 hover:text-white p-2"
            aria-label="Toggle mobile menu"
          >
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Mobile Menu - FIXED: Now using absolute positioning */}
        {isMobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 md:hidden bg-black border-t border-purple-800 shadow-xl z-50">
            <div className="px-6 py-4 space-y-4">
              <a href="https://staging.app.lexiecrypto.com/lexievault" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left" onClick={() => setIsMobileMenuOpen(false)}>
                LexieVault
              </a>
              <button
                className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  setIsLexieChatOpen(true);
                }}
              >
                LexieChat
              </button>
              <button
                className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentLexieId) {
                    // Open LexieTitans game in new tab on mobile
                    const gameUrl = `https://game.lexiecrypto.com/?lexieId=${encodeURIComponent(currentLexieId)}&walletAddress=${encodeURIComponent(address || '')}&embedded=true&theme=terminal`;
                    window.open(gameUrl, '_blank');
                  } else {
                    // If no Lexie ID, show alert or handle gracefully
                    alert('Please get a Lexie ID first to play LexieTitans!');
                  }
                }}
              >
                LexieTitans
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* IMPROVED: Mobile-only spacer */}
      <div className="h-24 md:hidden" /> {/* Only show on mobile to prevent content from hiding under fixed navbar */}

      {/* Mobile Titans Game Modal */}
      <MobileTitansGame
        isOpen={isTitansGameOpen}
        onClose={() => setIsTitansGameOpen(false)}
        lexieId={currentLexieId}
        walletAddress={address}
      />

      {/* LexieChat Window - Mobile friendly */}
      {isLexieChatOpen && (
        <WindowShell
          id="lexie-chat-navbar-terminal"
          title="LexieAI-chat"
          appType="chat"
          statusLabel="Enable Degen Mode"
          statusTone="online"
          footerLeft="LexieAI Chat Terminal"
          footerRight="Secure LexieAI Communication Channel"
          variant="vault"
          fullscreen={isMobile}
          onClose={() => setIsLexieChatOpen(false)}
          initialSize={{ width: 1000, height: 700 }}
          initialPosition={{ x: 200, y: 100 }}
          minSize={{ width: 800, height: 600 }}
          className="z-[98]"
        >
          <ChatPage />
        </WindowShell>
      )}
    </>
  );
}
