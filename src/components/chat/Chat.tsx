import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { SendIcon, Settings2Icon } from 'lucide-react';
import { useChatStore } from '../../lib/store';
import { ChatService } from '../../lib/api';
import type { Message, Conversation } from '../../lib/types';

export function Chat() {
  const {
    conversations,
    currentConversationId,
    addMessage,
    isStreaming,
    setIsStreaming,
    updateConversation,
    personalityMode,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [funMode, setFunMode] = useState(false);
  const messagesEndRef = useRef(null);

  const currentConversation = conversations.find(
    (conv: Conversation) => conv.id === currentConversationId
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  };

  useEffect(() => {
    // Small delay to ensure DOM has updated
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 100); // Increased delay for typing indicator animation
    return () => clearTimeout(timeoutId);
  }, [currentConversation?.messages, isStreaming]);

  function detectFunModeCommand(text: string): 'enable' | 'disable' | null {
    const enableCmds = [/^enable fun mode$/i, /^fun mode on$/i];
    const disableCmds = [/^disable fun mode$/i, /^fun mode off$/i];
    if (enableCmds.some((r) => r.test(text.trim()))) return 'enable';
    if (disableCmds.some((r) => r.test(text.trim()))) return 'disable';
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentConversationId || !input.trim() || isStreaming) return;

    const funCmd = detectFunModeCommand(input);
    if (funCmd) {
      if (funCmd === 'enable' && !funMode) {
        setFunMode(true);
        addMessage(currentConversationId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '🔥 Fun mode enabled. Time to code and clown.',
          timestamp: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 10);
      } else if (funCmd === 'disable' && funMode) {
        setFunMode(false);
        addMessage(currentConversationId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '🧠 Fun mode disabled. Back to business, R1FT.',
          timestamp: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 10);
      }
      setInput('');
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    addMessage(currentConversationId, userMessage);
    const messageContent = input;
    setInput('');
    setIsStreaming(true);

    // Scroll immediately when user sends message
    setTimeout(() => scrollToBottom(), 10);

    try {
      const response = await ChatService.sendMessage(messageContent, { funMode: funMode || personalityMode === 'degen' });
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.message || 'No response received',
        timestamp: Date.now(),
      };
      addMessage(currentConversationId, assistantMessage);
      // Scroll after assistant response
      setTimeout(() => scrollToBottom(), 10);
    } catch (error) {
      console.error('Error calling chat API:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: Date.now(),
      };
      addMessage(currentConversationId, errorMessage);
      // Scroll after error message
      setTimeout(() => scrollToBottom(), 10);
    } finally {
      setIsStreaming(false);
    }
  };

  // Detect personality mode change
  const prevPersonalityMode = useRef(personalityMode);

  useEffect(() => {
    if (prevPersonalityMode.current === 'normal' && personalityMode === 'degen' && currentConversationId) {
      // Dynamic API call for acknowledgement
      const fetchDegenAck = async () => {
        try {
          setIsStreaming(true);
          const response = await ChatService.sendMessage('[system] Degen mode activated! Generate a fun, dynamic acknowledgement message in your degen personality.', { funMode: true });
          const ackMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.message || 'Degen mode activated! Let\'s get wild.',
            timestamp: Date.now(),
          };
          addMessage(currentConversationId, ackMessage);
          setTimeout(() => scrollToBottom(), 100);
        } catch (error) {
          console.error('Error generating degen acknowledgement:', error);
        } finally {
          setIsStreaming(false);
        }
      };
      fetchDegenAck();
    }
    prevPersonalityMode.current = personalityMode;
  }, [personalityMode, currentConversationId, addMessage]);


  if (!currentConversationId) {
    return (
      <div className="flex-1 md:min-h-0 md:min-w-0 flex items-center justify-center text-muted-foreground">
        Select or create a conversation to start chatting
      </div>
    );
  }

  return (
    <div className="flex-1 md:min-h-0 md:min-w-0 flex flex-col overflow-hidden scrollbar-terminal h-full min-h-[18.75rem] bg-black font-mono border border-green-300 p-2 md:p-4">
      <div className="flex items-center justify-between py-1 px-0 md:p-0 border-b border-green-500/30 flex-shrink-0">
        <h2 className="text-lg font-semibold">
          {currentConversation?.title || 'All your base are belong to us'}
        </h2>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="py-0.5 px-0.5 md:p-0 hover:bg-accent rounded-lg"
        >
          <Settings2Icon size={20} />
        </button>
      </div>

      {showSettings && (
        <div className="py-1 px-0 md:p-0 border-b border-gray-600 space-y-4 bg-gray-800 flex-shrink-0">
          <div>
            <label className="block text-sm font-medium mb-1">
              System Prompt
            </label>
            <textarea
              className="w-full py-1 px-2 md:py-2 md:px-3 rounded border border-green-500/40 bg-black text-green-300 placeholder-green-400/70 focus:border-emerald-400 focus:outline-none transition-colors text-base md:text-sm font-mono resize-none"
              rows={3}
              value={currentConversation?.systemPrompt || ''}
              onChange={(e) =>
                currentConversation &&
                updateConversation(currentConversation.id, {
                  systemPrompt: e.target.value,
                })
              }
            />
          </div>
        </div>
      )}

      <div className="flex-1 md:min-h-0 overflow-y-auto scrollbar-terminal overflow-x-hidden py-1 px-0 md:p-0 md:pr-0 w-full max-w-full bg-black mobile-chat-messages">
        <div className="w-full max-w-full overflow-x-hidden scrollbar-terminal">
          {currentConversation?.messages.map((message: Message, index: number) => (
            <div
              key={message.id}
              className={`flex w-full mb-4 chat-message ${index === 0 ? 'mt-2' : ''} ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}
              style={{
                overflowX: 'hidden',
                width: '100%',
                maxWidth: '100%',
              }}
            >
              <div
              className={`rounded-lg py-0.5 px-0.5 md:p-0 break-words ${
              message.role === 'assistant'
               ? message.content.includes('Sorry, I encountered an error')
                 ? 'bg-card font-bold font-sans text-purple-300 transition-colors self-start'
                 : 'bg-card font-bold text-purple-300 self-start'
               : 'bg-muted text-muted-foreground self-end max-w-3xl'
                }`}
              style={{
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'pre-wrap',
              overflowX: 'hidden',
              }}
>
                <ReactMarkdown
                  components={{
                    p({ children, ...props }) {
                      // Apply font-sans styling to error messages
                      const isErrorMessage = message.content.includes('Sorry, I encountered an error');
                      return (
                        <p {...props} className={isErrorMessage ? 'font-sans' : ''}>
                          {children}
                        </p>
                      );
                    },
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match;
                      return isInline ? (
                        <code {...props} className={`${className} px-1 py-0.5 bg-muted text-muted-foreground rounded`} style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                          {children}
                        </code>
                      ) : (
                        <SyntaxHighlighter
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          className="scrollbar-terminal"
                          customStyle={{
                            whiteSpace: 'pre-wrap',
                            overflowX: 'auto',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            maxWidth: '100%',
                            width: '100%',
                            background: 'hsl(var(--muted))',
                            color: 'hsl(var(--foreground))',
                            borderRadius: '0.5rem',
                            margin: '0.5rem 0',
                          }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      );
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {isStreaming && (
            <div className="flex w-full mb-4 chat-message justify-start animate-fade-in">
              <div className="bg-card rounded-lg p-3 text-purple-300 self-start border border-purple-500/30">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm font-medium">Lexie is typing...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="py-1 px-0 md:p-0  flex-shrink-0 mobile-chat-input">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder=" Type your message..."
            className="flex-1 py-1 px-2 md:py-2 md:px-3 rounded border border-green-500/40 bg-black text-green-300 placeholder-green-400/70 focus:border-emerald-400 focus:outline-none transition-colors text-base md:text-sm font-mono"
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="py-1 px-2 md:py-2 md:px-3 rounded border border-green-500/40 bg-black text-green-300 hover:bg-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SendIcon size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
