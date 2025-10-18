import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';

const CrossPlatformVerificationModal = ({
  isOpen,
  verificationCode = '',
  verificationLexieId = '',
  verificationTimeLeft = 0,
  onClose
}) => {
  const [timeLeft, setTimeLeft] = useState(verificationTimeLeft);

  // Update countdown timer for verification code
  useEffect(() => {
    if (!isOpen || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        const newTime = prev - 1;
        if (newTime <= 0) {
          onClose();
          return 0;
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, timeLeft, onClose]);

  // Reset timer when modal opens with new data
  useEffect(() => {
    if (isOpen && verificationTimeLeft > 0) {
      setTimeLeft(verificationTimeLeft);
    }
  }, [isOpen, verificationTimeLeft]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 font-mono">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden scrollbar-none">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-sm tracking-wide text-gray-400">telegram-link</span>
          </div>
          <button
            onClick={onClose}
            className="text-green-400/70 hover:text-green-300 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 text-green-300 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-emerald-300 mb-2">Link to Telegram</h3>
            <p className="text-green-400/80 text-sm">
              Your LexieID <span className="text-purple-300 font-mono">{verificationLexieId}</span> is being linked to Telegram.
            </p>
          </div>

          <div className="bg-black/40 border border-purple-500/20 rounded p-4">
            <div className="text-center space-y-3">
              <div className="text-purple-300 text-sm font-medium">Verification Code</div>
              <div className="text-3xl font-mono font-bold text-emerald-300 tracking-wider">
                {verificationCode}
              </div>
                  <div className="text-purple-300/60 text-xs">
                    Expires in {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                  </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(verificationCode);
                  toast.success('Code copied to clipboard');
                }}
                className="bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 px-3 py-1 rounded text-sm border border-purple-400/40 transition-colors"
              >
                Copy Code
              </button>
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-500/40 rounded p-3">
            <div className="text-blue-300 text-xs font-medium mb-1">Next Steps:</div>
            <div className="text-blue-200/80 text-xs space-y-1">
              <div>1. Switch to Telegram</div>
              <div>2. Enter this code when prompted</div>
              <div>3. Your LexieID will be linked across both platforms</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CrossPlatformVerificationModal;
