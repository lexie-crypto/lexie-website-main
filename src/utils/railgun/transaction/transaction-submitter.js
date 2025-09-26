/**
 * Transaction Submission Utilities
 * Handles transaction formatting and submission for RAILGUN transactions
 */

/**
 * Submit transaction via self-signing
 * @param {object} populatedTransaction - The populated RAILGUN transaction
 * @param {Function} walletProvider - Wallet provider function
 * @returns {string} Transaction hash
 */
export const submitTransactionSelfSigned = async (populatedTransaction, walletProvider) => {
  try {
    const walletSigner = await walletProvider();

    // Format transaction for self-signing
    const txForSending = {
      ...populatedTransaction.transaction,
      gasLimit: populatedTransaction.transaction.gasLimit ? '0x' + populatedTransaction.transaction.gasLimit.toString(16) : undefined,
      gasPrice: populatedTransaction.transaction.gasPrice ? '0x' + populatedTransaction.transaction.gasPrice.toString(16) : undefined,
      maxFeePerGas: populatedTransaction.transaction.maxFeePerGas ? '0x' + populatedTransaction.transaction.maxFeePerGas.toString(16) : undefined,
      maxPriorityFeePerGas: populatedTransaction.transaction.maxPriorityFeePerGas ? '0x' + populatedTransaction.transaction.maxPriorityFeePerGas.toString(16) : undefined,
      value: populatedTransaction.transaction.value ? '0x' + populatedTransaction.transaction.value.toString(16) : '0x0',
    };

    // EIP-1559 compatibility
    if (!txForSending.gasPrice && txForSending.maxFeePerGas) {
      txForSending.gasPrice = txForSending.maxFeePerGas;
    }

    // Clean up undefined values
    Object.keys(txForSending).forEach(key => {
      if (txForSending[key] === undefined) {
        delete txForSending[key];
      }
    });

    console.log('🔄 [UNSHIELD] Self-signing transaction...', {
      to: txForSending.to,
      gasLimit: txForSending.gasLimit,
      hasData: !!txForSending.data,
    });

    // Validate required fields
    if (!txForSending.to || !txForSending.data || !txForSending.gasLimit) {
      throw new Error('Transaction missing required fields');
    }

    const txResponse = await walletSigner.sendTransaction(txForSending);
    const finalTxHash = txResponse.hash || txResponse;

    console.log('✅ [UNSHIELD] Self-signed transaction sent:', finalTxHash);
    return finalTxHash;

  } catch (error) {
    console.error('❌ [UNSHIELD] Self-signing failed:', error.message);
    throw new Error(`Self-signing failed: ${error.message}`);
  }
};
