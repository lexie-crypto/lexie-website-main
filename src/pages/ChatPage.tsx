import React from 'react';
import '../styles/globals.css';
import { LexieChat } from '../components/chat/LexieChat';

const ChatPage = () => {
  // Scrollbar styling is applied via CSS classes on containers

  return (
    <div className="min-h-screen bg-black text-white scrollbar-terminal">
      <LexieChat />
    </div>
  );
};

export default ChatPage;
