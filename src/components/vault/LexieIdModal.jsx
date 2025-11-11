import React, { useState } from 'react';

const LexieIdModal = ({
  isOpen,
  address,
  railgunAddress,
  onLexieIdLinked,
  onClose
}) => {
  const [lexieIdInput, setLexieIdInput] = useState('');
  const [lexieLinking, setLexieLinking] = useState(false);
  const [lexieCode, setLexieCode] = useState('');
  const [lexieNeedsCode, setLexieNeedsCode] = useState(false);
  const [lexieMessage, setLexieMessage] = useState('');

  const handleLexieIdLink = (lexieId, autoOpenGame = false) => {
    // This logic was in the parent component, but we need to pass it up
    onLexieIdLinked(lexieId, autoOpenGame);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[99] p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-4xl w-full overflow-hidden scrollbar-none">
        {/* Modal Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">lexie-id-setup</span>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6 text-green-300 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-emerald-300 mb-2">Setup Your LexieID</h3>
            <p className="text-green-400/80 text-sm">
             Grab a LexieID for easy P2P vault transfers.
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-black/40 border border-green-500/20 rounded p-3">
              <div className="text-green-400/80 text-xs mb-2">Create a new LexieID:</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={lexieIdInput}
                    onChange={(e) => setLexieIdInput(e.target.value)}
                    placeholder="e.g. LexieLaine123"
                    className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none flex-1"
                    disabled={lexieLinking}
                  />
                  {!lexieNeedsCode ? (
                    <button
                      onClick={async () => {
                        try {
                          setLexieMessage('');
                          setLexieLinking(true);
                          const chosen = (lexieIdInput || '').trim().toLowerCase();
                          if (!chosen || chosen.length < 3 || chosen.length > 15) {
                            setLexieMessage('Please enter a valid Lexie ID (3-15 chars).');
                            setLexieLinking(false);
                            return;
                          }
                          // Check status
                          const statusResp = await fetch(`/api/wallet-metadata?action=lexie-status&lexieID=${encodeURIComponent(chosen)}`, { method: 'GET' });
                          if (!statusResp.ok) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                          const statusJson = await statusResp.json();
                          if (!statusJson.success) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                          const exists = !!statusJson.exists; const linked = !!statusJson.linked; const owner = statusJson.owner;

                          if (exists && linked) {
                            setLexieMessage('This Lexie ID is already taken. Please try another one.');
                            setLexieLinking(false);
                            return;
                          }

                          if (!exists) {
                            // Lexie ID doesn't exist - claim it directly
                            // First, get the railgunAddress from wallet metadata in Redis
                            const walletMetadataResp = await fetch(`/api/wallet-metadata?walletAddress=${address}`);
                            if (!walletMetadataResp.ok) {
                              setLexieMessage('Failed to fetch wallet metadata.');
                              setLexieLinking(false);
                              return;
                            }
                            const walletMetadata = await walletMetadataResp.json();
                            if (!walletMetadata.success || !walletMetadata.keys || walletMetadata.keys.length === 0) {
                              setLexieMessage('No wallet metadata found.');
                              setLexieLinking(false);
                              return;
                            }

                            // Get the railgunAddress from the first (most recent) wallet metadata entry
                            const railgunAddressFromMetadata = walletMetadata.keys[0].railgunAddress;
                            if (!railgunAddressFromMetadata) {
                              setLexieMessage('Railgun address not found in wallet metadata.');
                              setLexieLinking(false);
                              return;
                            }

                            const claimResp = await fetch('/api/wallet-metadata?action=lexie-claim', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ lexieID: chosen, eoaAddress: address, railgunAddress: railgunAddressFromMetadata })
                            });
                            const claimJson = await claimResp.json().catch(() => ({}));
                            if (!claimResp.ok || !claimJson.success) {
                              setLexieMessage(claimJson.error || 'Failed to claim Lexie ID.');
                              setLexieLinking(false);
                              return;
                            }
                            setLexieNeedsCode(false); setLexieCode('');
                            setLexieMessage('✅ Successfully claimed and linked your Lexie ID!');
                            handleLexieIdLink(chosen, false); // Auto-open game disabled for initial release
                            setTimeout(() => {
                              onClose();
                              setLexieIdInput('');
                              setLexieMessage('');
                            }, 2000);
                            setLexieLinking(false);
                            return;
                          }

                          // Lexie ID exists but is not linked - user can link it (proves ownership via Telegram code)
                          const startResp = await fetch('/api/wallet-metadata?action=lexie-link-start', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ lexieID: chosen, railgunAddress })
                          });
                          const startJson = await startResp.json().catch(() => ({}));
                          if (startResp.status === 404) { setLexieMessage('Lexie ID not found.'); setLexieLinking(false); return; }
                          if (!startResp.ok || !startJson.success) { setLexieMessage('Failed to start verification.'); setLexieLinking(false); return; }
                          setLexieNeedsCode(true); setLexieMessage('We sent a 4‑digit code to your Telegram. Enter it below to confirm.');
                        } catch (_) { setLexieMessage('Unexpected error starting Lexie link.'); } finally { setLexieLinking(false); }
                      }}
                      disabled={lexieLinking || !lexieIdInput}
                      className="bg-emerald-600/30 hover:bg-emerald-600/50 disabled:bg-black/40 text-emerald-200 px-3 py-1 rounded text-sm border border-emerald-400/40"
                    >
                      {lexieLinking ? 'Working...' : 'Add'}
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={lexieCode}
                        onChange={(e) => setLexieCode(e.target.value)}
                        placeholder="4-digit code"
                        className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none w-20"
                        disabled={lexieLinking}
                      />
                      <button
                        onClick={async () => {
                          try {
                            setLexieLinking(true); setLexieMessage('');
                            const chosen = (lexieIdInput || '').trim().toLowerCase();
                            const verifyResp = await fetch('/api/wallet-metadata?action=lexie-link-verify', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ lexieID: chosen, code: (lexieCode || '').trim() })
                            });
                            const json = await verifyResp.json().catch(() => ({}));
                            if (!verifyResp.ok || !json.success) { setLexieMessage('Verification failed. Check the code and try again.'); return; }
                            setLexieNeedsCode(false); setLexieCode(''); setLexieMessage('✅ Linked successfully to your Railgun wallet.');
                            handleLexieIdLink(chosen, false); // Auto-open game disabled for initial release
                            setTimeout(() => {
                              onClose();
                              setLexieIdInput('');
                              setLexieMessage('');
                            }, 2000);
                          } catch (_) { setLexieMessage('Unexpected verification error.'); } finally { setLexieLinking(false); }
                        }}
                        disabled={lexieLinking || !lexieCode}
                        className="bg-green-600/30 hover:bg-green-600/50 disabled:bg-black/40 text-green-200 px-2 py-1 rounded text-sm border border-green-400/40"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => { setLexieNeedsCode(false); setLexieCode(''); setLexieMessage(''); }}
                        className="bg-gray-600/30 hover:bg-gray-500/30 text-gray-300 px-2 py-1 rounded text-sm border border-gray-500/40"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                {lexieMessage && <div className="mt-2 text-xs text-green-300/80">{lexieMessage}</div>}
              </div>

              {/* Instructions */}
              <div className="bg-purple-900/20 border border-purple-500/40 rounded p-3">
                <div className="text-purple-300 text-xs font-medium mb-2">How it works:</div>
                <p className="text-purple-200/80 text-xs mb-3">
                  Enter any available LexieID above and we'll claim it for you instantly. If it's already taken, try another one!
                </p>
                <div className="text-purple-300/60 text-xs">
                💡 Tip: Already have a LexieID? Enter it above to link it to your vault.
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default LexieIdModal;
