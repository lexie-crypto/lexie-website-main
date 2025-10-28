/**
 * Access Code Gate Component
 *
 * Gating component that requires access code authentication before allowing access to VaultDesktop.
 * Matches VaultDesktop.jsx styling with cyberpunk terminal theme.
 */

import React, { useState, useEffect } from "react";
import {
  ShieldCheckIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

const AccessCodeGate = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = loading, true = authenticated, false = not authenticated
  const [accessCode, setAccessCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [showCode, setShowCode] = useState(false);

  // Check if user is already authenticated on component mount
  useEffect(() => {
    const authStatus = localStorage.getItem("app_access_granted");
    setIsAuthenticated(authStatus === "true");
  }, []);

  // Handle access code verification
  const handleAccessCodeSubmit = async (e) => {
    e.preventDefault();
    if (!accessCode.trim()) {
      setError("Please enter an access code");
      return;
    }

    setIsVerifying(true);
    setError("");

    try {
      // Call access-codes proxy to verify code
      const response = await fetch(
        "/api/access-codes?action=verify-access-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: window.location.origin,
            "User-Agent": navigator.userAgent,
          },
          body: JSON.stringify({ code: accessCode.trim().toLowerCase() }),
        }
      );

      const result = await response.json();

      if (result.success) {
        setIsAuthenticated(true);
        localStorage.setItem("app_access_granted", "true");
        localStorage.setItem("access_code_used", result.codeId);
        setAccessCode("");
      } else {
        setError(result.error || "Invalid access code");
      }
    } catch (error) {
      console.error("Access code verification error:", error);
      setError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  // Don't render anything while checking authentication status
  if (isAuthenticated === null) {
    return null;
  }

  // If authenticated, show children
  if (isAuthenticated) {
    return children;
  }

  // Access code authentication screen
  return (
    <div className="relative w-full min-h-screen overflow-x-hidden overflow-y-auto text-white bg-black scrollbar-terminal">
      {/* Background overlays */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div
            className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse"
            style={{ animationDelay: "1s" }}
          ></div>
        </div>
        <div className="absolute inset-0 overflow-hidden scrollbar-terminal">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full animate-pulse"
              style={{
                left: `${20 + i * 30}%`,
                top: `${20 + i * 20}%`,
                width: `${200 + i * 100}px`,
                height: `${200 + i * 100}px`,
                background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                animationDelay: `${i * 2}s`,
                animationDuration: `${6 + i * 2}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-3xl px-6 py-12 mx-auto sm:px-8 lg:px-12">
        <TerminalWindow
          title="access-gate"
          statusLabel={isVerifying ? "VERIFYING" : "WAITING"}
          statusTone={isVerifying ? "waiting" : "online"}
          footerLeft={<span>Process: access-verification</span>}
          variant="connect"
          className="overflow-hidden"
        >
          <div className="font-mono text-center text-green-300">
            <ShieldCheckIcon className="w-16 h-16 mx-auto mb-6 text-emerald-300" />
            <h2 className="text-2xl font-semibold tracking-tight text-emerald-300">
              LexieVault Access
            </h2>
            <p className="mt-2 text-sm leading-6 text-center text-emerald-300/80">
              Enter your access code to gain entry to the LexieVault.
            </p>

            <div className="space-y-4">
              <form onSubmit={handleAccessCodeSubmit} className="mt-8">
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="accessCode"
                      className="block mb-2 text-sm font-medium text-green-400/80"
                    >
                      Access Code
                    </label>
                    <div className="relative">
                      <input
                        type={showCode ? "text" : "password"}
                        id="accessCode"
                        value={accessCode}
                        onChange={(e) => {
                          const value = e.target.value
                            .toUpperCase()
                            .slice(0, 15);
                          setAccessCode(value);
                        }}
                        className="w-full px-3 py-3 font-mono text-lg tracking-wider text-center text-green-200 border rounded-md bg-black/60 border-green-500/40 focus:ring-emerald-500 focus:border-emerald-400 placeholder-green-600/50"
                        placeholder="ENTER ACCESS CODE"
                        required
                        autoFocus
                        maxLength={15}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCode(!showCode)}
                        className="absolute transition-colors transform -translate-y-1/2 right-3 top-1/2 text-green-400/60 hover:text-green-400"
                      >
                        {showCode ? "👁️‍🗨️" : "👁️"}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 border rounded-lg bg-red-900/20 border-red-500/40">
                      <div className="flex items-center gap-2">
                        <ExclamationTriangleIcon className="w-4 h-4 text-red-400" />
                        <p className="text-sm text-red-300">{error}</p>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifying || !accessCode.trim()}
                    className="w-full px-4 py-3 font-mono font-medium text-black transition-colors rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-green-900 disabled:cursor-not-allowed"
                  >
                    {isVerifying ? "🔍 VERIFYING..." : "🔓 ACCESS VAULT"}
                  </button>
                </div>
              </form>
            </div>

            <div className="mt-8 space-y-1 text-sm text-center text-green-400/60">
              <p>
                Access codes are case-insensitive and can be up to 15 characters
              </p>
              <p className="text-xs">
                Need a code?{' '}
                <a
                  href="https://t.me/lexieAI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-300 hover:text-green-200 underline decoration-green-500/30 hover:decoration-green-400/50 transition-colors"
                >
                  Join our Telegram
                </a>{' '}
                to get the code
              </p>
            </div>
          </div>
        </TerminalWindow>
      </div>
    </div>
  );
};

// Import required components
import TerminalWindow from "./ui/TerminalWindow.jsx";

export default AccessCodeGate;
