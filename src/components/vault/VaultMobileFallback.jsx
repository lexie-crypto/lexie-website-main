import { useEffect } from 'react';

const VaultMobileFallback = () => {
  useEffect(() => {
    // Redirect to Telegram bot
    window.location.href = 'https://t.me/lexie_crypto_bot';
  }, []);

  // Show loading message while redirecting
  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden flex items-center justify-center scrollbar-none">
      <div className="text-center font-mono text-green-300">
        <div className="text-lg mb-4">Redirecting to Lexie Crypto Bot...</div>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto"></div>
      </div>
    </div>
  );
};

export default VaultMobileFallback;


