import React from 'react';
import ChatPage from '../pages/ChatPage.tsx';

// Mobile Chat Modal Component
const MobileChat = ({ isOpen, onClose, lexieId, walletAddress }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-60 w-10 h-10 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-white font-bold text-lg"
        aria-label="Close chat"
      >
        ×
      </button>

      {/* Chat content */}
      <div className="w-full h-full">
        <ChatPage />
      </div>
    </div>
  );
};

export default MobileChat;
