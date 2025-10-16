import React, { useState } from 'react';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * Chain Selector Component
 *
 * Allows users to select their preferred blockchain network before wallet connection.
 * Displays supported networks with logos and ensures proper chain selection for vault creation.
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

  const selectedNetwork = supportedNetworks.find(net => net.id === selectedChainId) || supportedNetworks[0];

  const handleSelect = (chainId) => {
    onChainSelect(chainId);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor="chain-selector" className="block text-sm font-medium text-emerald-400/80 mb-2">
        Select Network
      </label>

      <button
        id="chain-selector"
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full px-4 py-3 bg-black/60 border border-emerald-500/40 rounded-md
          text-emerald-200 font-mono text-left flex items-center justify-between
          hover:bg-black/80 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400
          disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
          ${isOpen ? 'ring-2 ring-emerald-500 border-emerald-400' : ''}
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{selectedNetwork.logo}</span>
          <div>
            <div className="font-medium">{selectedNetwork.name}</div>
            <div className="text-xs text-emerald-400/60">{selectedNetwork.symbol}</div>
          </div>
        </div>
        <ChevronDownIcon
          className={`h-5 w-5 text-emerald-400 transition-transform duration-200 ${
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
          <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-black/95 border border-emerald-500/40 rounded-md shadow-2xl max-h-60 overflow-y-auto">
            {supportedNetworks.map((network) => (
              <button
                key={network.id}
                type="button"
                onClick={() => handleSelect(network.id)}
                className={`
                  w-full px-4 py-3 text-left flex items-center justify-between
                  hover:bg-emerald-900/20 transition-colors duration-150
                  ${network.id === selectedChainId ? 'bg-emerald-900/30' : ''}
                `}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{network.logo}</span>
                  <div>
                    <div className="font-medium text-emerald-200">{network.name}</div>
                    <div className="text-xs text-emerald-400/60">{network.symbol}</div>
                  </div>
                </div>
                {network.id === selectedChainId && (
                  <CheckIcon className="h-5 w-5 text-emerald-400" />
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 text-xs text-emerald-400/60 text-center">
        Your vault will be created on the selected network
      </div>
    </div>
  );
};

export default ChainSelector;
