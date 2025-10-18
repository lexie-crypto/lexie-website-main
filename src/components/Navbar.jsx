import React, { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';
import MobileTitansGame from './MobileTitansGame.jsx';

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTitansGameOpen, setIsTitansGameOpen] = useState(false);

  // Get wallet context for game data
  const { address } = useWallet();

  // Get lexieId from localStorage (same way as VaultDesktop)
  const currentLexieId = localStorage.getItem('linkedLexieId');

  const baseClasses = "sticky top-0 z-40 w-full p-6 bg-black";
  const containerClasses = "max-w-7xl mx-auto flex justify-between items-center";

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <>
      <nav className={baseClasses}>
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

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-black border-t border-purple-800">
            <div className="px-6 py-4 space-y-4">
              <a href="https://staging.app.lexiecrypto.com/lexievault" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left" onClick={() => setIsMobileMenuOpen(false)}>
                LexieVault
              </a>
              <button className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left" onClick={() => setIsMobileMenuOpen(false)}>
                LexieChat
              </button>
              <button
                className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors text-left"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentLexieId) {
                    setIsTitansGameOpen(true);
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
