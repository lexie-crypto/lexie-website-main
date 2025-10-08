import React from 'react';
import '../styles/globals.css';
import { LexieChat } from '../components/chat/LexieChat';

const ChatPage = () => {
  return (
    <div className="min-h-screen bg-black text-white">
      <LexieChat />
    </div>
  );
};

export default ChatPage;
