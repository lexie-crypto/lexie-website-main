import React from 'react';

export default function TerminalWindow({
  title = 'lexie-ai',
  statusLabel = 'ONLINE',
  statusTone = 'online',
  children,
  footerLeft,
  footerRight,
  className = '',
}) {
  const toneDot = statusTone === 'online' ? 'bg-green-400' : 'bg-yellow-400';
  const toneText = statusTone === 'online' ? 'text-green-400' : 'text-yellow-300';

  return (
    <div
      className={[
        'relative rounded-lg border border-gray-700',
        'bg-gray-900 shadow-2xl overflow-hidden',
        className,
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="ml-4 font-mono text-sm text-gray-400">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={["w-2 h-2 rounded-full animate-pulse", toneDot].join(' ')} />
          <span className={["font-mono text-xs", toneText].join(' ')}>{statusLabel}</span>
        </div>
      </div>

      <div className="relative bg-black">
        <div className="px-8 pt-4 pb-0">{children}</div>
        {/* Solid blue background */}
        <div className="absolute inset-0 bg-blue-700/10 pointer-events-none"></div>
      </div>

      {(footerLeft || footerRight) && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800 text-gray-400 font-mono text-xs">
          <div className="truncate">{footerLeft}</div>
          <div className="truncate">{footerRight}</div>
        </div>
      )}
    </div>
  );
}


