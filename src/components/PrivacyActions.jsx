/**
 * Privacy Actions Component
 * Provides Shield, Transfer, and Unshield functionality for Railgun privacy wallet
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { 
  ShieldCheckIcon, 
  ArrowRightIcon, 
  EyeSlashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import {
  shieldTokens,
  unshieldTokens,
  transferPrivate,
  shieldAllTokens,
  parseTokenAmount,
  formatTokenAmount,
  isTokenSupportedByRailgun,
} from '../utils/railgun/actions';
import { getShieldableTokens, checkSufficientBalance } from '../utils/web3/balances';
import { deriveEncryptionKey } from '../utils/railgun/wallet';

const PrivacyActions = () => {
  const {
    isConnected,
    address,
    chainId,
    railgunWalletId,
    railgunAddress,
    canUseRailgun,
    getCurrentNetwork,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    isLoading,
    refreshAllBalances,
    formatBalance,
  } = useBalances();

  // UI state
  const [activeTab, setActiveTab] = useState('shield');
  const [isProcessing, setIsProcessing] = useState(false);
  const [shieldableTokens, setShieldableTokens] = useState([]);

  // Shield state
  const [selectedShieldToken, setSelectedShieldToken] = useState(null);
  const [shieldAmount, setShieldAmount] = useState('');

  // Transfer state
  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedTransferToken, setSelectedTransferToken] = useState(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMemo, setTransferMemo] = useState('');

  // Unshield state
  const [selectedUnshieldToken, setSelectedUnshieldToken] = useState(null);
  const [unshieldAmount, setUnshieldAmount] = useState('');
  const [unshieldDestination, setUnshieldDestination] = useState('');

  const network = getCurrentNetwork();

  // Derive encryption key from user address and chain ID
  const encryptionKey = useMemo(async () => {
    if (!address || !chainId) return null;
    
    try {
      const salt = `lexie-railgun-${address.toLowerCase()}-${chainId}`;
      return await deriveEncryptionKey(address.toLowerCase(), salt);
    } catch (error) {
      console.error('[PrivacyActions] Failed to derive encryption key:', error);
      return null;
    }
  }, [address, chainId]);

  // Load shieldable tokens when connected
  useEffect(() => {
    const loadShieldableTokens = async () => {
      if (!isConnected || !address || !chainId) return;

      try {
        const tokens = await getShieldableTokens(address, chainId);
        setShieldableTokens(tokens);
      } catch (error) {
        console.error('[PrivacyActions] Failed to load shieldable tokens:', error);
      }
    };

    loadShieldableTokens();
  }, [isConnected, address, chainId, publicBalances]);

  // Auto-select first token with balance for each action
  useEffect(() => {
    if (shieldableTokens.length > 0 && !selectedShieldToken) {
      setSelectedShieldToken(shieldableTokens[0]);
    }
  }, [shieldableTokens, selectedShieldToken]);

  useEffect(() => {
    const privateTokensArray = Object.values(privateBalances);
    if (privateTokensArray.length > 0) {
      if (!selectedTransferToken) {
        const tokenWithBalance = privateTokensArray.find(t => t.numericBalance > 0);
        setSelectedTransferToken(tokenWithBalance || privateTokensArray[0]);
      }
      if (!selectedUnshieldToken) {
        const tokenWithBalance = privateTokensArray.find(t => t.numericBalance > 0);
        setSelectedUnshieldToken(tokenWithBalance || privateTokensArray[0]);
      }
    }
  }, [privateBalances, selectedTransferToken, selectedUnshieldToken]);

  // Get encryption key asynchronously
  const getEncryptionKey = useCallback(async () => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const salt = `lexie-railgun-${address.toLowerCase()}-${chainId}`;
      return await deriveEncryptionKey(address.toLowerCase(), salt);
    } catch (error) {
      console.error('[PrivacyActions] Failed to derive encryption key:', error);
      throw new Error('Failed to derive encryption key');
    }
  }, [address, chainId]);

  // Shield individual token
  const handleShieldToken = useCallback(async (token, amount) => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Validate amount
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      // Check sufficient balance
      const balanceCheck = await checkSufficientBalance(
        address,
        token.address,
        amount,
        chainId
      );

      if (!balanceCheck.hasSufficient) {
        throw new Error(`Insufficient balance. Available: ${balanceCheck.available} ${token.symbol}`);
      }

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(amount, token.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute shield operation
      toast.loading(`Shielding ${amount} ${token.symbol}...`);
      
      const result = await shieldTokens(
        railgunWalletId,
        key,
        token.address,
        amountInUnits,
        chainConfig,
        address
      );

      toast.dismiss();
      toast.success(`Successfully shielded ${amount} ${token.symbol}!`);
      
      // Refresh balances
      await refreshAllBalances();
      
      // Clear form
      setShieldAmount('');
      
    } catch (error) {
      console.error('[PrivacyActions] Shield failed:', error);
      toast.dismiss();
      toast.error(`Shield failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, refreshAllBalances, getEncryptionKey]);

  // Shield all tokens
  const handleShieldAll = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !address || shieldableTokens.length === 0) {
      toast.error('No tokens available to shield');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Prepare tokens for shielding (only those with meaningful balances)
      const tokensToShield = shieldableTokens
        .filter(token => token.numericBalance > 0.001) // Ignore dust balances
        .map(token => ({
          address: token.address,
          amount: parseTokenAmount(token.numericBalance.toString(), token.decimals),
          symbol: token.symbol,
        }));

      if (tokensToShield.length === 0) {
        throw new Error('No tokens with sufficient balance to shield');
      }

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute shield all operation
      toast.loading(`Shielding ${tokensToShield.length} tokens...`);
      
      const result = await shieldAllTokens(
        railgunWalletId,
        key,
        tokensToShield,
        chainConfig,
        address
      );

      toast.dismiss();
      
      if (result.success) {
        toast.success(`Successfully shielded all tokens!`);
      } else {
        toast.error(`Shield All completed with ${result.summary.failed} failures`);
      }
      
      // Refresh balances
      await refreshAllBalances();
      
    } catch (error) {
      console.error('[PrivacyActions] Shield All failed:', error);
      toast.dismiss();
      toast.error(`Shield All failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, address, shieldableTokens, chainId, network, refreshAllBalances, getEncryptionKey]);

  // Private transfer
  const handlePrivateTransfer = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !selectedTransferToken) {
      toast.error('Railgun wallet not ready or no token selected');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Validate inputs
      if (!recipientAddress.startsWith('0zk')) {
        throw new Error('Invalid Railgun address. Must start with "0zk"');
      }

      if (!transferAmount || parseFloat(transferAmount) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      // Check sufficient private balance
      const available = selectedTransferToken.numericBalance || 0;
      const required = parseFloat(transferAmount);
      
      if (available < required) {
        throw new Error(`Insufficient private balance. Available: ${available} ${selectedTransferToken.symbol}`);
      }

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(transferAmount, selectedTransferToken.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute private transfer
      toast.loading(`Transferring ${transferAmount} ${selectedTransferToken.symbol}...`);
      
      const result = await transferPrivate(
        railgunWalletId,
        key,
        recipientAddress,
        selectedTransferToken.address,
        amountInUnits,
        chainConfig,
        transferMemo
      );

      toast.dismiss();
      toast.success(`Successfully transferred ${transferAmount} ${selectedTransferToken.symbol}!`);
      
      // Refresh balances
      await refreshAllBalances();
      
      // Clear form
      setTransferAmount('');
      setRecipientAddress('');
      setTransferMemo('');
      
    } catch (error) {
      console.error('[PrivacyActions] Private transfer failed:', error);
      toast.dismiss();
      toast.error(`Transfer failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, selectedTransferToken, recipientAddress, transferAmount, transferMemo, chainId, network, refreshAllBalances, getEncryptionKey]);

  // Unshield tokens
  const handleUnshield = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !selectedUnshieldToken) {
      toast.error('Railgun wallet not ready or no token selected');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Validate inputs
      if (!unshieldDestination || unshieldDestination.length !== 42) {
        throw new Error('Please enter a valid Ethereum address');
      }

      if (!unshieldAmount || parseFloat(unshieldAmount) <= 0) {
        throw new Error('Please enter a valid amount');
      }

      // Check sufficient private balance
      const available = selectedUnshieldToken.numericBalance || 0;
      const required = parseFloat(unshieldAmount);
      
      if (available < required) {
        throw new Error(`Insufficient private balance. Available: ${available} ${selectedUnshieldToken.symbol}`);
      }

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(unshieldAmount, selectedUnshieldToken.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute unshield operation
      toast.loading(`Unshielding ${unshieldAmount} ${selectedUnshieldToken.symbol}...`);
      
      const result = await unshieldTokens(
        railgunWalletId,
        key,
        selectedUnshieldToken.address,
        amountInUnits,
        chainConfig,
        unshieldDestination
      );

      toast.dismiss();
      toast.success(`Successfully unshielded ${unshieldAmount} ${selectedUnshieldToken.symbol}!`);
      
      // Refresh balances
      await refreshAllBalances();
      
      // Clear form
      setUnshieldAmount('');
      setUnshieldDestination('');
      
    } catch (error) {
      console.error('[PrivacyActions] Unshield failed:', error);
      toast.dismiss();
      toast.error(`Unshield failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, selectedUnshieldToken, unshieldAmount, unshieldDestination, chainId, network, refreshAllBalances, getEncryptionKey]);

  if (!isConnected || !canUseRailgun) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 text-center">
        <ExclamationTriangleIcon className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-white mb-2">Privacy Features Unavailable</h3>
        <p className="text-gray-300">
          Connect your wallet and ensure Railgun is initialized to use privacy features.
        </p>
      </div>
    );
  }

  const tabs = [
    { id: 'shield', name: 'Shield', icon: ShieldCheckIcon, description: 'Convert public tokens to private' },
    { id: 'transfer', name: 'Transfer', icon: ArrowRightIcon, description: 'Send private tokens to another Railgun wallet' },
    { id: 'unshield', name: 'Unshield', icon: EyeSlashIcon, description: 'Convert private tokens back to public' },
  ];

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                data-tab={tab.id}
                className={`group relative min-w-0 flex-1 overflow-hidden py-4 px-6 text-sm font-medium text-center hover:bg-gray-700 focus:z-10 transition-colors ${
                  activeTab === tab.id
                    ? 'text-purple-400 border-b-2 border-purple-400 bg-gray-750'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Icon className="h-5 w-5 mx-auto mb-1" />
                <span>{tab.name}</span>
                {activeTab === tab.id && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-purple-400" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {/* Shield Tab */}
        {activeTab === 'shield' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Shield Tokens</h3>
              <p className="text-gray-300 text-sm mb-4">
                Convert your public tokens into private Railgun tokens for enhanced privacy.
              </p>
            </div>

            {/* Shield All Button */}
            {shieldableTokens.length > 0 && (
              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-white font-medium">Shield All Tokens</h4>
                    <p className="text-gray-300 text-sm">
                      Shield all {shieldableTokens.length} tokens with non-zero balances
                    </p>
                  </div>
                  <button
                    onClick={handleShieldAll}
                    disabled={isProcessing || shieldableTokens.length === 0}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    {isProcessing ? 'Processing...' : 'Shield All'}
                  </button>
                </div>
              </div>
            )}

            {/* Individual Token Shielding */}
            <div className="space-y-4">
              <h4 className="text-white font-medium">Shield Individual Tokens</h4>
              
              {Object.values(publicBalances).map((token) => (
                <div key={token.symbol} className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="bg-gray-600 rounded-full p-2">
                        <CurrencyDollarIcon className="h-5 w-5 text-gray-300" />
                      </div>
                      <div>
                        <div className="text-white font-medium">{token.symbol}</div>
                        <div className="text-gray-300 text-sm">
                          Balance: {token.formattedBalance}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        placeholder="Amount"
                        className="bg-gray-600 text-white rounded px-3 py-1 w-24 text-sm"
                        value={selectedShieldToken?.symbol === token.symbol ? shieldAmount : ''}
                        onChange={(e) => {
                          setSelectedShieldToken(token);
                          setShieldAmount(e.target.value);
                        }}
                        disabled={isProcessing || !token.hasBalance}
                      />
                      <button
                        onClick={() => handleShieldToken(token, shieldAmount)}
                        disabled={isProcessing || !token.hasBalance || !shieldAmount}
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
                      >
                        Shield
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transfer Tab */}
        {activeTab === 'transfer' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Private Transfer</h3>
              <p className="text-gray-300 text-sm mb-4">
                Send private tokens to another Railgun wallet address.
              </p>
            </div>

            <div className="space-y-4">
              {/* Recipient Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Recipient Railgun Address
                </label>
                <input
                  type="text"
                  placeholder="0zk..."
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Token Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token
                </label>
                <select
                  value={selectedTransferToken?.symbol || ''}
                  onChange={(e) => {
                    const token = Object.values(privateBalances).find(t => t.symbol === e.target.value);
                    setSelectedTransferToken(token);
                  }}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Select token</option>
                  {Object.values(privateBalances).map((token) => (
                    <option key={token.symbol} value={token.symbol}>
                      {token.symbol} (Balance: {token.formattedBalance})
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount
                </label>
                <input
                  type="number"
                  placeholder="0.0"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Memo (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Memo (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Optional message"
                  value={transferMemo}
                  onChange={(e) => setTransferMemo(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Transfer Button */}
              <button
                onClick={handlePrivateTransfer}
                disabled={isProcessing || !recipientAddress || !selectedTransferToken || !transferAmount}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-medium transition-colors"
              >
                {isProcessing ? 'Processing Transfer...' : 'Send Private Transfer'}
              </button>
            </div>
          </div>
        )}

        {/* Unshield Tab */}
        {activeTab === 'unshield' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Unshield Tokens</h3>
              <p className="text-gray-300 text-sm mb-4">
                Convert your private tokens back to public tokens in your EOA wallet.
              </p>
            </div>

            <div className="space-y-4">
              {/* Token Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token
                </label>
                <select
                  value={selectedUnshieldToken?.symbol || ''}
                  onChange={(e) => {
                    const token = Object.values(privateBalances).find(t => t.symbol === e.target.value);
                    setSelectedUnshieldToken(token);
                  }}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Select token</option>
                  {Object.values(privateBalances).map((token) => (
                    <option key={token.symbol} value={token.symbol}>
                      {token.symbol} (Balance: {token.formattedBalance})
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount
                </label>
                <input
                  type="number"
                  placeholder="0.0"
                  value={unshieldAmount}
                  onChange={(e) => setUnshieldAmount(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Destination Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Destination Address
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={unshieldDestination}
                  onChange={(e) => setUnshieldDestination(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={() => setUnshieldDestination(address)}
                  className="mt-2 text-purple-400 hover:text-purple-300 text-sm"
                >
                  Use my address ({address?.slice(0, 6)}...{address?.slice(-4)})
                </button>
              </div>

              {/* Unshield Button */}
              <button
                onClick={handleUnshield}
                disabled={isProcessing || !selectedUnshieldToken || !unshieldAmount || !unshieldDestination}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-medium transition-colors"
              >
                {isProcessing ? 'Processing Unshield...' : 'Unshield to Public'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivacyActions; 