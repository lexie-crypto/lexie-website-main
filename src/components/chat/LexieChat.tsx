import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Chat } from './Chat';
import { useChatStore } from '../../lib/store';

export function LexieChat() {
  const { darkMode, createConversation } = useChatStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

  return (
    <div className="relative z-10 w-full md:max-w-screen-xl md:mx-auto md:px-4 md:sm:px-6 md:lg:px-8 md:py-8 min-h-screen min-w-0 mobile-app-wrapper">
      <div className="font-mono text-green-300 space-y-1 min-h-[18.75rem] md:h-screen flex flex-col md:min-h-0 md:min-w-0 mobile-chat-layout md:px-8 md:pt-4 md:pb-6">
        {/* Mobile Menu Button */}
        <div className="md:hidden flex items-center justify-between -pb-6 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
            <div className="flex items-center pt-1space-x-2 text-sm">
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
              className="p-2 bg-gray-800 border border-green-500/30 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <span className="text-green-400">{isMobileMenuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden md:flex items-center justify-between border-b border-green-500/20 pb-4 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-emerald-300">LexieAI Chat Terminal</h1>
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-green-400/80">Secure LexieAI Communication Channel</span>
            </div>
          </div>
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
        <div className="flex h-full bg-background text-foreground relative md:flex-row flex-col md:min-h-0 md:min-w-0 mobile-chat-container">
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
