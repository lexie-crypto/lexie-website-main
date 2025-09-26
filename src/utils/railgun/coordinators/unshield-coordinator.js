/**
 * Unshield Transaction Coordinator
 * Orchestrates the complete unshield transaction flow
 */

import { toast } from 'react-hot-toast';
import { assertNotSanctioned } from '../../sanctions/chainalysis-oracle.js';
import { showTerminalToast } from '../ui/terminal-toast.js';
import { resolveRecipient } from '../transaction/recipient-resolver.js';
import { refreshWalletBalances } from '../transaction/transaction-prep.js';
import { executeBaseTokenUnshield } from '../flows/unshield-base-token.js';

/**
 * Execute complete unshield transaction flow
 * @param {object} params - Unshield parameters
 * @returns {object} Transaction result
 */
export const executeUnshieldTransaction = async ({
  railgunWalletID,
  encryptionKey,
  tokenAddress,
  amount,
  chain,
  recipientAddress,
  toAddress,
  walletProvider,
  walletAddress,
  decimals,
}) => {
  console.log('🚀 [UNSHIELD] Starting unshield transaction...', {
    railgunWalletID: railgunWalletID?.substring(0, 10) + '...',
    tokenAddress: tokenAddress?.substring(0, 10) + '...',
    amount,
    recipientParam: (recipientAddress ?? toAddress)?.substring?.(0, 10) + '...',
    chainId: chain.id,
    decimals,
  });

  // Track transient toasts to close them when the step completes
  let submittingToast = null;

  try {
    // Notify user that signing will be required
    const startToast = showTerminalToast('info', 'Preparing to remove funds from your vault', { duration: 4000 });

    // Validate required parameters (preliminary)
    if (!encryptionKey || !railgunWalletID || !amount || !walletAddress) {
      throw new Error('Missing required parameters');
    }

    // Resolve recipient once (ENS -> 0x or direct 0x)
    const recipientInput = recipientAddress ?? toAddress;
    const recipientEVM = await resolveRecipient(recipientInput, walletProvider);
    if (!recipientEVM) {
      throw new Error('Unshield requires a valid 0x recipient address');
    }
    const { ethers } = await import('ethers');
    if (!recipientEVM.startsWith('0x') || !ethers.isAddress(recipientEVM)) {
      throw new Error('Unshield requires a valid 0x recipient address');
    }

    // Sanctions screening on resolved recipient address (EOA)
    console.log('[Sanctions] Starting screening for resolved recipient (unshield):', {
      chainId: chain.id,
      resolved: recipientEVM?.slice?.(0, 12) + '...'
    });
    await assertNotSanctioned(chain.id, recipientEVM);
    console.log('[Sanctions] Screening passed for resolved recipient (unshield)');

    console.log('✅ [UNSHIELD] Resolved recipient:', { recipientEVM });
    try { toast.dismiss(startToast); } catch {}

    if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.length < 10) {
      throw new Error(`Invalid tokenAddress: "${tokenAddress}"`);
    }

    // STEP 1: Balance refresh and network scanning
    console.log('🔄 [UNSHIELD] Step 1: Refreshing balances and scanning network...');

    try {
      await refreshWalletBalances(railgunWalletID, chain.id);
    } catch (refreshError) {
      console.warn('⚠️ [UNSHIELD] Balance refresh failed:', refreshError.message);
    }

    // Determine transaction type and route to appropriate handler
    const isBaseToken = !tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000';
    const userAmountGross = BigInt(amount);

    if (isBaseToken) {
      // Handle base token unshielding (wETH unwrap)
      return await executeBaseTokenUnshield({
        railgunWalletID,
        encryptionKey,
        tokenAddress,
        amount,
        chain,
        recipientAddress: recipientEVM,
        walletProvider,
        walletAddress,
        userAmountGross
      });
    } else {
      // TODO: Handle ERC-20 unshielding via separate flow
      throw new Error('ERC-20 unshielding not yet implemented in refactored coordinator');
    }

  } catch (error) {
    console.error('💥 [UNSHIELD] Transaction failed:', {
      error: error.message,
      stack: error.stack,
    });
    // Normalize user reject
    if ((error?.message || '').toLowerCase().includes('rejected') || (error?.message || '').toLowerCase().includes('reject') || error?.code === 4001 || error?.code === 5000) {
      showTerminalToast('error', 'Rejected by User');
      throw new Error('Rejected by User');
    }

    // Decode CallError for better debugging
    try {
      if (error.data && typeof error.data === 'string') {
        const errorData = error.data;

        // Check for standard Error(string) revert (0x08c379a0)
        if (errorData.startsWith('0x08c379a0')) {
          const { ethers } = await import('ethers');
          try {
            const decodedError = ethers.AbiCoder.defaultAbiCoder().decode(
              ['string'],
              '0x' + errorData.slice(10) // Remove 0x08c379a0
            );
            console.error('🔍 [UNSHIELD] Decoded revert reason:', decodedError[0]);

            // Check for specific ERC20 errors
            if (decodedError[0].includes('transfer amount exceeds balance')) {
              console.error('⚠️ [UNSHIELD] RelayAdapt balance insufficient - check amount calculation!');
              console.error('💡 [UNSHIELD] Verify: unshieldAmount == transferAmount (no overshoot)');
            }
            if (decodedError[0].includes('insufficient allowance')) {
              console.error('⚠️ [UNSHIELD] ERC20 allowance issue - check token approval');
            }
          } catch (decodeError) {
            console.error('🔍 [UNSHIELD] Failed to decode error:', decodeError);
          }
        } else {
          console.error('🔍 [UNSHIELD] Raw error data:', errorData);
        }
      }
    } catch (decodeError) {
      console.error('🔍 [UNSHIELD] Error decoding failed:', decodeError);
    }

    throw error;
  }
};
