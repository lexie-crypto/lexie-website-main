import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { useChatStore } from '../../lib/store';
import { MenuIcon, XIcon } from 'lucide-react';
import { toast } from 'react-hot-toast';

const DegenModeButton = () => {
  const { personalityMode, setPersonalityMode } = useChatStore();
  const [isSending, setIsSending] = useState(false);

  console.log('🎯 DegenModeButton rendered with personalityMode:', personalityMode);

  const handleClick = async () => {
    console.log('🚀 DegenModeButton clicked! Current mode:', personalityMode);

    const newMode = personalityMode === 'degen' ? 'normal' : 'degen';
    console.log('🔄 Switching to mode:', newMode);

    setPersonalityMode(newMode);

    // If enabling degen mode, send confirmation message to chat
    if (newMode === 'degen') {
      console.log('📤 Sending degen confirmation message...');
      setIsSending(true);
      try {
        // Import ChatService and send confirmation message
        const { ChatService } = await import('../../lib/api');
        await ChatService.sendMessage(
          'Hey Lexie! I just enabled degen mode. Can you acknowledge this with your full degen personality?',
          { funMode: true }
        );
        console.log('✅ Degen confirmation message sent successfully');
      } catch (error) {
        console.error('❌ Error sending degen mode confirmation:', error);
        // Show user feedback on error
        toast.custom((t) => (
          <div className="font-mono pointer-events-auto">
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Failed to activate degen mode</div>
                  <div className="text-xs text-red-400/80">Try again or check your connection</div>
                </div>
              </div>
            </div>
          </div>
        ), { duration: 3000 });
      } finally {
        setIsSending(false);
      }
    } else {
      console.log('🔄 Switched back to normal mode');
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isSending}
      className={`px-3 py-1.5 rounded border text-xs ${
        personalityMode === 'degen'
          ? 'border-pink-400 text-pink-300'
          : 'border-green-400 text-green-300'
      } hover:bg-white/5 transition-colors ${
        isSending ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      title="Toggle Degen Mode"
    >
      {isSending
        ? 'Activating...'
        : personalityMode === 'degen'
          ? 'Disable Degen Mode'
          : 'Enable Degen Mode'
      }
    </button>
  );
};

export function LexieChat() {
  const { darkMode, createConversation } = useChatStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Detect if running in an iframe
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('cyberpunk-light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('cyberpunk-light');
    }
  }, [darkMode]);

  useEffect(() => {
    // Create initial conversation if none exists
    const conversations = useChatStore.getState().conversations;
    if (conversations.length === 0) {
      createConversation('Welcome');
    }
  }, [createConversation]);

  // If embedded in iframe, render just the core chat interface without headers
  if (isInIframe) {
    return (
      <div className="h-full w-full scrollbar-terminal bg-black">
        <div className="font-mono text-green-300 space-y-1 h-full flex flex-col md:min-h-0 md:min-w-0 md:px-8 md:pt-4 md:pb-6">
          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center justify-between pb-4 flex-shrink-0">
            <div>
              <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
              <div className="flex items-center pt-1 space-x-2 text-sm">
                <span className="text-green-400/80">Secure LexieAI Communication Channel</span>
              </div>
              <div className="text-xs text-green-400/60 tracking-wide mt-2">
                <div>✓ LexieAI online</div>
                <div className="pt-1 text-emerald-300">Ready for commands...</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="px-3 py-1 bg-gray-800 border border-green-500/30 rounded-lg hover:bg-gray-700 transition-colors text-green-400 text-sm font-medium"
              >
                {isMobileMenuOpen ? 'Close' : 'History'}
              </button>
            </div>
          </div>

          {/* Desktop Header */}
          <div className="hidden md:flex items-center scrollbar-terminal justify-between border-b border-green-500/20 pb-4 flex-shrink-0">
            <div>
              <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
              <div className="flex items-center space-x-2 text-sm">
                <span className="text-green-400/80">Secure LexieAI Communication Channel</span>
              </div>
            </div>
            <DegenModeButton />
          </div>

          {/* Boot log - Hidden on mobile */}
          <div className="hidden md:block mb-6">
            <div className="text-xs text-green-400/60 tracking-wide mb-3">LEXIEAI SYSTEM BOOT v2.1.3</div>
            <div className="space-y-1 text-green-300/80 text-xs leading-5 font-mono">
              <div>✓ Chat interface loaded</div>
              <div>✓ Secure connection established</div>
              <div>✓ LexieAI online</div>
              <div className="pt-1 text-emerald-300">Ready for commands...</div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-teal-500/10 my-6"></div>

          {/* Chat Interface */}
          <div className="flex h-full bg-background scrollbar-terminal text-foreground relative md:flex-row flex-col md:min-h-0 md:min-w-0">
            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
              <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}>
                <div className="w-80 h-full bg-gray-900 border-r border-green-500/30 sidebar" onClick={(e) => e.stopPropagation()}>
                  <Sidebar onCloseMobile={() => setIsMobileMenuOpen(false)} />
                </div>
              </div>
            )}

            {/* Desktop Sidebar */}
            <div className="hidden md:block sidebar">
              <Sidebar />
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 md:min-h-0 md:min-w-0  scrollbar-terminal flex flex-col">
              <Chat />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular standalone mode with full terminal styling
  return (
    <div className="relative z-10 w-full md:max-w-screen-xl md:mx-auto md:px-4 md:sm:px-6 md:lg:px-8 md:py-8 min-h-screen min-w-0 mobile-app-wrapper scrollbar-terminal">
      <div className="font-mono text-green-300 space-y-1 min-h-[18.75rem] md:h-screen flex flex-col md:min-h-0 md:min-w-0 mobile-chat-layout md:px-8 md:pt-4 md:pb-6">
        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center justify-between pb-4 pt-4 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
            <div className="flex items-center pt-1space-x-2 text-sm">
              <span className="text-green-400/80">Secure LexieAI Communication Channel</span>
            </div>
            <div className="text-xs text-green-400/60 tracking-wide mt-2">
              <div>✓ LexieAI online</div>
              <div className="pt-1 text-emerald-300">Ready for commands...</div>
            </div>
            {/* Mobile Controls - Vertical Stack */}
            <div className="flex flex-col items-start mt-3 gap-2">
              <DegenModeButton />
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="px-3 py-1 bg-gray-800 border border-green-500/30 rounded-lg hover:bg-gray-700 transition-colors text-green-400 text-sm font-medium"
              >
                {isMobileMenuOpen ? 'Close' : 'History'}
              </button>
            </div>
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden md:flex items-center justify-between border-b scrollbar-terminal border-green-500/20 pb-4 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-green-400/80">Secure LexieAI Communication Channel</span>
            </div>
          </div>
          <DegenModeButton />
        </div>

        {/* Boot log - Hidden on mobile */}
        <div className="hidden md:block mb-6">
          <div className="text-xs text-green-400/60 tracking-wide mb-3">LEXIEAI SYSTEM BOOT v2.1.3</div>
          <div className="space-y-1 text-green-300/80 text-xs leading-5 font-mono">
            <div>✓ Chat interface loaded</div>
            <div>✓ Secure connection established</div>
            <div>✓ LexieAI online</div>
            <div className="pt-1 text-emerald-300">Ready for commands...</div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-teal-500/10 my-6"></div>

        {/* Chat Interface */}
        <div className="flex h-full bg-background text-foreground relative md:flex-row flex-col md:min-h-0 md:min-w-0 mobile-chat-container scrollbar-terminal">
          {/* Mobile Sidebar Overlay */}
          {isMobileMenuOpen && (
            <div className="md:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}>
              <div className="w-80 h-full bg-gray-900 border-r border-green-500/30 sidebar" onClick={(e) => e.stopPropagation()}>
                <Sidebar onCloseMobile={() => setIsMobileMenuOpen(false)} />
              </div>
            </div>
          )}

          {/* Desktop Sidebar */}
          <div className="hidden md:block sidebar">
            <Sidebar />
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 md:min-h-0 md:min-w-0 flex flex-col">
            <Chat />
          </div>
        </div>
      </div>
    </div>
  );
}
