import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import {
  executeShield,
  executePrivateTransfer,
  executeUnshield,
  convertToBaseUnits,
  getBlockExplorerUrl,
  SUPPORTED_TOKENS,
  getTokenConfig
} from '../utils/railgunUtils';

const PrivateTransactions = ({ isOpen, onClose }) => {
  const {
    isConnected,
    address,
    chainId,
    isRailgunInitialized,
    railgunAddress,
    railgunWalletID,
    isInitializing,
    connectWallet,
  } = useWallet();

  const [activeTab, setActiveTab] = useState('shield');
  const [balances, setBalances] = useState({
    public: {},
    private: {},
  });
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);

  // Shield Assets form state
  const [shieldForm, setShieldForm] = useState({
    tokenAddress: '',
    amount: '',
    customToken: '',
  });

  // Private Transfer form state
  const [transferForm, setTransferForm] = useState({
    recipientAddress: '',
    tokenAddress: '',
    amount: '',
  });

  // Unshield Assets form state
  const [unshieldForm, setUnshieldForm] = useState({
    tokenAddress: '',
    amount: '',
    recipientAddress: '',
  });

  // Common ERC-20 tokens for demo
  const commonTokens = [
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    { symbol: 'USDC', address: '0xA0b86a33E6556c98EeE24CdDC1E4dFaD7D6FfF68', decimals: 6 },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  ];

  const loadBalances = async () => {
    if (!isConnected || !isRailgunInitialized) return;

    setLoading(true);
    try {
      // For demo purposes, simulate some balances
      // In production, you would load actual balances from Railgun
      setBalances({
        public: {
          ETH: '1.2345',
          USDC: '1000.50',
          USDT: '500.00',
        },
        private: {
          ETH: '0.5432',
          USDC: '250.25',
          USDT: '100.00',
        },
      });
      
      // Try to load real balances if functions are available
      try {
        const railgunWallet = await import('@railgun-community/wallet');
        if (railgunWallet.refreshRailgunBalances) {
          await railgunWallet.refreshRailgunBalances(address, railgunAddress);
        }
      } catch (importError) {
        console.log('Railgun balance functions not available, using demo data');
      }
    } catch (error) {
      console.error('Failed to load balances:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && isRailgunInitialized) {
      loadBalances();
    }
  }, [isOpen, isRailgunInitialized]);

  const handleShield = async (e) => {
    e.preventDefault();
    if (!isRailgunInitialized || !railgunWalletID || !railgunAddress) {
      alert('RAILGUN wallet not initialized');
      return;
    }

    if (!shieldForm.tokenAddress || !shieldForm.amount) {
      alert('Please select a token and enter an amount');
      return;
    }

    setLoading(true);
    
    const selectedToken = commonTokens.find(t => t.address === shieldForm.tokenAddress);
    
    const newTx = {
      id: Date.now(),
      type: 'shield',
      status: 'pending',
      amount: shieldForm.amount,
      token: selectedToken?.symbol || 'Unknown',
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🛡️ Starting shield transaction:', shieldForm);
      
      if (!selectedToken) {
        throw new Error('Token not found');
      }
      
      const currentChainId = chainId || 1;

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(shieldForm.amount, selectedToken.decimals);
      
      // Execute shield transaction
      const result = await executeShield({
        railgunWalletID,
        railgunAddress,
        tokenAddress: selectedToken.address === '0x0000000000000000000000000000000000000000' ? null : selectedToken.address,
        amount: amountInBaseUnits,
        chainId: currentChainId
      });

      if (result.success && result.txid) {
        console.log('✅ Shield transaction successful!', result.txid);
        
        // Update transaction with success and txid
        setTransactions(prev => 
          prev.map(tx => 
            tx.id === newTx.id ? { 
              ...tx, 
              status: 'completed',
              txid: result.txid,
              explorerUrl: getBlockExplorerUrl(currentChainId, result.txid)
            } : tx
          )
        );
        
        // Refresh balances
        setTimeout(() => {
          loadBalances();
        }, 2000);
        
        setShieldForm({ tokenAddress: '', amount: '', customToken: '' });
        alert(`Shield transaction submitted successfully!\nTx ID: ${result.txid}`);
        
      } else {
        throw new Error(result.error || 'Shield transaction failed');
      }

    } catch (error) {
      console.error('❌ Shield transaction failed:', error);
      
      // Update transaction with failure
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === newTx.id ? { ...tx, status: 'failed', error: error.message } : tx
        )
      );
      
      alert(`Shield transaction failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePrivateTransfer = async (e) => {
    e.preventDefault();
    if (!isRailgunInitialized || !railgunWalletID || !railgunAddress) {
      alert('RAILGUN wallet not initialized');
      return;
    }

    if (!transferForm.tokenAddress || !transferForm.amount || !transferForm.recipientAddress) {
      alert('Please fill in all fields');
      return;
    }

    setLoading(true);
    
    const selectedToken = commonTokens.find(t => t.address === transferForm.tokenAddress);
    
    const newTx = {
      id: Date.now(),
      type: 'transfer',
      status: 'pending',
      amount: transferForm.amount,
      token: selectedToken?.symbol || 'Unknown',
      recipient: transferForm.recipientAddress,
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🔒 Starting private transfer:', transferForm);
      
      if (!selectedToken) {
        throw new Error('Token not found');
      }
      
      const currentChainId = chainId || 1;

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(transferForm.amount, selectedToken.decimals);
      
      // Execute private transfer
      const result = await executePrivateTransfer({
        railgunWalletID,
        fromRailgunAddress: railgunAddress,
        toRailgunAddress: transferForm.recipientAddress,
        tokenAddress: selectedToken.address === '0x0000000000000000000000000000000000000000' ? null : selectedToken.address,
        amount: amountInBaseUnits,
        chainId: currentChainId
      });

      if (result.success && result.txid) {
        console.log('✅ Private transfer successful!', result.txid);
        
        // Update transaction with success and txid
        setTransactions(prev => 
          prev.map(tx => 
            tx.id === newTx.id ? { 
              ...tx, 
              status: 'completed',
              txid: result.txid,
              explorerUrl: getBlockExplorerUrl(currentChainId, result.txid)
            } : tx
          )
        );
        
        // Refresh balances
        setTimeout(() => {
          loadBalances();
        }, 2000);
        
        setTransferForm({ recipientAddress: '', tokenAddress: '', amount: '' });
        alert(`Private transfer submitted successfully!\nTx ID: ${result.txid}`);
        
      } else {
        throw new Error(result.error || 'Private transfer failed');
      }

    } catch (error) {
      console.error('❌ Private transfer failed:', error);
      
      // Update transaction with failure
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === newTx.id ? { ...tx, status: 'failed', error: error.message } : tx
        )
      );
      
      alert(`Private transfer failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUnshield = async (e) => {
    e.preventDefault();
    if (!isRailgunInitialized || !railgunWalletID || !railgunAddress) {
      alert('RAILGUN wallet not initialized');
      return;
    }

    if (!unshieldForm.tokenAddress || !unshieldForm.amount) {
      alert('Please select a token and enter an amount');
      return;
    }

    setLoading(true);
    
    const selectedToken = commonTokens.find(t => t.address === unshieldForm.tokenAddress);
    const recipientAddress = unshieldForm.recipientAddress || address;
    
    const newTx = {
      id: Date.now(),
      type: 'unshield',
      status: 'pending',
      amount: unshieldForm.amount,
      token: selectedToken?.symbol || 'Unknown',
      recipient: recipientAddress,
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🔓 Starting unshield transaction:', unshieldForm);
      
      if (!selectedToken) {
        throw new Error('Token not found');
      }
      
      const currentChainId = chainId || 1;

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(unshieldForm.amount, selectedToken.decimals);
      
      // Execute unshield transaction
      const result = await executeUnshield({
        railgunWalletID,
        railgunAddress,
        tokenAddress: selectedToken.address === '0x0000000000000000000000000000000000000000' ? null : selectedToken.address,
        amount: amountInBaseUnits,
        recipientAddress,
        chainId: currentChainId
      });

      if (result.success && result.txid) {
        console.log('✅ Unshield transaction successful!', result.txid);
        
        // Update transaction with success and txid
        setTransactions(prev => 
          prev.map(tx => 
            tx.id === newTx.id ? { 
              ...tx, 
              status: 'completed',
              txid: result.txid,
              explorerUrl: getBlockExplorerUrl(currentChainId, result.txid)
            } : tx
          )
        );
        
        // Refresh balances
        setTimeout(() => {
          loadBalances();
        }, 2000);
        
        setUnshieldForm({ tokenAddress: '', amount: '', recipientAddress: '' });
        alert(`Unshield transaction submitted successfully!\nTx ID: ${result.txid}`);
        
      } else {
        throw new Error(result.error || 'Unshield transaction failed');
      }

    } catch (error) {
      console.error('❌ Unshield transaction failed:', error);
      
      // Update transaction with failure
      setTransactions(prev => 
        prev.map(tx => 
          tx.id === newTx.id ? { ...tx, status: 'failed', error: error.message } : tx
        )
      );
      
      alert(`Unshield transaction failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-purple-500/40 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div>
            <h2 className="text-2xl font-bold text-white">Private Transactions</h2>
            <p className="text-gray-400 mt-1">Shield, transfer, and unshield assets privately using Railgun</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!isConnected ? (
          <div className="p-6 text-center">
            <h3 className="text-xl font-semibold text-white mb-4">Connect Your Wallet</h3>
            <p className="text-gray-400 mb-6">Connect your wallet to access private transaction features</p>
                         <div className="flex gap-4 justify-center">
               <button
                 onClick={() => connectWallet('metamask')}
                 className="px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-colors"
               >
                 Connect MetaMask
               </button>
               <button
                 onClick={() => connectWallet('walletconnect')}
                 className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
               >
                 WalletConnect
               </button>
             </div>
          </div>
        ) : !isRailgunInitialized ? (
          <div className="p-6 text-center">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="w-4 h-4 bg-purple-500 rounded-full animate-pulse"></div>
              <span className="text-white font-semibold">
                {isInitializing ? 'Initializing Railgun...' : 'Railgun Not Initialized'}
              </span>
            </div>
            <p className="text-gray-400">
              {isInitializing 
                ? 'Setting up your private wallet infrastructure...'
                : 'Your Railgun wallet is being prepared for private transactions.'
              }
            </p>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row">
            {/* Left Panel - Controls */}
            <div className="lg:w-2/3 p-6">
              {/* Tab Navigation */}
              <div className="flex space-x-1 mb-6 bg-gray-800 rounded-lg p-1">
                {[
                  { id: 'shield', label: 'Shield Assets', icon: '🛡️' },
                  { id: 'transfer', label: 'Private Transfer', icon: '🔄' },
                  { id: 'unshield', label: 'Unshield Assets', icon: '🔓' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="mr-2">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Shield Assets Tab */}
              {activeTab === 'shield' && (
                <form onSubmit={handleShield} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Token</label>
                    <select
                      value={shieldForm.tokenAddress}
                      onChange={(e) => setShieldForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    >
                      <option value="">Select a token</option>
                      {commonTokens.map((token) => (
                        <option key={token.address} value={token.address}>
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={shieldForm.amount}
                      onChange={(e) => setShieldForm(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.0"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
                  >
                    {loading ? 'Shielding...' : 'Shield Assets'}
                  </button>
                </form>
              )}

              {/* Private Transfer Tab */}
              {activeTab === 'transfer' && (
                <form onSubmit={handlePrivateTransfer} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Recipient Address</label>
                    <input
                      type="text"
                      value={transferForm.recipientAddress}
                      onChange={(e) => setTransferForm(prev => ({ ...prev, recipientAddress: e.target.value }))}
                      placeholder="0x... or Railgun address"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Token</label>
                    <select
                      value={transferForm.tokenAddress}
                      onChange={(e) => setTransferForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    >
                      <option value="">Select a token</option>
                      {commonTokens.map((token) => (
                        <option key={token.address} value={token.address}>
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={transferForm.amount}
                      onChange={(e) => setTransferForm(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.0"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
                  >
                    {loading ? 'Sending...' : 'Send Privately'}
                  </button>
                </form>
              )}

              {/* Unshield Assets Tab */}
              {activeTab === 'unshield' && (
                <form onSubmit={handleUnshield} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Token</label>
                    <select
                      value={unshieldForm.tokenAddress}
                      onChange={(e) => setUnshieldForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    >
                      <option value="">Select a token</option>
                      {commonTokens.map((token) => (
                        <option key={token.address} value={token.address}>
                          {token.symbol}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={unshieldForm.amount}
                      onChange={(e) => setUnshieldForm(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.0"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Recipient Address (Optional)
                    </label>
                    <input
                      type="text"
                      value={unshieldForm.recipientAddress}
                      onChange={(e) => setUnshieldForm(prev => ({ ...prev, recipientAddress: e.target.value }))}
                      placeholder={`${address?.slice(0, 6)}...${address?.slice(-4)} (Your wallet)`}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
                  >
                    {loading ? 'Unshielding...' : 'Unshield Assets'}
                  </button>
                </form>
              )}
            </div>

            {/* Right Panel - Balances & Transactions */}
            <div className="lg:w-1/3 bg-gray-800/50 p-6 border-l border-gray-700">
              {/* Balances */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-4">Balances</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2">Private Balances</h4>
                    {Object.entries(balances.private).map(([token, amount]) => (
                      <div key={token} className="flex justify-between py-1">
                        <span className="text-gray-300">{token}</span>
                        <span className="text-green-400">{amount}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2">Public Balances</h4>
                    {Object.entries(balances.public).map(([token, amount]) => (
                      <div key={token} className="flex justify-between py-1">
                        <span className="text-gray-300">{token}</span>
                        <span className="text-blue-400">{amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">Recent Transactions</h3>
                <div className="space-y-2">
                  {transactions.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="bg-gray-700/50 rounded-lg p-3">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-white capitalize">
                          {tx.type}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          tx.status === 'completed' 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {tx.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400">
                        {tx.amount} {tx.token}
                      </div>
                      {tx.recipient && (
                        <div className="text-xs text-gray-500 mt-1">
                          To: {tx.recipient.slice(0, 6)}...{tx.recipient.slice(-4)}
                        </div>
                      )}
                    </div>
                  ))}
                  {transactions.length === 0 && (
                    <div className="text-center py-4 text-gray-500">
                      No transactions yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivateTransactions; 