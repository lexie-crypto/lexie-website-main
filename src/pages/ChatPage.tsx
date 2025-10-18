import React from 'react';
import '../styles/globals.css';
import { LexieChat } from '../components/chat/LexieChat';
import { Navbar } from '../components/Navbar.jsx';

const ChatPage = () => {
  // Detect if running in an iframe
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Detect mobile
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  return (
    <div className={`${isInIframe ? 'h-screen' : 'min-h-screen'} bg-black text-white ${isInIframe ? '' : 'scrollbar-terminal'}`}>
      {!isInIframe && isMobile && <Navbar onLexieChatOpen={() => {}} />}
      <div className={`${!isInIframe && isMobile ? '-mt-12' : ''}`}>
        <LexieChat />
      </div>
    </div>
  );
};

export default ChatPage;
