import React from 'react';
import TerminalWindow from '../../components/ui/TerminalWindow.jsx';

const VaultMobileFallback = () => {
  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Navigation (match other pages) */}
      <nav className="sticky top-0 z-40 w-full p-6 bg-black">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-4xl font-bold text-purple-300">
            LEXIEAI
          </div>
          <div className="hidden md:flex space-x-6">
            <a href="/#features" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
            <a href="/#security" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
            <a href="/#beta" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
          </div>
        </div>
      </nav>

      {/* Background overlays (match other pages) */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        {/* Futuristic cityscape silhouette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        {/* Dynamic grid system */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>
        {/* Subtle ambient orbs */}
        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div 
              key={i} 
              className="absolute rounded-full animate-pulse"
              style={{ 
                left: `${20 + i * 30}%`,
                top: `${20 + i * 20}%`,
                width: `${200 + i * 100}px`,
                height: `${200 + i * 100}px`,
                background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                animationDelay: `${i * 2}s`,
                animationDuration: `${6 + i * 2}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
        <TerminalWindow
          title="lexie-ai"
          statusLabel={'MOBILE'}
          statusTone={'waiting'}
          footerLeft={<span>Process: lexie-vault</span>}
          variant="vault"
          className="overflow-hidden"
        >
          <div className="font-mono text-green-300 text-center py-16">
            <h2 className="text-xl sm:text-2xl font-semibold text-emerald-300 tracking-tight">
              Not available on mobile yet but we are working on it...
            </h2>
            <p className="mt-3 text-green-400/80 text-sm sm:text-base">
              Follow us on Twitter for product release updates.
            </p>
            <div className="mt-5">
              <a
                href="https://twitter.com/lexieai_xyz"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 px-4 py-2 rounded text-sm border border-purple-400/40 transition-colors"
              >
                Follow on Twitter
              </a>
            </div>
          </div>
        </TerminalWindow>
      </div>
    </div>
  );
};

export default VaultMobileFallback;


