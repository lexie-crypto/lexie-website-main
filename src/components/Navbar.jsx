import React, { useState } from 'react';

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const baseClasses = "sticky top-0 z-40 w-full p-6 bg-black";
  const containerClasses = "max-w-7xl mx-auto flex justify-between items-center";

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <nav className={baseClasses}>
      <div className={containerClasses}>
        {/* Logo - Far Left */}
        <a href="/" className="text-4xl font-bold text-purple-300 hover:text-white transition-colors flex-shrink-0">
          LEXIEAI
        </a>

        {/* Desktop Navigation - Center */}
        <div className="hidden md:flex absolute left-1/2 transform -translate-x-1/2 space-x-8">
          <a href="#features" className="text-lg font-bold text-purple-300 hover:text-purple-100 transition-all duration-200">
            Features
          </a>
          <a href="/docs" className="text-lg font-bold text-purple-300 hover:text-purple-100 transition-all duration-200">
            Documentation
          </a>
          <a href="#faqs" className="text-lg font-bold text-purple-300 hover:text-purple-100 transition-all duration-200">
            FAQs
          </a>
        </div>

        {/* Launch App Button - Far Right */}
        <a
          href="https://staging.app.lexiecrypto.com/lexievault"
          className="hidden md:inline-flex items-center px-6 py-2 bg-purple-300 text-black font-bold rounded-lg shadow-lg hover:bg-purple-300 transition-all duration-300 transform hover:scale-105"
        >
          Launch App →
        </a>

        {/* Mobile Menu Button */}
        <button
          onClick={toggleMobileMenu}
          className="md:hidden text-purple-300 hover:text-white p-2"
          aria-label="Toggle mobile menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-black border-t border-purple-800">
          <div className="px-6 py-4 space-y-4">
            <a href="#features" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              Features
            </a>
            <a href="/docs" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              Docs
            </a>
            <a href="#faqs" className="block text-lg font-bold text-purple-300 hover:text-purple-100 transition-colors" onClick={() => setIsMobileMenuOpen(false)}>
              FAQs
            </a>
            <a
              href="https://app.lexiecrypto.com"
              className="inline-flex items-center px-6 py-2 bg-purple-300 text-black font-bold rounded-lg shadow-lg hover:bg-purple-400 transition-all duration-300"
            >
              Launch App →
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
