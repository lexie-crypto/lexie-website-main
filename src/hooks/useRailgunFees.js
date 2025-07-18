/**
 * useRailgunFees Hook
 * Provides access to Railgun network fees for displaying to users
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import railgunEngine from '../utils/railgun/engine.js';

const useRailgunFees = () => {
  const { chainId, canUseRailgun } = useWallet();
  const [fees, setFees] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Convert chain ID to network name
  const getNetworkName = useCallback((chainId) => {
    switch (chainId) {
      case 1: return 'Ethereum';
      case 137: return 'Polygon';
      case 42161: return 'Arbitrum';
      case 56: return 'BNBChain';
      default: return null;
    }
  }, []);

  // Parse fees from hex to percentage
  const parseFeeFromHex = useCallback((hexValue) => {
    if (!hexValue) return 0;
    try {
      const basisPoints = parseInt(hexValue, 16);
      return basisPoints / 100; // Convert basis points to percentage
    } catch (error) {
      console.error('Error parsing fee hex value:', error);
      return 0;
    }
  }, []);

  // Get formatted fee information
  const getFormattedFees = useCallback((feesSerialized) => {
    if (!feesSerialized) return null;

    return {
      deposit: {
        basisPoints: parseFeeFromHex(feesSerialized.deposit),
        percentage: (parseFeeFromHex(feesSerialized.deposit) / 100).toFixed(2) + '%',
        description: 'Shielding fee'
      },
      withdraw: {
        basisPoints: parseFeeFromHex(feesSerialized.withdraw),
        percentage: (parseFeeFromHex(feesSerialized.withdraw) / 100).toFixed(2) + '%',
        description: 'Unshielding fee'
      },
      nft: {
        basisPoints: parseFeeFromHex(feesSerialized.nft),
        percentage: (parseFeeFromHex(feesSerialized.nft) / 100).toFixed(2) + '%',
        description: 'NFT transaction fee'
      }
    };
  }, [parseFeeFromHex]);

  // Load fees for current network
  const loadCurrentNetworkFees = useCallback(async () => {
    if (!canUseRailgun || !chainId) {
      setFees(null);
      return;
    }

    const networkName = getNetworkName(chainId);
    if (!networkName) {
      setFees(null);
      return;
    }

    setIsLoading(true);
    
    try {
      // Get fees from the engine
      const feesSerialized = railgunEngine.getFees(networkName);
      
      if (feesSerialized) {
        const formattedFees = getFormattedFees(feesSerialized);
        setFees({
          networkName,
          raw: feesSerialized,
          formatted: formattedFees
        });
        console.log(`[useRailgunFees] Loaded fees for ${networkName}:`, formattedFees);
      } else {
        console.warn(`[useRailgunFees] No fees found for ${networkName}`);
        setFees(null);
      }
    } catch (error) {
      console.error('[useRailgunFees] Error loading fees:', error);
      setFees(null);
    } finally {
      setIsLoading(false);
    }
  }, [canUseRailgun, chainId, getNetworkName, getFormattedFees]);

  // Load fees when network changes
  useEffect(() => {
    loadCurrentNetworkFees();
  }, [loadCurrentNetworkFees]);

  // Get fee for specific operation
  const getFeeForOperation = useCallback((operation) => {
    if (!fees || !fees.formatted) return null;
    
    switch (operation) {
      case 'shield':
      case 'deposit':
        return fees.formatted.deposit;
      case 'unshield':
      case 'withdraw':
        return fees.formatted.withdraw;
      case 'nft':
        return fees.formatted.nft;
      default:
        return null;
    }
  }, [fees]);

  // Calculate fee amount for a given token amount
  const calculateFeeAmount = useCallback((tokenAmount, operation) => {
    const feeInfo = getFeeForOperation(operation);
    if (!feeInfo || !tokenAmount) return '0';

    try {
      const amount = parseFloat(tokenAmount);
      const feePercentage = feeInfo.basisPoints / 10000; // Convert basis points to decimal
      const feeAmount = amount * feePercentage;
      return feeAmount.toFixed(6);
    } catch (error) {
      console.error('Error calculating fee amount:', error);
      return '0';
    }
  }, [getFeeForOperation]);

  return {
    fees,
    isLoading,
    getFeeForOperation,
    calculateFeeAmount,
    refreshFees: loadCurrentNetworkFees,
  };
};

export default useRailgunFees; 