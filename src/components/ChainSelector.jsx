import React, { useState, useEffect } from 'react';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * Chain Selector Component
 *
 * Allows users to select their preferred blockchain network before wallet connection.
 * Displays supported networks with logos and ensures proper chain selection for vault creation.
 * Persists user's selection to localStorage for consistent experience.
 */
const ChainSelector = ({ selectedChainId, onChainSelect, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Supported networks configuration
  const supportedNetworks = [
    {
      id: 1,
      name: 'Ethereum',
      symbol: 'ETH',
      color: 'bg-blue-500',
    },
    {
      id: 137,
      name: 'Polygon',
      symbol: 'MATIC',
      color: 'bg-purple-500',
    },
    {
      id: 42161,
      name: 'Arbitrum',
      symbol: 'ETH',
      color: 'bg-cyan-500',
    },
    {
      id: 56,
      name: 'BNB Chain',
      symbol: 'BNB',
      color: 'bg-yellow-500',
    },
  ];

  const selectedNetwork = selectedChainId ? supportedNetworks.find(net => net.id === selectedChainId) : null;

  const handleSelect = (chainId) => {
    onChainSelect(chainId);
    setIsOpen(false);
  };

  // Save selection to localStorage whenever it changes
  useEffect(() => {
    if (selectedChainId && supportedNetworks.some(net => net.id === selectedChainId)) {
      try {
        localStorage.setItem('lexie-selected-chain', selectedChainId.toString());
        console.log('[ChainSelector] Saved chain selection to localStorage:', selectedChainId);
      } catch (error) {
        console.warn('[ChainSelector] Failed to save chain selection to localStorage:', error);
      }
    }
  }, [selectedChainId, supportedNetworks]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            px-3 py-2 bg-black/60 border border-emerald-500/40 rounded-md
            text-emerald-200 font-mono text-sm flex items-center gap-2
            hover:bg-black/80 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400
            disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
            ${isOpen ? 'ring-2 ring-emerald-500 border-emerald-400' : ''}
          `}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          {selectedNetwork ? (
            <>
              <span className="text-base">{selectedNetwork.logo}</span>
              <span className="font-medium">{selectedNetwork.name}</span>
            </>
          ) : (
            <span className="font-medium text-emerald-400/70">Choose Network</span>
          )}
          <ChevronDownIcon
            className={`h-4 w-4 text-emerald-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 z-20 mt-1 bg-black/95 border border-emerald-500/40 rounded-md shadow-2xl min-w-48">
              {supportedNetworks.map((network) => (
                <button
                  key={network.id}
                  type="button"
                  onClick={() => handleSelect(network.id)}
                  className={`
                    w-full px-3 py-2 text-left flex items-center justify-between
                    hover:bg-emerald-900/20 transition-colors duration-150
                    ${network.id === selectedChainId ? 'bg-emerald-900/30' : ''}
                  `}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{network.logo}</span>
                    <div>
                      <div className="font-medium text-emerald-200 text-sm">{network.name}</div>
                    </div>
                  </div>
                  {selectedChainId === network.id && (
                    <CheckIcon className="h-4 w-4 text-emerald-400" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChainSelector;
