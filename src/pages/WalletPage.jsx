import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { useNavigate } from 'react-router-dom';
import { 
  fetchPublicBalances, 
  getRailgunBalances, 
  refreshRailgunBalances,
  addBalanceUpdateListener,
  executeShield,
  executePrivateTransfer,
  executeUnshield,
  convertToBaseUnits,
  getBlockExplorerUrl,
  SUPPORTED_CHAINS,
  SUPPORTED_TOKENS,
  getChainConfig,
  getTokenConfig,
  clearBalanceCache
} from '../utils/railgunUtils';

const WalletPage = () => {
  const {
    isConnected,
    address,
    chainId,
    isRailgunInitialized,
    railgunAddress,
    railgunWalletID,
    isInitializing,
    connectWallet,
    disconnectWallet,
  } = useWallet();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('shield');
  const [balances, setBalances] = useState({
    public: {},  // Will be structured as: {chainId: {tokenSymbol: balance}}
    private: {}, // Will be structured as: {chainId: {tokenSymbol: balance}}
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

  // Get supported tokens list for forms
  const getTokensForChain = (chainId) => {
    return Object.entries(SUPPORTED_TOKENS)
      .filter(([symbol, chains]) => chains[chainId])
      .map(([symbol, chains]) => ({
        symbol,
        address: chains[chainId].address || '0x0000000000000000000000000000000000000000',
        decimals: chains[chainId].decimals
      }));
  };

  const loadBalances = async () => {
    if (!isConnected || !address) return;

    setLoading(true);
    try {
      console.log('📊 Loading multi-chain balances for address:', address);

      // Fetch public balances across all supported chains
      console.log('🔍 Fetching public balances...');
      const publicBalances = await fetchPublicBalances(address);

      // Get private balances from RAILGUN callback system
      let privateBalances = {};
      if (isRailgunInitialized && railgunAddress) {
        console.log('🔄 Triggering RAILGUN balance refresh...');
        await refreshRailgunBalances();
        
        console.log('📈 Getting RAILGUN balances from callback system...');
        privateBalances = getRailgunBalances();
      } else {
        console.log('⚠️ RAILGUN not initialized, using zero balances');
        // Initialize with zeros if Railgun not ready
        privateBalances = Object.fromEntries(
          Object.keys(SUPPORTED_CHAINS).map(chainId => [
            parseInt(chainId),
            Object.fromEntries(
              Object.keys(SUPPORTED_TOKENS).map(symbol => [
                symbol,
                SUPPORTED_TOKENS[symbol][parseInt(chainId)] ? 
                  (SUPPORTED_TOKENS[symbol][parseInt(chainId)].decimals === 18 ? '0.0000' : '0.00') : 
                  '0.00'
              ])
            )
          ])
        );
      }

      console.log('✅ Final multi-chain balances:', {
        public: publicBalances,
        private: privateBalances,
        isRailgunInitialized,
        railgunAddress
      });

      setBalances({
        public: publicBalances,
        private: privateBalances,
      });

    } catch (error) {
      console.error('❌ Failed to load balances:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && address) {
      loadBalances();
    }
  }, [isConnected, address, isRailgunInitialized]);

  // Set up RAILGUN balance update listener
  useEffect(() => {
    if (isRailgunInitialized) {
      console.log('🔔 Setting up RAILGUN balance update listener...');
      
      const unsubscribe = addBalanceUpdateListener(() => {
        console.log('💰 RAILGUN balance update received, refreshing UI...');
        
        // Update private balances with new data from callback
        setBalances(prevBalances => ({
          ...prevBalances,
          private: getRailgunBalances()
        }));
      });

      console.log('✅ RAILGUN balance update listener active');
      
      // Cleanup listener on unmount or when Railgun state changes
      return () => {
        console.log('🔕 Removing RAILGUN balance update listener...');
        unsubscribe();
      };
    }
  }, [isRailgunInitialized]);

  // Manual refresh function
  const handleRefreshBalances = async () => {
    clearBalanceCache();
    await loadBalances();
  };

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
    
    const newTx = {
      id: Date.now(),
      type: 'shield',
      status: 'pending',
      amount: shieldForm.amount,
      token: Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === shieldForm.tokenAddress)
      ) || 'Unknown',
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🛡️ Starting shield transaction:', shieldForm);
      
      // Get token configuration
      const tokenSymbol = Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === shieldForm.tokenAddress)
      );
      
      if (!tokenSymbol) {
        throw new Error('Token configuration not found');
      }
      
      const currentChainId = chainId || 1; // Default to Ethereum if chainId not available
      const tokenConfig = getTokenConfig(currentChainId, tokenSymbol);
      
      if (!tokenConfig) {
        throw new Error(`Token ${tokenSymbol} not supported on chain ${currentChainId}`);
      }

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(shieldForm.amount, tokenConfig.decimals);
      
      // Execute shield transaction
      const result = await executeShield({
        railgunWalletID,
        railgunAddress,
        tokenAddress: tokenConfig.address, // null for native tokens becomes '0x0000...' in function
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
    
    const newTx = {
      id: Date.now(),
      type: 'transfer',
      status: 'pending',
      amount: transferForm.amount,
      token: Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === transferForm.tokenAddress)
      ) || 'Unknown',
      recipient: transferForm.recipientAddress,
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🔒 Starting private transfer:', transferForm);
      
      // Get token configuration
      const tokenSymbol = Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === transferForm.tokenAddress)
      );
      
      if (!tokenSymbol) {
        throw new Error('Token configuration not found');
      }
      
      const currentChainId = chainId || 1;
      const tokenConfig = getTokenConfig(currentChainId, tokenSymbol);
      
      if (!tokenConfig) {
        throw new Error(`Token ${tokenSymbol} not supported on chain ${currentChainId}`);
      }

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(transferForm.amount, tokenConfig.decimals);
      
      // Execute private transfer
      const result = await executePrivateTransfer({
        railgunWalletID,
        fromRailgunAddress: railgunAddress,
        toRailgunAddress: transferForm.recipientAddress,
        tokenAddress: tokenConfig.address,
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
    
    const recipientAddress = unshieldForm.recipientAddress || address;
    
    const newTx = {
      id: Date.now(),
      type: 'unshield',
      status: 'pending',
      amount: unshieldForm.amount,
      token: Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === unshieldForm.tokenAddress)
      ) || 'Unknown',
      recipient: recipientAddress,
      timestamp: new Date(),
    };
    setTransactions(prev => [newTx, ...prev]);

    try {
      console.log('🔓 Starting unshield transaction:', unshieldForm);
      
      // Get token configuration
      const tokenSymbol = Object.keys(SUPPORTED_TOKENS).find(symbol => 
        Object.values(SUPPORTED_TOKENS[symbol]).some(config => config.address === unshieldForm.tokenAddress)
      );
      
      if (!tokenSymbol) {
        throw new Error('Token configuration not found');
      }
      
      const currentChainId = chainId || 1;
      const tokenConfig = getTokenConfig(currentChainId, tokenSymbol);
      
      if (!tokenConfig) {
        throw new Error(`Token ${tokenSymbol} not supported on chain ${currentChainId}`);
      }

      // Convert amount to base units
      const amountInBaseUnits = convertToBaseUnits(unshieldForm.amount, tokenConfig.decimals);
      
      // Execute unshield transaction
      const result = await executeUnshield({
        railgunWalletID,
        railgunAddress,
        tokenAddress: tokenConfig.address,
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

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 w-full p-6 bg-black border-b border-gray-700">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <button 
            onClick={() => navigate('/')}
            className="text-4xl font-bold text-purple-300 hover:text-white transition-colors"
          >
            LEXIE AI
          </button>
          <div className="flex items-center space-x-6">
            <button 
              onClick={() => navigate('/')}
              className="text-lg font-bold text-purple-300 hover:text-white transition-colors"
            >
              ← Back to Home
            </button>
            
            {/* Wallet Status */}
            {!isConnected ? (
              <div className="flex items-center space-x-4">
                <span className="text-gray-400">Not connected</span>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  <span className="text-green-400 text-sm font-mono">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  {isRailgunInitialized && (
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                  )}
                </div>
                <button
                  onClick={disconnectWallet}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-sm"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {!isConnected ? (
          <div className="text-center py-20">
            <h1 className="text-4xl font-bold text-white mb-8">Private Wallet</h1>
            <p className="text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
              Connect your wallet to access private transaction features powered by Railgun
            </p>
            <div className="flex gap-6 justify-center">
              <button
                onClick={() => connectWallet('metamask')}
                className="px-8 py-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-colors text-lg"
              >
                Connect MetaMask
              </button>
              <button
                onClick={() => connectWallet('walletconnect')}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
              >
                WalletConnect
              </button>
            </div>
          </div>
        ) : !isRailgunInitialized ? (
          <div className="text-center py-20">
            <div className="flex items-center justify-center space-x-3 mb-6">
              <div className="w-6 h-6 bg-purple-500 rounded-full animate-pulse"></div>
              <span className="text-2xl font-semibold text-white">
                {isInitializing ? 'Initializing Railgun...' : 'Railgun Not Initialized'}
              </span>
            </div>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              {isInitializing 
                ? 'Setting up your private wallet infrastructure. This may take a moment...'
                : 'Your Railgun wallet is being prepared for private transactions.'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold text-white mb-4">Private Wallet</h1>
              <p className="text-lg text-gray-400 max-w-3xl mx-auto">
                Shield, transfer, and unshield assets privately using Railgun's zero-knowledge technology
              </p>
            </div>

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left Panel - Transaction Controls */}
              <div className="lg:col-span-2 space-y-6">
                {/* Tab Navigation */}
                <div className="flex space-x-1 bg-gray-800 rounded-lg p-1">
                  {[
                    { id: 'shield', label: 'Shield Assets', icon: '🛡️' },
                    { id: 'transfer', label: 'Private Transfer', icon: '🔄' },
                    { id: 'unshield', label: 'Unshield Assets', icon: '🔓' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 px-6 py-4 rounded-md font-medium transition-colors ${
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

                {/* Transaction Forms */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-8">
                  {/* Shield Assets Tab */}
                  {activeTab === 'shield' && (
                    <form onSubmit={handleShield} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-white mb-4">Shield Assets</h2>
                      <p className="text-gray-400 mb-6">
                        Deposit public tokens into your private Railgun balance for anonymous transactions.
                      </p>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Token</label>
                        <select
                          value={shieldForm.tokenAddress}
                          onChange={(e) => setShieldForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        >
                          <option value="">Select a token</option>
                          {Object.entries(SUPPORTED_TOKENS).map(([symbol, chains]) => 
                            Object.entries(chains).map(([chainId, config]) => {
                              const chainConfig = getChainConfig(parseInt(chainId));
                              return (
                                <option key={`${chainId}-${symbol}`} value={config.address || '0x0000000000000000000000000000000000000000'}>
                                  {symbol} ({chainConfig?.name})
                                </option>
                              );
                            })
                          ).flat()}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Amount</label>
                        <input
                          type="number"
                          step="any"
                          value={shieldForm.amount}
                          onChange={(e) => setShieldForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0.0"
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-6 py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-lg"
                      >
                        {loading ? 'Shielding...' : 'Shield Assets'}
                      </button>
                    </form>
                  )}

                  {/* Private Transfer Tab */}
                  {activeTab === 'transfer' && (
                    <form onSubmit={handlePrivateTransfer} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-white mb-4">Private Transfer</h2>
                      <p className="text-gray-400 mb-6">
                        Send tokens privately from your shielded balance to another Railgun address.
                      </p>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Recipient Address</label>
                        <input
                          type="text"
                          value={transferForm.recipientAddress}
                          onChange={(e) => setTransferForm(prev => ({ ...prev, recipientAddress: e.target.value }))}
                          placeholder="0x... or Railgun address"
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Token</label>
                        <select
                          value={transferForm.tokenAddress}
                          onChange={(e) => setTransferForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        >
                          <option value="">Select a token</option>
                          {Object.entries(SUPPORTED_TOKENS).map(([symbol, chains]) => 
                            Object.entries(chains).map(([chainId, config]) => {
                              const chainConfig = getChainConfig(parseInt(chainId));
                              return (
                                <option key={`${chainId}-${symbol}`} value={config.address || '0x0000000000000000000000000000000000000000'}>
                                  {symbol} ({chainConfig?.name})
                                </option>
                              );
                            })
                          ).flat()}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Amount</label>
                        <input
                          type="number"
                          step="any"
                          value={transferForm.amount}
                          onChange={(e) => setTransferForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0.0"
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-6 py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-lg"
                      >
                        {loading ? 'Sending...' : 'Send Privately'}
                      </button>
                    </form>
                  )}

                  {/* Unshield Assets Tab */}
                  {activeTab === 'unshield' && (
                    <form onSubmit={handleUnshield} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-white mb-4">Unshield Assets</h2>
                      <p className="text-gray-400 mb-6">
                        Withdraw tokens from your private balance back to a public wallet address.
                      </p>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Token</label>
                        <select
                          value={unshieldForm.tokenAddress}
                          onChange={(e) => setUnshieldForm(prev => ({ ...prev, tokenAddress: e.target.value }))}
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        >
                          <option value="">Select a token</option>
                          {Object.entries(SUPPORTED_TOKENS).map(([symbol, chains]) => 
                            Object.entries(chains).map(([chainId, config]) => {
                              const chainConfig = getChainConfig(parseInt(chainId));
                              return (
                                <option key={`${chainId}-${symbol}`} value={config.address || '0x0000000000000000000000000000000000000000'}>
                                  {symbol} ({chainConfig?.name})
                                </option>
                              );
                            })
                          ).flat()}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Amount</label>
                        <input
                          type="number"
                          step="any"
                          value={unshieldForm.amount}
                          onChange={(e) => setUnshieldForm(prev => ({ ...prev, amount: e.target.value }))}
                          placeholder="0.0"
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">
                          Recipient Address (Optional)
                        </label>
                        <input
                          type="text"
                          value={unshieldForm.recipientAddress}
                          onChange={(e) => setUnshieldForm(prev => ({ ...prev, recipientAddress: e.target.value }))}
                          placeholder={`${address?.slice(0, 6)}...${address?.slice(-4)} (Your wallet)`}
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-md text-white focus:border-purple-500 focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full px-6 py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors text-lg"
                      >
                        {loading ? 'Unshielding...' : 'Unshield Assets'}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Right Panel - Balances & Transactions */}
              <div className="space-y-6">
                {/* Balances Card */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-semibold text-white">Multi-Chain Balances</h3>
                    <button
                      onClick={handleRefreshBalances}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                    >
                      {loading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                      <span className="ml-3 text-gray-400">Loading balances...</span>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Private Balances by Chain */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-400 mb-4">
                          🔒 Private Balances (RAILGUN)
                          {!isRailgunInitialized && (
                            <span className="ml-2 text-xs text-amber-400">(Initializing...)</span>
                          )}
                        </h4>
                        {Object.entries(balances.private).map(([chainId, chainBalances]) => {
                          const chainConfig = getChainConfig(parseInt(chainId));
                          if (!chainConfig) return null;
                          
                          const hasNonZeroBalances = Object.values(chainBalances).some(balance => 
                            parseFloat(balance) > 0
                          );

                          return (
                            <div key={chainId} className="mb-4">
                              <div className="flex items-center mb-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  {chainConfig.name}
                                </span>
                                {!hasNonZeroBalances && (
                                  <span className="ml-2 text-xs text-gray-600">(No assets)</span>
                                )}
                              </div>
                              {hasNonZeroBalances ? (
                                <div className="space-y-1 ml-2">
                                  {Object.entries(chainBalances)
                                    .filter(([symbol, balance]) => parseFloat(balance) > 0)
                                    .map(([symbol, balance]) => (
                                    <div key={`${chainId}-${symbol}`} className="flex justify-between py-1.5 px-3 bg-gray-800 rounded text-sm">
                                      <span className="text-gray-300 font-medium">{symbol}</span>
                                      <div className="flex items-center space-x-2">
                                        <span className="text-green-400 font-semibold">{balance}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-gray-600 ml-2 italic">No private assets on this chain</div>
                              )}
                            </div>
                          );
                        })}
                        
                        {isRailgunInitialized && Object.values(balances.private).every(chainBalances => 
                          Object.values(chainBalances).every(v => parseFloat(v) === 0)
                        ) && (
                          <div className="text-xs text-gray-500 mt-2 p-3 bg-gray-800/50 rounded">
                            <div className="flex items-center">
                              <svg className="w-4 h-4 mr-2 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              No private assets found. Shield tokens to create private balances.
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Public Balances by Chain */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-400 mb-4">🌐 Public Balances</h4>
                        {Object.entries(balances.public).map(([chainId, chainBalances]) => {
                          const chainConfig = getChainConfig(parseInt(chainId));
                          if (!chainConfig) return null;
                          
                          const hasNonZeroBalances = Object.values(chainBalances).some(balance => 
                            parseFloat(balance) > 0
                          );

                          return (
                            <div key={chainId} className="mb-4">
                              <div className="flex items-center mb-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  {chainConfig.name}
                                </span>
                                {!hasNonZeroBalances && (
                                  <span className="ml-2 text-xs text-gray-600">(No assets)</span>
                                )}
                              </div>
                              {hasNonZeroBalances ? (
                                <div className="space-y-1 ml-2">
                                  {Object.entries(chainBalances)
                                    .filter(([symbol, balance]) => parseFloat(balance) > 0)
                                    .map(([symbol, balance]) => (
                                    <div key={`${chainId}-${symbol}`} className="flex justify-between py-1.5 px-3 bg-gray-800 rounded text-sm">
                                      <span className="text-gray-300 font-medium">{symbol}</span>
                                      <div className="flex items-center space-x-2">
                                        <span className="text-blue-400 font-semibold">{balance}</span>
                                        <button
                                          onClick={() => {
                                            // Pre-fill shield form
                                            setShieldForm(prev => ({
                                              ...prev,
                                              tokenAddress: SUPPORTED_TOKENS[symbol]?.[parseInt(chainId)]?.address || '0x0000000000000000000000000000000000000000',
                                              amount: balance
                                            }));
                                            setActiveTab('shield');
                                          }}
                                          className="text-xs px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded"
                                          title="Shield this asset"
                                        >
                                          Shield
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-gray-600 ml-2 italic">No assets on this chain</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recent Transactions Card */}
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
                  <h3 className="text-xl font-semibold text-white mb-6">Recent Transactions</h3>
                  <div className="space-y-3">
                    {transactions.slice(0, 8).map((tx) => (
                      <div key={tx.id} className="bg-gray-800 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
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
                        <div className="text-sm text-gray-400 mb-1">
                          {tx.amount} {tx.token}
                        </div>
                        {tx.recipient && (
                          <div className="text-xs text-gray-500">
                            To: {tx.recipient.slice(0, 6)}...{tx.recipient.slice(-4)}
                          </div>
                        )}
                      </div>
                    ))}
                    {transactions.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        No transactions yet
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default WalletPage; 