import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import MobileTitansGame from './MobileTitansGame.jsx';

export function Navbar({ onLexieChatOpen }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTitansGameOpen, setIsTitansGameOpen] = useState(false);

  // Get wallet context for game data
  const { address } = useWallet();

  // Get lexieId from localStorage (same way as VaultDesktop)
  const currentLexieId = localStorage.getItem('linkedLexieId');

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
          <div className="absolute top-full right-0 w-64 md:hidden bg-black border-t border-l border-purple-800 shadow-xl z-50">
            <div className="px-6 py-4 space-y-4">
              <a href="https://staging.app.lexiecrypto.com/lexievault" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left" onClick={() => setIsMobileMenuOpen(false)}>
                LexieVault
              </a>
              <a
                href="/chat"
                className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                LexieChat
              </a>
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
              <a
                href="https://lexie-crypto.gitbook.io/lexie-crypto/"
                className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Documentation
              </a>
            </div>
          </div>
        )}
      </nav>


      {/* Mobile Titans Game Modal */}
      <MobileTitansGame
        isOpen={isTitansGameOpen}
        onClose={() => setIsTitansGameOpen(false)}
        lexieId={currentLexieId}
        walletAddress={address}
      />
    </>
  );
}
