import React, { useState } from 'react';
import { PlusIcon, Trash2Icon, PencilIcon, XIcon } from 'lucide-react';
import { useChatStore } from '../../lib/store';
import type { Conversation } from '../../lib/types';

interface SidebarProps {
  onCloseMobile?: () => void;
}

export function Sidebar({ onCloseMobile }: SidebarProps) {
  const {
    conversations,
    currentConversationId,
    createConversation,
    deleteConversation,
    updateConversation,
    setCurrentConversation,
  } = useChatStore();

  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleCreateChat = () => {
    createConversation();
    onCloseMobile?.();
  };

  const startEditing = (id: string, title: string) => {
    setEditingId(id);
    setEditingTitle(title);
  };

  const handleUpdateTitle = (id: string) => {
    updateConversation(id, { title: editingTitle });
    setEditingId(null);
  };

  return (
    <div className="w-64 h-screen bg-secondary md:mt-4 md:-pr-4 flex flex-col pt-12 md:pt-0">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between pl-2 mb-4 pb-2 border-b border-green-500/20 pt-12">
        <h1 className="text-lg font-semibold text-emerald-300">Chat History</h1>
        <button
          onClick={onCloseMobile}
          className="p-2 bg-gray-800 border border-green-500/30 rounded-lg hover:bg-gray-700 transition-colors"
        >
          <XIcon size={20} className="text-green-400" />
        </button>
      </div>

      {/* Desktop Header */}
      <div className="hidden md:block">
        <h1 className="text-lg font-semibold mb-4">Chat History</h1>
      </div>

      <button
        onClick={handleCreateChat}
        className="flex items-center justify-center gap-2 w-full -pl-12 pr-12 mb-4 rounded-lg bg-primary text-primary-foreground hover:text-white md:w-full md:-ml-0"
      >
        <PlusIcon size={16} />
        New Chat
      </button>

      <div className="flex-1 overflow-y-auto space-y-2">
        {conversations.map((conv: Conversation) => (
          <div
            key={conv.id}
            className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer hover:text-white ${
              conv.id === currentConversationId ? 'bg-accent' : ''
            }`}
            onClick={() => {
              setCurrentConversation(conv.id);
              onCloseMobile?.();
            }}
          >
            {editingId === conv.id ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => handleUpdateTitle(conv.id)}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateTitle(conv.id)}
                className="flex-1 bg-transparent border-none focus:outline-none"
                autoFocus
              />
            ) : (
              <span className="flex-1 truncate">{conv.title}</span>
            )}

            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing(conv.id, conv.title);
                }}
                className="p-1 hover:bg-secondary rounded"
              >
                <PencilIcon size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(conv.id);
                }}
                className="p-1 hover:bg-secondary rounded text-destructive"
              >
                <Trash2Icon size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
