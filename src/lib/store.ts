import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatState, ChatStore, Conversation, Message } from './types';

const initialState: ChatState = {
  conversations: [],
  currentConversationId: null,
  isStreaming: false,
  darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
  personalityMode: 'normal',
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addMessage: (conversationId: string, message: Message) =>
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? { ...conv, messages: [...conv.messages, message] }
              : conv
          ),
        })),

      createConversation: (title: string = 'New Chat') => {
        const newConversation: Conversation = {
          id: crypto.randomUUID(),
          title,
          messages: [],
          timestamp: Date.now(),
        };

        set((state: ChatState) => ({
          conversations: [newConversation, ...state.conversations],
          currentConversationId: newConversation.id,
        }));

        return newConversation.id;
      },

      updateConversation: (id: string, updates: Partial<Conversation>) =>
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === id ? { ...conv, ...updates } : conv
          ),
        })),

      deleteConversation: (id: string) =>
        set((state: ChatState) => ({
          conversations: state.conversations.filter((conv: Conversation) => conv.id !== id),
          currentConversationId:
            state.currentConversationId === id
              ? state.conversations[0]?.id ?? null
              : state.currentConversationId,
        })),

      setCurrentConversation: (id: string) =>
        set({ currentConversationId: id }),

      setDarkMode: (isDark: boolean) =>
        set({ darkMode: isDark }),

      setIsStreaming: (isStreaming: boolean) =>
        set({ isStreaming }),

      setPersonalityMode: (mode: 'normal' | 'degen') =>
        set({ personalityMode: mode }),
    }),
    {
      name: 'lex-chat-store',
    }
  )
);
