export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  systemPrompt?: string;
  timestamp: number;
  settings?: {
    temperature?: number;
    model?: string;
  };
}

export interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  isStreaming: boolean;
  darkMode: boolean;
  personalityMode: 'normal' | 'degen';
}

export interface ChatStore extends ChatState {
  addMessage: (conversationId: string, message: Message) => void;
  createConversation: (title?: string) => string;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  deleteConversation: (id: string) => void;
  setCurrentConversation: (id: string) => void;
  setDarkMode: (isDark: boolean) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setPersonalityMode: (mode: 'normal' | 'degen') => void;
}
