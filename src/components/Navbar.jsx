import React from 'react';

export function Navbar({ variant = 'website' }) {
  const baseClasses = "sticky top-0 z-40 w-full p-6 bg-black";
  const containerClasses = "max-w-7xl mx-auto flex justify-between items-center";

  const renderLinks = () => {
    if (variant === 'chat') {
      return (
        <div className="hidden md:flex space-x-6">
          <a href="/" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
          <a href="/chat" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
          <a href="/docs" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
          <a href="/lexievault" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">LexieVault</a>
          <a href="https://chatroom.lexiecrypto.com" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">LexieChat</a>
        </div>
      );
    }

    return (
      <div className="hidden md:flex space-x-6">
        <a href="/lexievault" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">LexieVault</a>
        <a href="https://chatroom.lexiecrypto.com" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">LexieChat</a>
        <a href="#features" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
        <a href="#security" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
        <a href="#beta" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
      </div>
    );
  };

  return (
    <nav className={baseClasses}>
      <div className={containerClasses}>
        <a href="https://www.lexiecrypto.com" className="text-4xl font-bold text-purple-300 hover:text-white transition-colors">
          LEXIEAI
        </a>
        {renderLinks()}
      </div>
    </nav>
  );
}
