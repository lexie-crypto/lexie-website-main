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
import useRailgunFees from '../hooks/useRailgunFees';
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

  const {
    fees: railgunFees,
    isLoading: isFeesLoading,
    getFeeForOperation,
    calculateFeeAmount,
  } = useRailgunFees();

  // UI state
  const [activeTab, setActiveTab] = useState('send');
  const [isProcessing, setIsProcessing] = useState(false);

  // Send Privately form state
  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedToken, setSelectedToken] = useState(null);
  const [sendAmount, setSendAmount] = useState('');
  const [memo, setMemo] = useState('');

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

  // Load shieldable tokens when connected (keeping for potential future use)
  useEffect(() => {
    const loadShieldableTokens = async () => {
      if (!isConnected || !address || !chainId) return;

      try {
        const tokens = await getShieldableTokens(address, chainId);
        // tokens available for future features
      } catch (error) {
        console.error('[PrivacyActions] Failed to load shieldable tokens:', error);
      }
    };

    loadShieldableTokens();
  }, [isConnected, address, chainId, publicBalances]);

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

  // Auto-detect address type and return validation info
  const detectAddressType = useCallback((address) => {
    if (!address || address.trim() === '') {
      return { type: 'unknown', isValid: false, message: 'Please enter an address' };
    }

    const trimmedAddress = address.trim();
    
    // Railgun address detection
    if (trimmedAddress.startsWith('0zk')) {
      if (trimmedAddress.length >= 64) { // Railgun addresses are typically longer
        return { 
          type: 'railgun', 
          isValid: true, 
          message: '🔒 Private transfer - Your identity will remain hidden'
        };
      } else {
        return { 
          type: 'railgun', 
          isValid: false, 
          message: 'Invalid Railgun address format'
        };
      }
    }
    
    // EOA address detection
    if (trimmedAddress.startsWith('0x')) {
      if (/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) {
        return { 
          type: 'eoa', 
          isValid: true, 
          message: '⚠️ Public transfer - This transaction will be visible on-chain, but your identity will remain private'
        };
      } else {
        return { 
          type: 'eoa', 
          isValid: false, 
          message: 'Invalid Ethereum address format'
        };
      }
    }
    
    return { 
      type: 'unknown', 
      isValid: false, 
      message: 'Address must start with "0zk" (Railgun) or "0x" (Ethereum)'
    };
  }, []);

  // Get current address validation info
  const addressValidation = useMemo(() => {
    return detectAddressType(recipientAddress);
  }, [recipientAddress, detectAddressType]);

  // Validate form fields
  const isFormValid = useMemo(() => {
    return (
      addressValidation.isValid &&
      selectedToken &&
      sendAmount &&
      parseFloat(sendAmount) > 0 &&
      parseFloat(sendAmount) <= (selectedToken?.numericBalance || 0)
    );
  }, [addressValidation, selectedToken, sendAmount]);

  // Send Privately (handles both Railgun-to-Railgun and Railgun-to-EOA with atomic shield → transfer)
  const handleSendPrivately = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId) {
      toast.error('Railgun wallet not ready');
      return;
    }

    if (!isFormValid) {
      toast.error('Please fill all required fields correctly');
      return;
    }

    try {
      setIsProcessing(true);
      
      console.log('[PrivacyActions] Starting atomic shield → transfer operation:', {
        token: selectedToken.symbol,
        amount: sendAmount,
        to: recipientAddress,
        addressType: addressValidation.type,
        memo: memo || 'None'
      });

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(sendAmount, selectedToken.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Step 1: Shield the tokens to user's own Railgun wallet
      toast.loading(`Step 1/2: Shielding ${sendAmount} ${selectedToken.symbol} to your private wallet...`, { duration: 0 });
      
      const shieldResult = await shieldTokens(
        railgunWalletId,
        key,
        selectedToken.address,
        amountInUnits,
        chainConfig,
        address, // From user's public address
        railgunAddress, // To user's own Railgun address (this is correct)
        address // Use user's own address for gas estimation (required parameter)
      );

      console.log('[PrivacyActions] Shield completed:', shieldResult);

      // Step 2: Now transfer the shielded tokens to the recipient
      let transferResult;

      if (addressValidation.type === 'railgun') {
        // Railgun-to-Railgun private transfer
        toast.loading(`Step 2/2: Sending ${sendAmount} ${selectedToken.symbol} privately to recipient...`, { duration: 0 });
        
        transferResult = await transferPrivate(
          railgunWalletId,
          key,
          recipientAddress,
          selectedToken.address,
          amountInUnits,
          chainConfig,
          memo
        );

        toast.dismiss();
        toast.success(`✅ Private transfer completed! ${sendAmount} ${selectedToken.symbol} sent privately.`, { duration: 5000 });
        
      } else if (addressValidation.type === 'eoa') {
        // Railgun-to-EOA unshield transfer
        toast.loading(`Step 2/2: Unshielding ${sendAmount} ${selectedToken.symbol} to public wallet...`, { duration: 0 });
        
        transferResult = await unshieldTokens(
          railgunWalletId,
          key,
          selectedToken.address,
          amountInUnits,
          chainConfig,
          recipientAddress
        );

        toast.dismiss();
        
        // Show fee information in success message
        const feeAmount = transferResult.feeAmount || '0';
        const feeInTokens = formatTokenAmount(feeAmount, selectedToken.decimals);
        
        toast.success(
          `✅ Private transaction completed! ${sendAmount} ${selectedToken.symbol} sent to public wallet. Fee: ${feeInTokens} ${selectedToken.symbol}`, 
          { duration: 8000 }
        );
      }
      
      console.log('[PrivacyActions] Complete transaction finished:', { shieldResult, transferResult });
      
      // Clear form
      setSendAmount('');
      setRecipientAddress('');
      setMemo('');
      setSelectedToken(null);
      
      // Refresh balances to reflect the changes
      try {
        await refreshAllBalances();
      } catch (refreshError) {
        console.warn('[PrivacyActions] Balance refresh failed after transaction:', refreshError);
        // Don't show error to user since transaction succeeded
      }
      
    } catch (error) {
      console.error('[PrivacyActions] Private transaction failed:', error);
      toast.dismiss();
      toast.error(`❌ Private transaction failed: ${error.message}`, { duration: 8000 });
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, isFormValid, selectedToken, sendAmount, recipientAddress, memo, chainId, network, getEncryptionKey, addressValidation, address, railgunAddress, refreshAllBalances]);



  if (!isConnected || !canUseRailgun) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 text-center">
        <ExclamationTriangleIcon className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-white mb-2">Privacy Features Unavailable</h3>
        <p className="text-gray-300 mb-4">
          Connect your wallet and ensure Railgun is initialized to use privacy features.
        </p>
        {!isConnected && (
          <p className="text-gray-400 text-sm">
            Please connect your wallet to access privacy features.
          </p>
        )}
        {isConnected && !canUseRailgun && (
          <p className="text-gray-400 text-sm">
            Railgun privacy engine is starting up. This may take a few moments...
          </p>
        )}
      </div>
    );
  }

  const tabs = [
    { id: 'send', name: 'Send Privately', icon: ArrowRightIcon, description: 'Send your private tokens to any address' },
  ];

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* Header with Privacy Status */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Privacy Actions</h2>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            <span className="text-green-400 text-sm font-medium">Privacy Ready</span>
          </div>
        </div>
        
        {/* Privacy Explanation */}
        <div className="bg-gray-700 rounded-lg p-4 mb-4">
          <h3 className="text-white font-medium mb-2">🔐 How Private Transactions Work</h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            <strong>Private Transactions:</strong> Your public tokens are automatically shielded (made private) and then transferred to the recipient in one secure operation.<br/>
            <strong>To Railgun Address:</strong> Completely private transfer (hidden → hidden)<br/>
            <strong>To EOA Address:</strong> Private shield then public transfer (visible → hidden → visible) with 1% fee
          </p>
          <div className="mt-3 p-3 bg-gray-600 rounded border-l-4 border-purple-500">
            <p className="text-gray-200 text-xs">
              <strong>Your Railgun Address:</strong> 
              <span className="font-mono ml-1" title="This is your private address. Share it with others to receive private transfers.">
                {railgunAddress}
              </span>
            </p>
          </div>
        </div>
      </div>

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
        {/* Send Privately Tab */}
        {activeTab === 'send' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Send Privately</h3>
              <p className="text-gray-300 text-sm mb-4">
                Send your public tokens privately to any address. Tokens will be automatically shielded and transferred in one transaction.
              </p>
            </div>

            <div className="space-y-4">
              {/* Recipient Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  To <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="0zk... (Railgun) or 0x... (Ethereum)"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  className={`w-full bg-gray-700 text-white rounded-lg px-4 py-3 border focus:outline-none ${
                    recipientAddress.trim() === '' 
                      ? 'border-gray-600 focus:border-purple-500'
                      : addressValidation.isValid 
                        ? 'border-green-500 focus:border-green-400' 
                        : 'border-red-500 focus:border-red-400'
                  }`}
                />
                
                {/* Address Validation Feedback */}
                {recipientAddress.trim() !== '' && (
                  <div className={`mt-2 p-3 rounded-lg border ${
                    addressValidation.isValid 
                      ? addressValidation.type === 'railgun'
                        ? 'bg-purple-900/30 border-purple-600/50 text-purple-200'
                        : 'bg-yellow-900/30 border-yellow-600/50 text-yellow-200'
                      : 'bg-red-900/30 border-red-600/50 text-red-200'
                  }`}>
                    <div className="flex items-start space-x-2">
                      <div className="flex-shrink-0 mt-0.5">
                        {addressValidation.isValid ? (
                          addressValidation.type === 'railgun' ? (
                            <ShieldCheckIcon className="h-4 w-4" />
                          ) : (
                            <ArrowUpIcon className="h-4 w-4" />
                          )
                        ) : (
                          <ExclamationTriangleIcon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {addressValidation.type === 'railgun' ? 'Railgun Address Detected' :
                           addressValidation.type === 'eoa' ? 'Ethereum Address Detected' :
                           'Invalid Address'}
                        </p>
                        <p className="text-xs mt-1 opacity-90">
                          {addressValidation.message}
                        </p>
                        {addressValidation.isValid && addressValidation.type === 'eoa' && (
                          <p className="text-xs mt-2 font-medium">
                            💰 Platform fee: 1% will be deducted and sent to our fee wallet
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Token Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Token <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedToken?.symbol || ''}
                  onChange={(e) => {
                    const token = Object.values(publicBalances).find(t => t.symbol === e.target.value);
                    setSelectedToken(token);
                  }}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Select token</option>
                  {Object.values(publicBalances)
                    .filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId))
                    .map((token) => (
                    <option key={token.symbol} value={token.symbol}>
                      {token.symbol} (Balance: {token.formattedBalance})
                    </option>
                  ))}
                </select>
                {Object.values(publicBalances).filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)).length === 0 && (
                  <p className="text-yellow-400 text-xs mt-1">
                    No supported public tokens with balance available.
                  </p>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount <span className="text-red-400">*</span>
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    placeholder="0.0"
                    step="any"
                    min="0"
                    max={selectedToken?.numericBalance || 0}
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (selectedToken?.numericBalance) {
                        setSendAmount(selectedToken.numericBalance.toString());
                      }
                    }}
                    disabled={!selectedToken?.numericBalance}
                    className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white px-3 py-3 rounded-lg text-sm transition-colors"
                    title="Set maximum amount"
                  >
                    Max
                  </button>
                </div>
                {selectedToken && (
                  <p className="text-gray-400 text-xs mt-1">
                    Available: {selectedToken.formattedBalance} {selectedToken.symbol}
                  </p>
                )}
              </div>

              {/* Memo (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Memo (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Optional message"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Send Privately Button */}
              <button
                onClick={handleSendPrivately}
                disabled={!isFormValid || isProcessing}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  isFormValid
                    ? addressValidation.type === 'eoa'
                      ? 'bg-yellow-600 hover:bg-yellow-700'
                      : 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-gray-600 cursor-not-allowed'
                } text-white`}
              >
                {isProcessing ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>
                      {addressValidation.type === 'eoa' ? 'Processing Private Transaction...' : 'Processing Private Transfer...'}
                    </span>
                  </div>
                ) : !isFormValid ? (
                  'Fill All Required Fields'
                ) : (
                  addressValidation.type === 'railgun' ? 'Send Private Transaction' : 'Send Private Transaction (1% Fee)'
                )}
              </button>

              {/* Form Validation Summary */}
              {!isFormValid && (recipientAddress || selectedToken || sendAmount) && (
                <div className="bg-gray-700 rounded-lg p-3 border border-gray-600">
                  <h4 className="text-white text-sm font-medium mb-2">Required Fields:</h4>
                  <ul className="text-xs text-gray-300 space-y-1">
                    <li className={addressValidation.isValid ? 'text-green-400' : 'text-red-400'}>
                      ✓ Valid recipient address {!addressValidation.isValid && '(missing)'}
                    </li>
                    <li className={selectedToken ? 'text-green-400' : 'text-red-400'}>
                      ✓ Token selection {!selectedToken && '(missing)'}
                    </li>
                    <li className={sendAmount && parseFloat(sendAmount) > 0 ? 'text-green-400' : 'text-red-400'}>
                      ✓ Valid amount {(!sendAmount || parseFloat(sendAmount) <= 0) && '(missing)'}
                    </li>
                    {selectedToken && sendAmount && parseFloat(sendAmount) > (selectedToken.numericBalance || 0) && (
                      <li className="text-red-400">
                        ✗ Amount exceeds balance
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrivacyActions; 