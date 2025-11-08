import React, { useState } from "react";
import { useWallet } from "../contexts/WalletContext";
import MobileTitansGame from "./MobileTitansGame.jsx";

export function Navbar({ onLexieChatOpen }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTitansGameOpen, setIsTitansGameOpen] = useState(false);

  // Get wallet context for game data
  const { address } = useWallet();

  // Get lexieId from localStorage (same way as VaultDesktop)
  const currentLexieId = localStorage.getItem("linkedLexieId");

  // Mobile: sticky (scrolls with page), Desktop: fixed (stays at top)
  const baseClasses =
    "sticky md:fixed top-0 md:left-0 md:right-0 z-40 w-full p-6 bg-black";
  const containerClasses =
    "max-w-7xl mx-auto flex justify-between items-center";

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <>
      {/* FIXED: Added relative positioning to navbar container */}
      <nav
        className={`${baseClasses} relative`}
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
      >
        <div className={containerClasses}>
          {/* Logo - Far Left */}
          <a
            href="/"
            className="flex-shrink-0 text-4xl font-bold text-purple-500/90 transition-colors hover:text-white"
          >
            LEXIE
          </a>

          {/* Desktop Navigation - Right */}
          <div className="items-center hidden space-x-6 md:flex">
            <a
              href="https://lexie-crypto.gitbook.io/lexie-crypto/"
              className="text-lg font-bold text-purple-300 transition-all duration-200 hover:text-purple-100"
            >
              Documentation
            </a>
            <a
              href="https://app.lexiecrypto.com/lexievault"
              className="inline-flex items-center px-6 py-2 font-bold text-black transition-all duration-300 transform bg-purple-300 rounded-lg shadow-lg hover:bg-purple-300 hover:scale-105"
            >
              Launch App →
            </a>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={toggleMobileMenu}
            className="p-2 text-purple-300 md:hidden hover:text-white"
            aria-label="Toggle mobile menu"
          >
            <svg
              className="w-10 h-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>

        {/* Mobile Menu - FIXED: Now using absolute positioning */}
        {isMobileMenuOpen && (
          <div className="absolute right-0 z-50 w-64 bg-black border-t border-l border-purple-800 shadow-xl top-full md:hidden">
            <div className="px-6 py-4 space-y-4">
              <a
                href="https://app.lexiecrypto.com/lexievault"
                className="block text-lg font-bold text-left text-purple-300 transition-colors hover:text-purple-100"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                LexieVault
              </a>
              <a
                href="/chat"
                className="block text-lg font-bold text-left text-purple-300 transition-colors hover:text-purple-100"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                LexieChat
              </a>
              <button
                className="block text-lg font-bold text-left text-purple-300 transition-colors hover:text-purple-100"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentLexieId) {
                    // Open LexieTitans game in new tab on mobile
                    const gameUrl = `https://game.lexiecrypto.com/?lexieId=${encodeURIComponent(
                      currentLexieId
                    )}&walletAddress=${encodeURIComponent(
                      address || ""
                    )}&embedded=true&theme=terminal`;
                    window.open(gameUrl, "_blank");
                  } else {
                    // If no Lexie ID, show alert or handle gracefully
                    alert("Please get a Lexie ID first to play LexieTitans!");
                  }
                }}
              >
                LexieTitans
              </button>
              <a
                href="https://lexie-crypto.gitbook.io/lexie-crypto/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-lg font-bold text-left text-purple-300 transition-colors hover:text-purple-100"
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
