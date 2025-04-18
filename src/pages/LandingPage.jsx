import React, { useEffect, useState } from 'react';

export default function LandingPage() {
  const [bgLoaded, setBgLoaded] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  
  useEffect(() => {
    // Preload the background image
    const bgImg = new Image();
    bgImg.src = '/background.png';
    bgImg.onload = () => {
      setBgLoaded(true);
      // Add small delay before showing content for smoother transition
      setTimeout(() => setContentVisible(true), 300);
    };
  }, []);
  
  return (
    <main className="relative h-screen w-full bg-black text-white overflow-hidden">
      {/* Loading overlay - visible until background loads */}
      <div className={`absolute inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${bgLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="text-purple-300 text-2xl font-mono">
          Loading<span className="animate-[ellipsis_1.5s_infinite]">...</span>
        </div>
      </div>
      
      {/* Background layer - lowest z-index */}
      <div className="absolute inset-0 z-10 overflow-hidden bg-black">
        {/* Primary background image - fullscreen with best quality */}
        <img
          src="/background.png"
          alt="Cyberpunk City Background"
          className={`absolute min-h-full min-w-full object-cover transition-opacity duration-700 ${bgLoaded ? 'opacity-90' : 'opacity-0'}`}
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        />
        
        {/* Very subtle overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/20 opacity-40"></div>
      </div>

      {/* Decorative neon signs with glowing borders - matching the circled areas in the reference image */}
      <div className={`absolute inset-0 z-[15] pointer-events-none transition-opacity duration-700 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Left tall neon sign border - with offset flickering effect */}
        <div className="absolute top-[5%] left-[18.5%] w-[69px] h-[245px] border-[0.2px] border-pink-500 rounded-md animate-neon-flicker-alt"></div>
        
        {/* Bottom left neon sign border - adjusted to better match the actual sign */}
        <div className="absolute bottom-[18%] left-[30.2%] w-[66px] h-[70px] border-[0.8px] border-pink-500 rounded-md animate-neon-flicker"></div>
      </div>

      {/* Lexie Character Layer - middle z-index between bg and text */}
      <div className={`absolute inset-0 z-20 pointer-events-none flex items-center justify-center transition-opacity duration-700 ${contentVisible ? 'opacity-95' : 'opacity-0'}`}>
        <img
          src="/lexie.png"
          alt="Lexie"
          className="h-full w-auto max-w-full object-contain"
        />
      </div>

      {/* Content layer - highest z-index */}
      <div className={`relative z-30 h-full transition-opacity duration-700 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Main Content - Adjusted position */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 mt-[15vh] md:mt-[18vh]">
          {/* Main title with enhanced glitch effect */}
          <div className="relative mb-4 glitch-container">
            <h1 className="text-4xl md:text-6xl font-semibold text-purple-300 animate-cyber-text-main">
              She's Almost Awake.
            </h1>
            <h1 className="absolute top-0 left-0 text-4xl md:text-6xl font-semibold text-cyan-300 animate-cyber-glitch-1 glitch-layer">
              She's Almost Awake.
            </h1>
            <h1 className="absolute top-0 left-0 text-4xl md:text-6xl font-semibold text-pink-300 animate-cyber-glitch-2 glitch-layer">
              She's Almost Awake.
            </h1>
            <h1 className="absolute top-0 left-0 text-4xl md:text-6xl font-semibold text-yellow-300 animate-cyber-glitch-3 glitch-layer">
              She's Almost Awake.
            </h1>
          </div>
          
          {/* Subtitle with typewriter effect */}
          <p className="text-md md:text-xl text-gray-300 mb-6 max-w-xl overflow-hidden whitespace-nowrap animate-typewriter">
            Your AI companion for the world of Web3.
          </p>

          {/* Buttons container for horizontal alignment */}
          <div className="flex flex-col md:flex-row gap-4 w-full justify-center">
            {/* Telegram Button with neon border and hover effect */}
            <a
              href="https://t.me/Lexie_Crypto_Bot"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-neon group bg-black text-purple-300 px-6 py-3 rounded-full font-medium shadow-lg transition-colors duration-300 border border-purple-500 min-w-[210px] flex items-center justify-center hover:bg-pink-200 hover:text-slate-900 hover:border-transparent"
            >
              Try it on Telegram
            </a>
            {/* Twitter Button with neon border and hover effect */}
            <a
              href="https://twitter.com/0xLexieLaine"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-neon group bg-black text-purple-300 px-6 py-3 rounded-full font-medium shadow-lg transition-colors duration-300 border border-purple-500 min-w-[210px] flex items-center justify-center hover:bg-pink-200 hover:text-slate-900 hover:border-transparent"
            >
              Follow @0xLexieLaine
            </a>
          </div>
        </div>

        {/* Style tag for custom animations */}
        <style jsx>{`
          @keyframes cyberFadeIn {
            0% { opacity: 0; }
            100% { opacity: 1; }
          }
          
          @keyframes initialGlitch {
            0% { opacity: 0; transform: translate(-10px, -5px) skew(10deg); filter: blur(1px); }
            10% { opacity: 0.6; transform: translate(10px, 5px) skew(-5deg); filter: blur(0); }
            20% { opacity: 0.2; transform: translate(-15px, 0) skew(15deg); filter: blur(2px); }
            30% { opacity: 0.8; transform: translate(5px, -5px) skew(-10deg); filter: blur(0); }
            40% { opacity: 0.5; transform: translate(-5px, 10px) skew(5deg); filter: blur(1px); }
            50% { opacity: 1; transform: translate(0, 0) skew(0); filter: blur(0); }
            60% { opacity: 0.7; transform: translate(5px, 0) skew(-5deg); filter: blur(1px); }
            70% { opacity: 0.9; transform: translate(-3px, 2px) skew(2deg); filter: blur(0); }
            80% { opacity: 1; transform: translate(0, 0) skew(0); filter: blur(0); }
            90% { opacity: 0.8; transform: translate(2px, -2px) skew(-2deg); filter: blur(1px); }
            100% { opacity: 1; transform: translate(0, 0) skew(0); filter: blur(0); }
          }
          
          @keyframes subtleGlitch {
            0% { opacity: 0.9; transform: translate(-2px, 0); }
            20% { opacity: 1; }
            40% { opacity: 0.9; transform: translate(2px, 0); }
            60% { opacity: 1; }
            80% { opacity: 0.9; transform: translate(-2px, 0); }
            100% { opacity: 1; }
          }
          
          @keyframes rgbSplit {
            0% { text-shadow: -2px 0 #ff0000, 2px 0 #00ffff; }
            25% { text-shadow: -1px 0 #ff0000, 3px 0 #00ffff; }
            50% { text-shadow: 1px 0 #ff0000, -1px 0 #00ffff; }
            75% { text-shadow: 3px 0 #ff0000, -3px 0 #00ffff; }
            100% { text-shadow: -2px 0 #ff0000, 2px 0 #00ffff; }
          }
          
          @keyframes scanlines {
            0% { background-position: 0 0; }
            100% { background-position: 0 100%; }
          }
          
          @keyframes typewriter {
            0% { width: 0; }
            30% { width: 0; }
            70% { width: 100%; }
            100% { width: 100%; }
          }
          
          @keyframes neonPulse {
            0% { box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7; }
            50% { box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899; }
            100% { box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7; }
          }

          @keyframes neonSignGlow {
            0% { box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899, 0 0 15px #ec4899, inset 0 0 5px #ec4899; }
            50% { box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899, 0 0 30px #ec4899, inset 0 0 10px #ec4899; }
            100% { box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899, 0 0 15px #ec4899, inset 0 0 5px #ec4899; }
          }

          @keyframes neonFlicker {
            0%, 22%, 49%, 62%, 81%, 92% {
              box-shadow: 0 0 7px #ec4899, 0 0 15px #ec4899, 0 0 20px #ec4899, inset 0 0 7px #ec4899;
              opacity: 1;
            }
            14%, 23%, 55%, 75%, 93% {
              box-shadow: 0 0 3px #ec4899, 0 0 7px #ec4899, 0 0 10px #ec4899, inset 0 0 3px #ec4899;
              opacity: 0.8;
            }
            24%, 56%, 94% {
              box-shadow: none;
              opacity: 0.2;
            }
            25%, 57%, 95% {
              box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899, inset 0 0 3px #ec4899;
              opacity: 0.6;
            }
            26%, 58%, 96% {
              box-shadow: none;
              opacity: 0.1;
            }
            27%, 59%, 97% {
              box-shadow: 0 0 7px #ec4899, 0 0 15px #ec4899, 0 0 20px #ec4899, inset 0 0 7px #ec4899;
              opacity: 1;
            }
          }

          @keyframes neonFlickerAlt {
            0%, 35%, 72%, 85% {
              box-shadow: 0 0 7px #ec4899, 0 0 15px #ec4899, 0 0 20px #ec4899, inset 0 0 7px #ec4899;
              opacity: 1;
            }
            30%, 44%, 78%, 84% {
              box-shadow: 0 0 3px #ec4899, 0 0 7px #ec4899, 0 0 10px #ec4899, inset 0 0 3px #ec4899;
              opacity: 0.8;
            }
            32%, 45%, 80% {
              box-shadow: none;
              opacity: 0.2;
            }
            33%, 46%, 81% {
              box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899, inset 0 0 3px #ec4899;
              opacity: 0.6;
            }
            34%, 47%, 82% {
              box-shadow: none;
              opacity: 0.1;
            }
            36%, 48%, 83% {
              box-shadow: 0 0 7px #ec4899, 0 0 15px #ec4899, 0 0 20px #ec4899, inset 0 0 7px #ec4899;
              opacity: 1;
            }
          }

          /* Enhanced and new animations for more intense glitch effect */
          @keyframes glitchText {
            0% {
              opacity: 1;
              transform: translate(0);
              clip-path: inset(0 0 0 0);
            }
            2% {
              clip-path: inset(80% 0 0 0);
              transform: translate(-2px, 2px);
            }
            4% {
              clip-path: inset(0 0 75% 0);
              transform: translate(3px, -3px);
            }
            6% {
              clip-path: inset(0 0 0 0);
              transform: translate(0);
            }
            8% {
              clip-path: inset(40% 0 43% 0);
              transform: translate(-2px, 1px);
            }
            10% {
              clip-path: inset(0 0 0 0);
              transform: translate(0);
            }
            12% {
              clip-path: inset(63% 0 18% 0);
              transform: translate(-1px, -1px);
            }
            14% {
              clip-path: inset(0 0 0 0);
              transform: translate(0);
            }
            20% {
              transform: translate(0);
              opacity: 1;
            }
            30% {
              opacity: 0.7;
            }
            40% {
              transform: translate(0);
              opacity: 1;
            }
            43% {
              transform: translate(4px, 2px);
              opacity: 0.8;
            }
            46% {
              transform: translate(-3px, -2px);
              opacity: 1;
            }
            100% {
              transform: translate(0);
              opacity: 1;
            }
          }

          @keyframes glitchLayers {
            0% {
              opacity: 0;
              transform: translate(-10px, 5px);
            }
            2.5% {
              opacity: 0.4;
            }
            5% {
              opacity: 0.1;
              transform: translate(10px, -5px);
            }
            7.5% {
              opacity: 0.3;
            }
            10% {
              opacity: 0;
              transform: translate(0);
            }
            100% {
              opacity: 0;
            }
          }

          @keyframes textFlicker {
            0% { opacity: 1; }
            3% { opacity: 0.8; }
            6% { opacity: 0.9; }
            9% { opacity: 0.2; }
            12% { opacity: 0.9; }
            15% { opacity: 1; }
            50% { opacity: 0.95; }
            70% { opacity: 0.85; }
            100% { opacity: 1; }
          }

          @keyframes ellipsis {
            0% { content: '.'; }
            33% { content: '..'; }
            66% { content: '...'; }
            100% { content: ''; }
          }

          .glitch-container {
            position: relative;
            overflow: hidden;
          }

          .glitch-layer {
            will-change: transform, opacity, clip-path;
          }
          
          .animate-cyber-text-main {
            animation: 
              cyberFadeIn 0.5s forwards,
              glitchText 4s ease-in-out 0.5s,
              textFlicker 6s infinite 4.5s,
              rgbSplit 6s infinite 4.5s;
            opacity: 0;
          }
          
          .animate-cyber-glitch-1 {
            animation: glitchLayers 2.5s infinite;
            animation-timing-function: steps(1, end);
            animation-delay: 0.7s;
            opacity: 0;
            transform: translate3d(-10px, 0, 0);
            clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
          }
          
          .animate-cyber-glitch-2 {
            animation: glitchLayers 2.5s infinite;
            animation-timing-function: steps(1, end);
            animation-delay: 0.9s;
            opacity: 0;
            transform: translate3d(10px, 0, 0);
            clip-path: polygon(0 45%, 100% 45%, 100% 75%, 0 75%);
          }

          .animate-cyber-glitch-3 {
            animation: glitchLayers 2.5s infinite;
            animation-timing-function: steps(1, end);
            animation-delay: 1.1s;
            opacity: 0;
            transform: translate3d(-5px, 0, 0);
            clip-path: polygon(0 75%, 100% 75%, 100% 100%, 0 100%);
          }
          
          .animate-initial-glitch {
            animation: initialGlitch 2s forwards;
          }
          
          .animate-subtle-glitch {
            animation: subtleGlitch 4s infinite 2s;
          }
          
          .animate-rgb-split {
            animation: rgbSplit 6s infinite;
          }
          
          .animate-scanlines {
            background: linear-gradient(to bottom, transparent 50%, rgba(0, 0, 0, 0.3) 50%);
            background-size: 100% 4px;
            animation: scanlines 8s linear infinite;
          }
          
          .animate-typewriter {
            width: 0;
            animation: typewriter 4s steps(40, end) forwards 1.2s;
          }
          
          .animate-neon-pulse {
            animation: neonPulse 2s infinite 2s;
          }

          .animate-neon-sign {
            animation: neonSignGlow 3s infinite;
          }

          .animate-neon-flicker {
            animation: neonFlicker 10s infinite;
          }

          .animate-neon-flicker-alt {
            animation: neonFlickerAlt 13s infinite;
          }

          /* Button with neon effect that turns off on hover */
          .btn-neon {
            box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7;
            animation: neonPulse 2s infinite 2s;
          }
          
          .btn-neon:hover {
            box-shadow: none;
            animation: none;
          }

          .animate-[ellipsis_1.5s_infinite]::after {
            content: '';
            animation: ellipsis 1.5s infinite steps(4, end);
          }
        `}</style>

        {/* Footer Quote - Updated with larger size and text shadow for better visibility */}
        <div className="absolute bottom-8 w-full text-center text-xl md:text-2xl lg:text-3xl text-purple-200 font-mono" style={{ textShadow: '0 0 8px rgba(216, 180, 254, 0.7)' }}>
          "She guides. She protects. She educates."
        </div>
      </div>
    </main>
  );
}