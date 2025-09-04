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
  const toneDot = statusTone === 'online' ? 'bg-emerald-400' : 'bg-yellow-400';
  const toneText = statusTone === 'online' ? 'text-emerald-300' : 'text-yellow-300';

  return (
    <div
      className={[
        'relative rounded-xl border',
        'border-teal-500/30 bg-[#0b1012] shadow-2xl',
        'ring-1 ring-teal-400/10 backdrop-blur-sm',
        className,
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-teal-500/20 bg-[#0d1416]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="ml-4 font-mono text-sm text-teal-200/80">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={["w-2 h-2 rounded-full animate-pulse", toneDot].join(' ')} />
          <span className={["font-mono text-xs", toneText].join(' ')}>{statusLabel}</span>
        </div>
      </div>

      <div className="relative bg-[#06090a]">
        <div className="px-6 py-5">{children}</div>
      </div>

      {(footerLeft || footerRight) && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-teal-500/20 bg-[#0d1416] text-teal-300/80 font-mono text-xs">
          <div className="truncate">{footerLeft}</div>
          <div className="truncate">{footerRight}</div>
        </div>
      )}
    </div>
  );
}


