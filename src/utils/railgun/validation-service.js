/**
 * RAILGUN Validation Service
 * Provides comprehensive validation utilities for RAILGUN operations
 * Based on official RAILGUN SDK patterns
 */

import {
  NetworkName,
  TXIDVersion,
  EVMGasType,
  isDefined,
} from '@railgun-community/shared-models';
import {
  validateRailgunAddress,
  getRailgunAddress,
} from '@railgun-community/wallet';
import { isAddress, getAddress } from 'ethers';

/**
 * Validation result structure
 */
export const createValidationResult = (isValid, error = null, details = {}) => ({
  isValid,
  error,
  details,
});

/**
 * Validate Ethereum address
 * @param {string} address - Address to validate
 * @param {boolean} requireChecksum - Whether to require checksum format
 * @returns {Object} Validation result
 */
export const validateEthereumAddress = (address, requireChecksum = false) => {
  try {
    if (!address || typeof address !== 'string') {
      return createValidationResult(false, 'Address must be a non-empty string');
    }

    if (!isAddress(address)) {
      return createValidationResult(false, 'Invalid Ethereum address format');
    }

    if (requireChecksum) {
      const checksumAddress = getAddress(address);
      if (address !== checksumAddress) {
        return createValidationResult(false, 'Address must be in checksum format', {
          provided: address,
          expected: checksumAddress,
        });
      }
    }

    return createValidationResult(true, null, {
      address: getAddress(address),
      isChecksum: address === getAddress(address),
    });

  } catch (error) {
    return createValidationResult(false, `Address validation failed: ${error.message}`);
  }
};

/**
 * Validate RAILGUN address
 * @param {string} address - RAILGUN address to validate
 * @returns {Object} Validation result
 */
export const validateRailgunAddressFormat = (address) => {
  try {
    if (!address || typeof address !== 'string') {
      return createValidationResult(false, 'RAILGUN address must be a non-empty string');
    }

    if (!address.startsWith('0zk')) {
      return createValidationResult(false, 'RAILGUN address must start with "0zk"');
    }

    if (address.length < 100) {
      return createValidationResult(false, 'RAILGUN address is too short');
    }

    // Use official validation if available
    try {
      const isValid = validateRailgunAddress(address);
      if (!isValid) {
        return createValidationResult(false, 'Invalid RAILGUN address format');
      }
    } catch (error) {
      // Fallback validation
      if (!/^0zk[0-9a-f]+$/i.test(address)) {
        return createValidationResult(false, 'RAILGUN address contains invalid characters');
      }
    }

    return createValidationResult(true, null, {
      address,
      length: address.length,
    });

  } catch (error) {
    return createValidationResult(false, `RAILGUN address validation failed: ${error.message}`);
  }
};

/**
 * Validate token amount
 * @param {string|BigInt} amount - Amount to validate
 * @param {number} decimals - Token decimals
 * @param {BigInt} maxAmount - Maximum allowed amount (optional)
 * @returns {Object} Validation result
 */
export const validateTokenAmount = (amount, decimals = 18, maxAmount = null) => {
  try {
    if (!isDefined(amount)) {
      return createValidationResult(false, 'Amount is required');
    }

    let amountBigInt;

    // Convert to BigInt
    if (typeof amount === 'string') {
      if (amount.trim() === '' || amount === '0') {
        return createValidationResult(false, 'Amount must be greater than 0');
      }
      
      try {
        amountBigInt = BigInt(amount);
      } catch (error) {
        return createValidationResult(false, 'Invalid amount format');
      }
    } else if (typeof amount === 'bigint') {
      amountBigInt = amount;
    } else {
      return createValidationResult(false, 'Amount must be a string or BigInt');
    }

    // Check if positive
    if (amountBigInt <= 0n) {
      return createValidationResult(false, 'Amount must be greater than 0');
    }

    // Check maximum amount if provided
    if (maxAmount && amountBigInt > maxAmount) {
      return createValidationResult(false, 'Amount exceeds maximum allowed', {
        amount: amountBigInt.toString(),
        maxAmount: maxAmount.toString(),
      });
    }

    // Check reasonable decimals
    if (decimals < 0 || decimals > 77) {
      return createValidationResult(false, 'Invalid token decimals');
    }

    return createValidationResult(true, null, {
      amount: amountBigInt,
      decimals,
      amountString: amountBigInt.toString(),
    });

  } catch (error) {
    return createValidationResult(false, `Amount validation failed: ${error.message}`);
  }
};

/**
 * Validate network name
 * @param {string} networkName - Network name to validate
 * @returns {Object} Validation result
 */
export const validateNetworkName = (networkName) => {
  try {
    if (!networkName || typeof networkName !== 'string') {
      return createValidationResult(false, 'Network name must be a non-empty string');
    }

    if (!Object.values(NetworkName).includes(networkName)) {
      return createValidationResult(false, 'Unsupported network name', {
        provided: networkName,
        supported: Object.values(NetworkName),
      });
    }

    return createValidationResult(true, null, {
      networkName,
    });

  } catch (error) {
    return createValidationResult(false, `Network validation failed: ${error.message}`);
  }
};

/**
 * Validate chain ID and get corresponding network
 * @param {number} chainId - Chain ID to validate
 * @returns {Object} Validation result
 */
export const validateChainId = (chainId) => {
  try {
    if (!isDefined(chainId) || typeof chainId !== 'number') {
      return createValidationResult(false, 'Chain ID must be a number');
    }

    const supportedChains = {
      1: NetworkName.Ethereum,
      42161: NetworkName.Arbitrum,
      137: NetworkName.Polygon,
      56: NetworkName.BNBChain,
    };

    if (!supportedChains[chainId]) {
      return createValidationResult(false, 'Unsupported chain ID', {
        provided: chainId,
        supported: Object.keys(supportedChains).map(Number),
      });
    }

    return createValidationResult(true, null, {
      chainId,
      networkName: supportedChains[chainId],
    });

  } catch (error) {
    return createValidationResult(false, `Chain ID validation failed: ${error.message}`);
  }
};

/**
 * Validate TXID version
 * @param {string} txidVersion - TXID version to validate
 * @returns {Object} Validation result
 */
export const validateTXIDVersion = (txidVersion) => {
  try {
    if (!txidVersion || typeof txidVersion !== 'string') {
      return createValidationResult(false, 'TXID version must be a non-empty string');
    }

    if (!Object.values(TXIDVersion).includes(txidVersion)) {
      return createValidationResult(false, 'Unsupported TXID version', {
        provided: txidVersion,
        supported: Object.values(TXIDVersion),
      });
    }

    return createValidationResult(true, null, {
      txidVersion,
    });

  } catch (error) {
    return createValidationResult(false, `TXID version validation failed: ${error.message}`);
  }
};

/**
 * Validate EVM gas type
 * @param {string} evmGasType - EVM gas type to validate
 * @returns {Object} Validation result
 */
export const validateEVMGasType = (evmGasType) => {
  try {
    if (!evmGasType || typeof evmGasType !== 'string') {
      return createValidationResult(false, 'EVM gas type must be a non-empty string');
    }

    if (!Object.values(EVMGasType).includes(evmGasType)) {
      return createValidationResult(false, 'Unsupported EVM gas type', {
        provided: evmGasType,
        supported: Object.values(EVMGasType),
      });
    }

    return createValidationResult(true, null, {
      evmGasType,
    });

  } catch (error) {
    return createValidationResult(false, `EVM gas type validation failed: ${error.message}`);
  }
};

/**
 * Validate ERC20 amount recipient
 * @param {Object} recipient - ERC20 amount recipient object
 * @param {number} index - Index for error reporting
 * @returns {Object} Validation result
 */
export const validateERC20AmountRecipient = (recipient, index = 0) => {
  try {
    if (!recipient || typeof recipient !== 'object') {
      return createValidationResult(false, `Recipient ${index}: must be an object`);
    }

    // Validate token address (can be undefined for native token)
    if (recipient.tokenAddress !== undefined) {
      const addressValidation = validateEthereumAddress(recipient.tokenAddress);
      if (!addressValidation.isValid) {
        return createValidationResult(false, `Recipient ${index}: ${addressValidation.error}`);
      }
    }

    // Validate amount
    const amountValidation = validateTokenAmount(recipient.amount);
    if (!amountValidation.isValid) {
      return createValidationResult(false, `Recipient ${index}: ${amountValidation.error}`);
    }

    // Validate recipient address
    const recipientAddressValidation = validateRailgunAddressFormat(recipient.recipientAddress);
    if (!recipientAddressValidation.isValid) {
      return createValidationResult(false, `Recipient ${index}: ${recipientAddressValidation.error}`);
    }

    return createValidationResult(true, null, {
      index,
      tokenAddress: recipient.tokenAddress,
      amount: amountValidation.details.amount,
      recipientAddress: recipient.recipientAddress,
      isNativeToken: recipient.tokenAddress === undefined,
    });

  } catch (error) {
    return createValidationResult(false, `Recipient ${index} validation failed: ${error.message}`);
  }
};

/**
 * Validate array of ERC20 amount recipients
 * @param {Array} recipients - Array of recipients to validate
 * @returns {Object} Validation result
 */
export const validateERC20AmountRecipients = (recipients) => {
  try {
    if (!Array.isArray(recipients)) {
      return createValidationResult(false, 'Recipients must be an array');
    }

    if (recipients.length === 0) {
      return createValidationResult(false, 'At least one recipient is required');
    }

    const validatedRecipients = [];
    const errors = [];

    for (let i = 0; i < recipients.length; i++) {
      const validation = validateERC20AmountRecipient(recipients[i], i);
      if (validation.isValid) {
        validatedRecipients.push(validation.details);
      } else {
        errors.push(validation.error);
      }
    }

    if (errors.length > 0) {
      return createValidationResult(false, `Recipient validation errors: ${errors.join(', ')}`);
    }

    return createValidationResult(true, null, {
      recipients: validatedRecipients,
      count: validatedRecipients.length,
    });

  } catch (error) {
    return createValidationResult(false, `Recipients validation failed: ${error.message}`);
  }
};

/**
 * Validate wallet ID
 * @param {string} walletID - Wallet ID to validate
 * @returns {Object} Validation result
 */
export const validateWalletID = (walletID) => {
  try {
    if (!walletID || typeof walletID !== 'string') {
      return createValidationResult(false, 'Wallet ID must be a non-empty string');
    }

    if (walletID.length < 10) {
      return createValidationResult(false, 'Wallet ID is too short');
    }

    // Basic format validation (hex string)
    if (!/^[0-9a-f]+$/i.test(walletID)) {
      return createValidationResult(false, 'Wallet ID must be a valid hex string');
    }

    return createValidationResult(true, null, {
      walletID,
      length: walletID.length,
    });

  } catch (error) {
    return createValidationResult(false, `Wallet ID validation failed: ${error.message}`);
  }
};

/**
 * Validate encryption key
 * @param {string} encryptionKey - Encryption key to validate
 * @returns {Object} Validation result
 */
export const validateEncryptionKey = (encryptionKey) => {
  try {
    if (!encryptionKey || typeof encryptionKey !== 'string') {
      return createValidationResult(false, 'Encryption key must be a non-empty string');
    }

    if (encryptionKey.length < 32) {
      return createValidationResult(false, 'Encryption key is too short (minimum 32 characters)');
    }

    // Basic format validation (hex string)
    if (!/^[0-9a-f]+$/i.test(encryptionKey)) {
      return createValidationResult(false, 'Encryption key must be a valid hex string');
    }

    return createValidationResult(true, null, {
      encryptionKey,
      length: encryptionKey.length,
    });

  } catch (error) {
    return createValidationResult(false, `Encryption key validation failed: ${error.message}`);
  }
};

/**
 * Comprehensive validation for shield transaction parameters
 * @param {Object} params - Shield transaction parameters
 * @returns {Object} Validation result
 */
export const validateShieldTransactionParams = (params) => {
  try {
    const errors = [];
    const validatedParams = {};

    // Validate token address
    if (params.tokenAddress !== null && params.tokenAddress !== undefined) {
      const addressValidation = validateEthereumAddress(params.tokenAddress);
      if (!addressValidation.isValid) {
        errors.push(`Token address: ${addressValidation.error}`);
      } else {
        validatedParams.tokenAddress = addressValidation.details.address;
      }
    } else {
      validatedParams.tokenAddress = undefined; // Native token
    }

    // Validate amount
    const amountValidation = validateTokenAmount(params.amount);
    if (!amountValidation.isValid) {
      errors.push(`Amount: ${amountValidation.error}`);
    } else {
      validatedParams.amount = amountValidation.details.amountString;
    }

    // Validate chain
    if (!params.chain?.id) {
      errors.push('Chain: Chain object with id property is required');
    } else {
      const chainValidation = validateChainId(params.chain.id);
      if (!chainValidation.isValid) {
        errors.push(`Chain: ${chainValidation.error}`);
      } else {
        validatedParams.chain = params.chain;
        validatedParams.networkName = chainValidation.details.networkName;
      }
    }

    // Validate from address
    const fromAddressValidation = validateEthereumAddress(params.fromAddress);
    if (!fromAddressValidation.isValid) {
      errors.push(`From address: ${fromAddressValidation.error}`);
    } else {
      validatedParams.fromAddress = fromAddressValidation.details.address;
    }

    // Validate RAILGUN address
    const railgunAddressValidation = validateRailgunAddressFormat(params.railgunAddress);
    if (!railgunAddressValidation.isValid) {
      errors.push(`RAILGUN address: ${railgunAddressValidation.error}`);
    } else {
      validatedParams.railgunAddress = params.railgunAddress;
    }

    // Validate wallet provider (optional but recommended)
    if (!params.walletProvider) {
      errors.push('Wallet provider: Wallet provider is required for shield operations');
    } else {
      validatedParams.walletProvider = params.walletProvider;
    }

    if (errors.length > 0) {
      return createValidationResult(false, `Shield transaction validation errors: ${errors.join(', ')}`);
    }

    return createValidationResult(true, null, validatedParams);

  } catch (error) {
    return createValidationResult(false, `Shield transaction validation failed: ${error.message}`);
  }
};

export default {
  createValidationResult,
  validateEthereumAddress,
  validateRailgunAddressFormat,
  validateTokenAmount,
  validateNetworkName,
  validateChainId,
  validateTXIDVersion,
  validateEVMGasType,
  validateERC20AmountRecipient,
  validateERC20AmountRecipients,
  validateWalletID,
  validateEncryptionKey,
  validateShieldTransactionParams,
}; 