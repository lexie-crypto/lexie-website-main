import React from 'react';

export default function TerminalWindow({
  title = 'lexie-ai',
  statusLabel = 'ONLINE',
  statusTone = 'online',
  children,
  footerLeft,
  footerRight,
  variant = 'vault',
  className = '',
}) {
  const toneDot = statusTone === 'online' ? 'bg-green-400' : 'bg-yellow-400';
  const toneText = statusTone === 'online' ? 'text-green-400' : 'text-yellow-300';

  // Cyberpunk status mapping for footer
  const statusMapping = {
    'READY': 'Primed',
    'WAITING': 'Initiating',
    'ONLINE': 'Connected',
    'CONNECTED': 'Connected',
    'COMPLETE': 'Connected',
    'IDLE': 'Standby'
  };

  const headerKey = String(statusLabel).toUpperCase();
  const computedFooter = statusMapping[headerKey] ?? headerKey; // default to header label

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
        <div className="px-8 pt-4 pb-6">{children}</div>
        {/* Variant-specific background overlay */}
        {variant === 'connect' ? (
          <div className="absolute inset-0 bg-gradient-to-b from-blue-600/15 via-blue-600/10 to-blue-700/8 blur-sm pointer-events-none"></div>
        ) : (
          <div className="absolute inset-0 bg-blue-900/15 pointer-events-none"></div>
        )}
      </div>

      {(footerLeft || footerRight !== undefined) && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700 bg-gray-800 font-mono text-xs">
          <div className="truncate text-gray-400">{footerLeft}</div>
          <div className={["truncate", toneText].join(' ')}>
            {/* Use override if provided, else computed mapping */}
            {footerRight ?? computedFooter}
          </div>
        </div>
      )}
    </div>
  );
}


