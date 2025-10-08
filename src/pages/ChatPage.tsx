import React from 'react';
import '../styles/globals.css';
import { LexieChat } from '../components/chat/LexieChat';

const ChatPage = () => {
  // Detect if running in an iframe
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  return (
    <div className={`${isInIframe ? 'h-screen' : 'min-h-screen'} bg-black text-white ${isInIframe ? '' : 'scrollbar-terminal'}`}>
      <LexieChat />
    </div>
  );
};

export default ChatPage;
