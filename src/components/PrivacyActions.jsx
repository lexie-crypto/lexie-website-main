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
  const [activeTab, setActiveTab] = useState('shield');
  const [isProcessing, setIsProcessing] = useState(false);
  const [shieldableTokens, setShieldableTokens] = useState([]);

  // Shield state
  const [selectedShieldToken, setSelectedShieldToken] = useState(null);
  const [shieldAmounts, setShieldAmounts] = useState({}); // Changed to per-token amounts

  // Transfer state
  const [recipientAddress, setRecipientAddress] = useState('');
  const [selectedTransferToken, setSelectedTransferToken] = useState(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMemo, setTransferMemo] = useState('');

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
      // Add numericBalance property for private tokens if missing
      const tokensWithNumericBalance = privateTokensArray.map(token => {
        if (!token.numericBalance && token.formattedBalance) {
          // Parse the formatted balance to get numeric value
          const numericValue = parseFloat(token.formattedBalance.replace(/,/g, '')) || 0;
          return { ...token, numericBalance: numericValue };
        }
        return token;
      });
      
      if (!selectedTransferToken) {
        const tokenWithBalance = tokensWithNumericBalance.find(t => (t.numericBalance || 0) > 0);
        setSelectedTransferToken(tokenWithBalance || tokensWithNumericBalance[0]);
      }
      if (!selectedUnshieldToken) {
        const tokenWithBalance = tokensWithNumericBalance.find(t => (t.numericBalance || 0) > 0);
        setSelectedUnshieldToken(tokenWithBalance || tokensWithNumericBalance[0]);
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
      
      // ✅ COMPREHENSIVE VALIDATION GUARDS (as requested)
      // Note: token.address can be null for native tokens (ETH, MATIC, etc.)
      if (!token || token.address === undefined || !token.symbol || !token.decimals) {
        toast.error('Invalid token data for shielding.');
        console.error('[PrivacyActions] Invalid token object:', token);
        return;
      }

      // Validate amount
      if (!amount || parseFloat(amount) <= 0 || isNaN(parseFloat(amount))) {
        toast.error('Please enter a valid amount');
        return;
      }

      // Validate token is supported
      if (!isTokenSupportedByRailgun(token.address, chainId)) {
        toast.error(`${token.symbol} is not supported by Railgun on this network`);
        return;
      }

      // Check sufficient balance
      const numericAmount = parseFloat(amount);
      const availableBalance = token.numericBalance || 0;
      
      if (numericAmount > availableBalance) {
        toast.error(`Insufficient balance. Available: ${token.formattedBalance} ${token.symbol}`);
        return;
      }

      // Parse amount to smallest units with comprehensive validation
      let amountInUnits;
      try {
        amountInUnits = parseTokenAmount(amount, token.decimals);
        
        // ✅ VALIDATE amountInUnits as requested
        if (!amountInUnits || isNaN(amountInUnits) || amountInUnits === '0') {
          toast.error('Invalid token or amount for shielding.');
          console.error('[PrivacyActions] Invalid amountInUnits:', {
            original: amount,
            parsed: amountInUnits,
            decimals: token.decimals
          });
          return;
        }
        
        // ✅ CONSOLE LOG as requested
        console.log('Amount in units:', amountInUnits);
        
      } catch (error) {
        toast.error('Failed to parse token amount. Please check your input.');
        console.error('[PrivacyActions] parseTokenAmount failed:', error);
        return;
      }

      // Validate required parameters before SDK call
      if (!railgunWalletId || !railgunAddress || !address || !chainId) {
        toast.error('Missing required wallet information for shielding.');
        console.error('[PrivacyActions] Missing required params:', {
          railgunWalletId: !!railgunWalletId,
          railgunAddress: !!railgunAddress,
          address: !!address,
          chainId: !!chainId
        });
        return;
      }

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };
      if (!chainConfig.type || !chainConfig.id) {
        toast.error('Invalid network configuration.');
        return;
      }

      // Get encryption key
      let key;
      try {
        key = await getEncryptionKey();
        if (!key || key.length < 32) {
          throw new Error('Invalid encryption key generated');
        }
      } catch (error) {
        toast.error('Failed to generate encryption key.');
        console.error('[PrivacyActions] Encryption key error:', error);
        return;
      }

      // ✅ FINAL GUARD BEFORE SDK CALL (as requested)  
      // Note: token.address can be null for native tokens
      if (!token || token.address === undefined || !amountInUnits || isNaN(amountInUnits)) {
        toast.error('Invalid token or amount for shielding.');
        console.error('[PrivacyActions] Final validation failed:', {
          hasToken: !!token,
          hasTokenAddress: token && token.address !== undefined,
          tokenAddress: token ? token.address : 'NO_TOKEN',
          isNativeToken: token && token.address === null,
          amountInUnits,
          isValidAmount: !isNaN(amountInUnits)
        });
        return;
      }

      // Execute shield operation with comprehensive logging
      console.log('[PrivacyActions] Starting shield operation with validated parameters:', {
        token: {
          symbol: token.symbol,
          address: token.address,
          decimals: token.decimals,
          hasAddress: !!token.address,
          addressType: typeof token.address,
          addressValue: token.address,
          fullTokenObject: token
        },
        amount: {
          original: amount,
          parsed: amountInUnits,
          numeric: numericAmount
        },
        addresses: {
          from: address,
          to: railgunAddress,
          railgunWalletId
        },
        chain: chainConfig
      });

      // ✅ SYMBOL VALIDATION BEFORE SHIELD CALL (Critical Fix)
      console.log('[PrivacyActions] Pre-shield Symbol validation:', {
        tokenAddress: {
          value: token.address,
          type: typeof token.address,
          isSymbol: typeof token.address === 'symbol',
          constructor: token.address?.constructor?.name
        },
        tokenSymbol: {
          value: token.symbol,
          type: typeof token.symbol,
          isSymbol: typeof token.symbol === 'symbol',
          constructor: token.symbol?.constructor?.name
        },
        amountInUnits: {
          value: amountInUnits,
          type: typeof amountInUnits,
          isSymbol: typeof amountInUnits === 'symbol',
          constructor: amountInUnits?.constructor?.name
        },
        railgunAddress: {
          value: railgunAddress ? `${railgunAddress.slice(0, 8)}...` : railgunAddress,
          type: typeof railgunAddress,
          isSymbol: typeof railgunAddress === 'symbol',
          constructor: railgunAddress?.constructor?.name
        }
      });

      // ✅ PREVENT SYMBOL OBJECTS FROM REACHING SHIELD FUNCTION
      if (typeof token.address === 'symbol') {
        console.error('[PrivacyActions] Token address is Symbol object:', token.address);
        toast.error(`Invalid token address (Symbol detected) for ${token.symbol}`);
        return;
      }

      if (typeof token.symbol === 'symbol') {
        console.error('[PrivacyActions] Token symbol is Symbol object:', token.symbol);
        toast.error('Invalid token symbol (Symbol detected)');
        return;
      }

      if (typeof amountInUnits === 'symbol') {
        console.error('[PrivacyActions] Amount is Symbol object:', amountInUnits);
        toast.error('Invalid amount (Symbol detected)');
        return;
      }

      if (typeof railgunAddress === 'symbol') {
        console.error('[PrivacyActions] Railgun address is Symbol object:', railgunAddress);
        toast.error('Invalid Railgun address (Symbol detected)');
        return;
      }

      // Double-check token address before shield call (allow null for native tokens)
      if (token.address === undefined) {
        console.error('[PrivacyActions] Token address is undefined:', token);
        toast.error(`Token ${token.symbol} has no valid address`);
        return;
      }
      
      // Log token type for debugging
      const tokenType = token.address === null ? 'NATIVE' : 'ERC20';
      console.log('[PrivacyActions] About to shield', tokenType, 'token:', token.symbol);
      
      toast.loading(`Shielding ${amount} ${token.symbol}...`, { duration: 0 });
      
      const result = await shieldTokens(
        railgunWalletId,
        key,
        token.address,
        amountInUnits,
        chainConfig,
        address,
        railgunAddress
      );

      toast.dismiss();
      toast.success(`✅ Successfully shielded ${amount} ${token.symbol}!`, { duration: 5000 });
      
      console.log('[PrivacyActions] Shield operation completed:', result);
      
      // Clear the amount for this specific token
      setShieldAmounts(prev => ({
        ...prev,
        [token.symbol]: ''
      }));
      
      // Only refresh balances on SUCCESS to avoid retry loops
      try {
        await refreshAllBalances();
      } catch (refreshError) {
        console.warn('[PrivacyActions] Balance refresh failed after shield:', refreshError);
        // Don't show error to user since shield succeeded
      }
      
    } catch (error) {
      console.error('[PrivacyActions] Shield failed:', error);
      toast.dismiss();
      toast.error(`❌ Shield failed: ${error.message}`, { duration: 8000 });
      
      // DO NOT REFRESH BALANCES ON ERROR - this causes infinite API calls!
      console.log('[PrivacyActions] Skipping balance refresh on error to prevent API token burn');
      
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, refreshAllBalances, getEncryptionKey, railgunAddress]);

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
        address,
        railgunAddress
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

  // Private transfer (handles both Railgun-to-Railgun and Railgun-to-EOA)
  const handlePrivateTransfer = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !selectedTransferToken) {
      toast.error('Railgun wallet not ready or no token selected');
      return;
    }

    try {
      setIsProcessing(true);
      
      // Validate address using auto-detection
      if (!addressValidation.isValid) {
        throw new Error(addressValidation.message);
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

      console.log('[PrivacyActions] Starting transfer:', {
        token: selectedTransferToken.symbol,
        amount: transferAmount,
        to: recipientAddress,
        addressType: addressValidation.type,
        memo: transferMemo || 'None'
      });

      let result;

      if (addressValidation.type === 'railgun') {
        // Railgun-to-Railgun private transfer
        toast.loading(`Sending ${transferAmount} ${selectedTransferToken.symbol} privately...`, { duration: 0 });
        
        result = await transferPrivate(
          railgunWalletId,
          key,
          recipientAddress,
          selectedTransferToken.address,
          amountInUnits,
          chainConfig,
          transferMemo
        );

        toast.dismiss();
        toast.success(`✅ Private transfer completed! ${transferAmount} ${selectedTransferToken.symbol} sent privately.`, { duration: 5000 });
        
      } else if (addressValidation.type === 'eoa') {
        // Railgun-to-EOA unshield transfer
        toast.loading(`Unshielding ${transferAmount} ${selectedTransferToken.symbol} to public wallet...`, { duration: 0 });
        
        result = await unshieldTokens(
          railgunWalletId,
          key,
          selectedTransferToken.address,
          amountInUnits,
          chainConfig,
          recipientAddress
        );

        toast.dismiss();
        
        // Show fee information in success message
        const feeAmount = result.feeAmount || '0';
        const feeInTokens = formatTokenAmount(feeAmount, selectedTransferToken.decimals);
        
        toast.success(
          `✅ Unshield completed! ${transferAmount} ${selectedTransferToken.symbol} sent to public wallet. Fee: ${feeInTokens} ${selectedTransferToken.symbol}`, 
          { duration: 8000 }
        );
      }
      
      console.log('[PrivacyActions] Transfer completed:', result);
      
      // Refresh balances
      await refreshAllBalances();
      
      // Clear form
      setTransferAmount('');
      setRecipientAddress('');
      setTransferMemo('');
      
    } catch (error) {
      console.error('[PrivacyActions] Transfer failed:', error);
      toast.dismiss();
      toast.error(`❌ Transfer failed: ${error.message}`, { duration: 8000 });
    } finally {
      setIsProcessing(false);
    }
  }, [canUseRailgun, railgunWalletId, selectedTransferToken, recipientAddress, transferAmount, transferMemo, chainId, network, refreshAllBalances, getEncryptionKey, addressValidation]);



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
    { id: 'shield', name: 'Shield', icon: ShieldCheckIcon, description: 'Convert public tokens to private' },
    { id: 'transfer', name: 'Send', icon: ArrowRightIcon, description: 'Send private tokens to Railgun addresses or public wallets' },
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
          <h3 className="text-white font-medium mb-2">🔐 How Privacy Works</h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            <strong>Shield:</strong> Move public tokens into private Railgun pools (visible → hidden)<br/>
            <strong>Send to Railgun:</strong> Send private tokens to other Railgun users (hidden → hidden)<br/>
            <strong>Send to EOA:</strong> Send private tokens to public wallets (hidden → visible) with 1% fee
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
        {/* Shield Tab */}
        {activeTab === 'shield' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Shield Tokens</h3>
              <p className="text-gray-300 text-sm mb-4">
                Convert your public tokens into private Railgun tokens for enhanced privacy.
              </p>
              
              {/* Fee Information */}
              <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <CurrencyDollarIcon className="h-4 w-4 text-blue-400" />
                  <span className="text-blue-300 text-sm font-medium">Transaction Fees</span>
                </div>
                <div className="text-sm text-gray-300 space-y-1">
                  <div className="flex justify-between">
                    <span>Platform Fee:</span>
                    <span className="text-yellow-300 font-medium">1.0%</span>
                  </div>
                  {railgunFees && !isFeesLoading && (
                    <div className="flex justify-between">
                      <span>Railgun Protocol Fee:</span>
                      <span className="text-blue-300">{railgunFees.formatted?.deposit?.percentage || '0.25%'}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-600 pt-1 mt-2">
                    <div className="flex justify-between font-medium">
                      <span>Total Fees:</span>
                      <span className="text-orange-300">
                        {railgunFees?.formatted?.deposit?.percentage ? 
                          `${(1.0 + parseFloat(railgunFees.formatted.deposit.percentage.replace('%', ''))).toFixed(2)}%` : 
                          '~1.25%'
                        }
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  Platform fees support development and operations
                </div>
              </div>
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
              
              {Object.values(publicBalances).filter(token => token.hasBalance).map((token) => (
                <div key={token.symbol} className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="bg-gray-600 rounded-full p-2">
                        <CurrencyDollarIcon className="h-5 w-5 text-gray-300" />
                      </div>
                      <div>
                        <div className="text-white font-medium">{token.symbol}</div>
                        <div className="text-gray-300 text-sm">
                          Balance: {token.formattedBalance} ${token.balanceUSD}
                        </div>
                        {!isTokenSupportedByRailgun(token.address, chainId) && (
                          <div className="text-yellow-400 text-xs">
                            ⚠️ Not supported by Railgun
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        placeholder="0.0"
                        step="any"
                        min="0"
                        max={token.numericBalance}
                        className="bg-gray-600 text-white rounded px-3 py-1 w-32 text-sm"
                        value={shieldAmounts[token.symbol] || ''}
                        onChange={(e) => {
                          setShieldAmounts(prev => ({
                            ...prev,
                            [token.symbol]: e.target.value
                          }));
                        }}
                        disabled={isProcessing || !token.hasBalance || !isTokenSupportedByRailgun(token.address, chainId)}
                      />
                      <button
                        onClick={() => {
                          const amount = shieldAmounts[token.symbol];
                          if (!amount || parseFloat(amount) <= 0) {
                            toast.error('Please enter a valid amount');
                            return;
                          }
                          handleShieldToken(token, amount);
                        }}
                        disabled={
                          isProcessing || 
                          !token.hasBalance || 
                          !shieldAmounts[token.symbol] || 
                          parseFloat(shieldAmounts[token.symbol] || '0') <= 0 ||
                          !isTokenSupportedByRailgun(token.address, chainId)
                        }
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
                      >
                        {isProcessing ? '...' : 'Shield'}
                      </button>
                      <button
                        onClick={() => {
                          setShieldAmounts(prev => ({
                            ...prev,
                            [token.symbol]: token.numericBalance.toString()
                          }));
                        }}
                        disabled={isProcessing || !token.hasBalance}
                        className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white px-2 py-1 rounded text-xs transition-colors"
                        title="Set maximum amount"
                      >
                        Max
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
              <h3 className="text-lg font-medium text-white mb-2">Send Tokens</h3>
              <p className="text-gray-300 text-sm mb-4">
                Send private tokens to a Railgun address (private) or regular wallet address (public).
              </p>
            </div>

            <div className="space-y-4">
              {/* Recipient Address */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Recipient Address
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
                        ? 'bg-purple-900 border-purple-600 text-purple-200'
                        : 'bg-yellow-900 border-yellow-600 text-yellow-200'
                      : 'bg-red-900 border-red-600 text-red-200'
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
                <div className="flex space-x-2">
                  <input
                    type="number"
                    placeholder="0.0"
                    step="any"
                    min="0"
                    max={selectedTransferToken?.numericBalance || 0}
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (selectedTransferToken?.numericBalance) {
                        setTransferAmount(selectedTransferToken.numericBalance.toString());
                      }
                    }}
                    disabled={!selectedTransferToken?.numericBalance}
                    className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white px-3 py-3 rounded-lg text-sm transition-colors"
                    title="Set maximum amount"
                  >
                    Max
                  </button>
                </div>
                {selectedTransferToken && (
                  <p className="text-gray-400 text-xs mt-1">
                    Available: {selectedTransferToken.formattedBalance} {selectedTransferToken.symbol}
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
                  value={transferMemo}
                  onChange={(e) => setTransferMemo(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-purple-500 focus:outline-none"
                />
              </div>

              {/* Transfer Button */}
              <button
                onClick={handlePrivateTransfer}
                disabled={isProcessing || !addressValidation.isValid || !selectedTransferToken || !transferAmount}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  addressValidation.isValid && addressValidation.type === 'eoa'
                    ? 'bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600'
                    : 'bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600'
                } text-white`}
              >
                {isProcessing ? (
                  addressValidation.type === 'eoa' ? 'Processing Unshield...' : 'Processing Transfer...'
                ) : addressValidation.isValid ? (
                  addressValidation.type === 'railgun' ? 'Send Private Transfer' : 'Unshield to Public Wallet'
                ) : 'Enter Valid Address'}
              </button>
            </div>
          </div>
        )}


      </div>
    </div>
  );
};

export default PrivacyActions; 