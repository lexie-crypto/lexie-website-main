/**
 * Terminal-themed toast helper (no JSX; compatible with .js files)
 */

import React from 'react';
import { toast } from 'react-hot-toast';

/**
 * Show a terminal-themed toast notification
 * @param {string} type - 'error', 'success', or other (defaults to yellow)
 * @param {string} title - Main toast title
 * @param {string} subtitle - Optional subtitle (defaults to '')
 * @param {object} opts - Additional toast options
 * @returns {string} Toast ID for dismissal
 */
export const showTerminalToast = (type, title, subtitle = '', opts = {}) => {
  // Allow calling with (type, title, opts) by detecting object in 3rd arg
  if (subtitle && typeof subtitle === 'object' && !Array.isArray(subtitle)) {
    opts = subtitle;
    subtitle = '';
  }
  const color = type === 'error' ? 'bg-red-400' : type === 'success' ? 'bg-emerald-400' : 'bg-yellow-400';

  // Create a unique ID for this toast
  const toastId = Date.now().toString();

  // Store the toast ID so we can dismiss it
  const id = toast.custom((t) => (
    React.createElement(
      'div',
      { className: `font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}` },
      React.createElement(
        'div',
        { className: 'rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl max-w-sm' },
        React.createElement(
          'div',
          { className: 'px-4 py-3 flex items-center gap-3' },
          [
            React.createElement('div', { key: 'dot', className: `h-3 w-3 rounded-full ${color}` }),
            React.createElement(
              'div',
              { key: 'text' },
              [
                React.createElement('div', { key: 'title', className: 'text-sm' }, title),
                subtitle ? React.createElement('div', { key: 'sub', className: 'text-xs text-green-400/80' }, subtitle) : null,
              ]
            ),
            React.createElement(
              'button',
              {
                key: 'close',
                type: 'button',
                'aria-label': 'Dismiss',
                onClick: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('[terminal-toast] Dismissing toast with ID:', toastId);
                  toast.dismiss(toastId);
                  // Force dismiss after short delay if first attempt doesn't work
                  setTimeout(() => toast.dismiss(toastId), 50);
                  setTimeout(() => toast.dismiss(), 100);
                },
                className: 'ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer'
              },
              '×'
            )
          ]
        )
      )
    )
  ), { duration: type === 'error' ? 4000 : 2500, id: toastId, ...opts });

  return id;
};
