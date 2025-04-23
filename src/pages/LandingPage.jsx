import React, { useEffect, useState, useRef } from 'react';

export default function LandingPage() {
  const [bgLoaded, setBgLoaded] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [glitchActive, setGlitchActive] = useState(false);
  const [extremeGlitch, setExtremeGlitch] = useState(false);
  const [blackoutActive, setBlackoutActive] = useState(false);
  const [rebootingText, setRebootingText] = useState(false);
  const [rebootActive, setRebootActive] = useState(false);
  const [emailButtonKey, setEmailButtonKey] = useState(0);
  
  // Ref to keep track of timer IDs for cleanup
  const timersRef = useRef([]);
  const prevRebootActiveRef = useRef(rebootActive);
  
  useEffect(() => {
    // Check if device is mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    // Check on mount and when window resizes
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Preload the background image
    const bgImg = new Image();
    bgImg.src = '/background.png';
    bgImg.onload = () => {
      setBgLoaded(true);
      // Add small delay before showing content for smoother transition
      setTimeout(() => setContentVisible(true), 300);
    };
    
    return () => {
      window.removeEventListener('resize', checkMobile);
      // Clear all timers on unmount
      timersRef.current.forEach(id => clearTimeout(id));
    };
  }, []);
  
  // Set up the glitch cycle once content is visible
  useEffect(() => {
    if (contentVisible) {
      // Wait 15 seconds before starting the first glitch cycle
      const initialDelay = setTimeout(() => {
        startGlitchCycle();
      }, 9000);
      
      timersRef.current.push(initialDelay);
    }
    
    return () => {
      // Clear all timers on unmount or when dependencies change
      timersRef.current.forEach(id => clearTimeout(id));
      timersRef.current = [];
    };
  }, [contentVisible]);
  
  // Reset email button animation after reboot completes
  useEffect(() => {
    // Track previous rebootActive state
    const wasRebooting = prevRebootActiveRef.current;
    prevRebootActiveRef.current = rebootActive;
    
    // If rebootActive changed from true to false (reboot just completed)
    if (wasRebooting && !rebootActive && contentVisible) {
      // After reboot completes, wait a bit then trigger email button re-animation
      const resetTimer = setTimeout(() => {
        setEmailButtonKey(prevKey => prevKey + 1); // Change key to force re-render with fresh animation
      }, 50);
      
      timersRef.current.push(resetTimer);
    }
    
    return () => {};
  }, [rebootActive, contentVisible]);
  
  // Function to start a complete glitch cycle
  const startGlitchCycle = () => {
    // Phase 1: Start the glitch effect
    setGlitchActive(true);
    
    // Phase 2: After 1 second, activate extreme glitch effects
    const intensifyTimer = setTimeout(() => {
      setExtremeGlitch(true);
    }, 1000);
    timersRef.current.push(intensifyTimer);
    
    // Phase 3: Start blackout
    const blackoutTimer = setTimeout(() => {
      setBlackoutActive(true);
      
      // Reset email button to trigger a fresh slide-in
      setEmailButtonKey(prevKey => prevKey + 1);
      
      // Make email button reappear after 2 seconds, even during blackout
      const emailTimer = setTimeout(() => {
        // Increment key again to force a fresh animation
        setEmailButtonKey(prevKey => prevKey + 1);
      }, 2000);
      
      timersRef.current.push(emailTimer);
    }, 3000);
    timersRef.current.push(blackoutTimer);
    
    // Phase 4: After 3.5 seconds, show "Rebooting....." text and keep it visible for 3 seconds
    const rebootingTextTimer = setTimeout(() => {
      setRebootingText(true);
    }, 3500);
    timersRef.current.push(rebootingTextTimer);
    
    // Phase 5: After 6.5 seconds, start reboot sequence
    const rebootTimer = setTimeout(() => {
      setExtremeGlitch(false);
      setRebootingText(false);
      setRebootActive(true);
      setGlitchActive(false);
    }, 6500);
    timersRef.current.push(rebootTimer);
    
    // Phase 6: After 9 seconds, end blackout
    const endBlackoutTimer = setTimeout(() => {
      setBlackoutActive(false);
    }, 9000);
    timersRef.current.push(endBlackoutTimer);
    
    // Phase 7: After 10.5 seconds, end reboot sequence
    const endRebootTimer = setTimeout(() => {
      setRebootActive(false);
      
      // Schedule the next glitch cycle in 9-14 seconds 
      const nextCycleDelay = Math.floor(Math.random() * 9000) + 5000;
      const nextCycleTimer = setTimeout(() => {
        startGlitchCycle();
      }, nextCycleDelay);
      timersRef.current.push(nextCycleTimer);
    }, 10500);
    timersRef.current.push(endRebootTimer);
  };
  
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
          className={`absolute min-h-full min-w-full object-cover transition-opacity duration-700 ${bgLoaded && !blackoutActive ? 'opacity-90' : 'opacity-0'}`}
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        />
        
        {/* Very subtle overlay for text readability */}
        <div className={`absolute inset-0 bg-gradient-to-b from-black/5 to-black/20 opacity-40 ${blackoutActive ? 'hidden' : ''}`}></div>
      </div>

      {/* VHS/CRT distortion overlay - visible during glitch */}
      {glitchActive && (
        <div className={`absolute inset-0 z-40 pointer-events-none ${extremeGlitch ? 'extreme-distortion' : ''}`}>
          {/* Horizontal scan lines */}
          <div className="absolute inset-0 bg-scanlines"></div>
          
          {/* Enhanced vertical colored lines */}
          <div className="absolute inset-0 overflow-hidden vertical-lines-container">
            {Array.from({ length: 120 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute h-full vertical-line"
                style={{ 
                  width: `${Math.random() * 3 + 0.5}px`, 
                  left: `${i * 0.8}%`,
                  background: i % 3 === 0 ? '#9333ea' : i % 3 === 1 ? '#3b82f6' : '#ef4444',
                  opacity: Math.random() * 0.5 + 0.3,
                  filter: `blur(${Math.random() * 0.5}px)`,
                  transform: `scaleY(${1 + Math.random() * 0.1})`
                }}
              ></div>
            ))}
          </div>
          
          {/* Horizontal glitch segments */}
          <div className="absolute inset-0 horizontal-glitch-segments">
            {Array.from({ length: 10 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute w-full bg-transparent overflow-hidden"
                style={{ 
                  height: `${Math.random() * 20 + 10}px`, 
                  top: `${i * 10}%`,
                  transform: `translateX(${(Math.random() * 30 - 15)}px)`,
                  filter: i % 2 === 0 ? 'hue-rotate(90deg)' : 'hue-rotate(-90deg)'
                }}
              ></div>
            ))}
          </div>
          
          {/* Random noise effect */}
          <div className="absolute inset-0 noise-effect"></div>
          
          {/* RGB split effect */}
          <div className="absolute inset-0 rgb-split-effect"></div>
        </div>
      )}
      
      {/* Reboot effect overlay */}
      {rebootActive && (
        <div className="absolute inset-0 z-45 pointer-events-none flex items-center justify-center">
          <div className="text-white-500 font-mono text-lg md:text-xl animate-typing-reboot">
            <div>{">"} SYSTEM REBOOT INITIATED</div>
            <div>{">"} LOADING OS...</div>
            <div>{">"} INITIALIZING NEURAL NETWORK</div>
            <div>{">"} RESTORING VISUAL INTERFACE</div>
            <div>{">"} SYSTEM ONLINE</div>
          </div>
        </div>
      )}
      
      {/* Pre-reboot "Rebooting....." text */}
      {rebootingText && (
        <div className="absolute inset-0 z-[100] pointer-events-none flex items-center justify-center bg-black/80">
          <div className="text-white-500 font-mono text-4xl md:text-5xl font-bold animate-pulse">
            Rebooting<span className="animate-ellipsis">...</span>
          </div>
        </div>
      )}

      {/* Decorative neon signs with glowing borders - matching the circled areas in the reference image */}
      <div className={`absolute inset-0 z-[15] pointer-events-none transition-opacity duration-700 ${contentVisible && !blackoutActive ? 'opacity-100' : 'opacity-0'}`}>
        {/* Left tall neon sign border - with offset flickering effect - hidden on mobile */}
        {!isMobile && (
          <div className="absolute top-[5%] left-[18.5%] w-[69px] h-[245px] border-[0.2px] border-pink-500 rounded-md animate-neon-flicker-alt"></div>
        )}
        
        {/* Bottom left neon sign border - adjusted to better match the actual sign - hidden on mobile */}
        {!isMobile && (
          <div className="absolute bottom-[18%] left-[30.2%] w-[66px] h-[70px] border-[0.8px] border-pink-500 rounded-md animate-neon-flicker"></div>
        )}

        {/* Exact diagonal pink lines for mobile only matching user's drawing */}
        {isMobile && (
          <>
            {/* First diagonal line with flickering animation - similar to neon sign border */}
            <div className="absolute top-[14%] right-[31%] w-[50.5px] h-[3px] bg-pink-500 rounded-full transform rotate-[160deg]"></div>
            
            {/* Second diagonal line with alternative flickering animation */}
            <div className="absolute top-[10%] right-[32.5%] w-[42px] h-[3px] bg-pink-500 rounded-full transform rotate-[36deg] animate-neon-flicker-alt"></div>
          </>
        )}
      </div>

      {/* Lexie Character Layer - middle z-index between bg and text */}
      <div className={`absolute inset-0 z-20 pointer-events-none flex ${isMobile ? 'items-end pb-0 -mb-8 overflow-visible' : 'items-center'} justify-center transition-opacity duration-700 ${contentVisible && !blackoutActive ? 'opacity-95' : 'opacity-0'}`}>
        <img
          src="/lexie.png"
          alt="Lexie"
          className={`${isMobile ? 'h-[94vh] w-auto max-w-none object-cover object-bottom scale-90' : 'h-full w-auto max-w-full object-contain'}`}
        />
      </div>

      {/* Content layer - highest z-index */}
      <div className={`relative z-30 h-full transition-opacity duration-700 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Main Content - Adjusted position */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-center px-4 ${isMobile ? 'mt-[20vh]' : 'mt-[15vh] md:mt-[18vh]'}`}>
          {/* Main title with enhanced glitch effect */}
          <div className="relative mb-4 glitch-container">
            <h1 className={`text-4xl md:text-6xl font-semibold text-purple-300 animate-cyber-text-main ${glitchActive ? 'animate-intense-glitch' : ''}`}>
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
          
          {/* Subtitle with typewriter effect - hidden during blackout */}
          <p className={`text-md md:text-xl text-gray-300 mb-6 max-w-xl overflow-hidden whitespace-nowrap animate-typewriter ${blackoutActive ? 'opacity-0' : ''}`}>
            Your AI companion for the world of Web3.
          </p>

          {/* Buttons container for horizontal alignment */}
          <div className={`flex flex-col gap-4 w-full justify-center ${isMobile ? 'px-4 mt-4' : 'md:flex-row'}`}>
            {/* Telegram Button with neon border and hover effect */}
            <a
              href="https://t.me/Lexie_Crypto_Bot"
              target="_blank"
              rel="noopener noreferrer"
              className={`btn-neon group bg-black text-purple-300 px-6 py-3 rounded-full font-medium shadow-lg transition-colors duration-300 border border-purple-500 flex items-center justify-center hover:bg-pink-200 hover:text-slate-900 hover:border-transparent ${isMobile ? 'w-full' : 'min-w-[210px]'} ${glitchActive ? 'animate-btn-glitch' : ''}`}
            >
              Try it on Telegram
            </a>
            {/* Twitter Button with neon border and hover effect */}
            <a
              href="https://twitter.com/0xLexieAI"
              target="_blank"
              rel="noopener noreferrer"
              className={`btn-neon group bg-black text-purple-300 px-6 py-3 rounded-full font-medium shadow-lg transition-colors duration-300 border border-purple-500 flex items-center justify-center hover:bg-pink-200 hover:text-slate-900 hover:border-transparent ${isMobile ? 'w-full' : 'min-w-[210px]'} ${glitchActive ? 'animate-btn-glitch' : ''}`}
            >
              Follow @0xLexieAI
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
          
          /* Animation for the rebooting text ellipsis */
          @keyframes ellipsisAnimation {
            0% { content: ''; }
            25% { content: '.'; }
            50% { content: '..'; }
            75% { content: '...'; }
            100% { content: ''; }
          }
          
          /* New animations for the VHS/CRT distortion effect */
          @keyframes verticalMove {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(200%); }
          }
          
          @keyframes noiseAnimation {
            0%, 100% { background-position: 0 0; }
            10% { background-position: -5% -10%; }
            20% { background-position: -15% 5%; }
            30% { background-position: 7% -25%; }
            40% { background-position: 20% 25%; }
            50% { background-position: -25% 10%; }
            60% { background-position: 15% 5%; }
            70% { background-position: 0% 15%; }
            80% { background-position: 25% 35%; }
            90% { background-position: -10% 10%; }
          }
          
          @keyframes rgbSplitEffect {
            0%, 100% { background-blend-mode: screen; opacity: 0.1; }
            25% { background-blend-mode: difference; opacity: 0.15; }
            50% { background-blend-mode: exclusion; opacity: 0.1; }
            75% { background-blend-mode: hard-light; opacity: 0.05; }
          }
          
          @keyframes intenseGlitchEffect {
            0%, 100% { transform: translate(0) skewX(0); filter: none; }
            10% { transform: translate(-10px, 5px) skewX(20deg); filter: hue-rotate(90deg); }
            20% { transform: translate(10px, -5px) skewX(-15deg); filter: invert(0.5); }
            30% { transform: translate(-15px, 10px) skewX(5deg); filter: saturate(5); }
            40% { transform: translate(5px, -15px) skewX(-5deg); filter: hue-rotate(-90deg); }
            50% { transform: translate(0) skewX(0); filter: none; }
            60% { transform: translate(-5px, 5px) skewX(15deg); filter: brightness(2); }
            70% { transform: translate(15px, 10px) skewX(-10deg); filter: contrast(2); }
            80% { transform: translate(-5px, -5px) skewX(5deg); filter: blur(1px); }
            90% { transform: translate(10px, 0) skewX(-5deg); filter: hue-rotate(45deg); }
          }
          
          @keyframes buttonGlitch {
            0%, 100% { transform: translate(0); box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7; }
            10%, 90% { transform: translate(-2px, 1px); box-shadow: 0 0 8px #ff0000, 0 0 16px #ff0000; }
            20%, 80% { transform: translate(2px, -1px); box-shadow: 0 0 8px #00ffff, 0 0 16px #00ffff; }
            30%, 50%, 70% { transform: translate(-1px, -1px); box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7; }
            40%, 60% { transform: translate(1px, 1px); box-shadow: 0 0 3px #a855f7, 0 0 6px #a855f7; }
          }
          
          @keyframes typingRebootEffect {
            from { height: 0; }
            to { height: 100%; }
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
          
          .animate-intense-glitch {
            animation: intenseGlitchEffect 0.6s steps(8) infinite !important;
            transform-origin: center;
          }
          
          .animate-btn-glitch {
            animation: buttonGlitch 0.4s ease-in-out infinite !important;
          }
          
          .animate-rgb-split {
            animation: rgbSplit 6s infinite;
          }
          
          .animate-vertical-glitch {
            position: relative;
          }

          .bg-scanlines {
            background: repeating-linear-gradient(
              to bottom,
              transparent,
              transparent 1px,
              rgba(142, 56, 255, 0.2) 1px,
              rgba(142, 56, 255, 0.2) 2px
            );
            animation: scanlines 10s linear infinite;
            background-size: 100% 4px;
          }
          
          .noise-effect {
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.1'/%3E%3C/svg%3E");
            background-size: 200px;
            opacity: 0.3;
            animation: noiseAnimation 0.5s steps(5) infinite;
            mix-blend-mode: overlay;
          }
          
          .rgb-split-effect {
            background: linear-gradient(45deg, rgba(255,0,93,0.3), rgba(0,255,255,0.3), rgba(255,0,255,0.3));
            mix-blend-mode: screen;
            animation: rgbSplitEffect 0.5s alternate infinite;
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
          
          .animate-typing-reboot {
            overflow: hidden;
            white-space: nowrap;
            animation: typingRebootEffect 3s infinite 24s;
            line-height: 1.5rem;
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

          /* Extreme distortion effects */
          @keyframes extremeRgbShift {
            0% { transform: translateX(-10px); filter: hue-rotate(0deg); }
            25% { transform: translateX(15px); filter: hue-rotate(90deg); }
            50% { transform: translateX(-20px); filter: hue-rotate(180deg); }
            75% { transform: translateX(15px); filter: hue-rotate(270deg); }
            100% { transform: translateX(-10px); filter: hue-rotate(360deg); }
          }
          
          @keyframes verticalWarp {
            0% { transform: scaleY(1) translateY(0); }
            50% { transform: scaleY(1.5) translateY(-5px); }
            100% { transform: scaleY(1) translateY(0); }
          }
          
          @keyframes horizontalTear {
            0% { transform: translateX(0) skewX(0); }
            25% { transform: translateX(30px) skewX(15deg); }
            50% { transform: translateX(-30px) skewX(-15deg); }
            75% { transform: translateX(20px) skewX(10deg); }
            100% { transform: translateX(0) skewX(0); }
          }
          
          .extreme-distortion .vertical-lines-container {
            animation: verticalWarp 0.3s infinite;
          }
          
          .extreme-distortion .vertical-line {
            animation: verticalMove 0.3s linear infinite !important;
          }
          
          .extreme-distortion .horizontal-glitch-segments {
            animation: horizontalTear 0.2s infinite !important;
          }
          
          .extreme-distortion .rgb-split-effect {
            background: linear-gradient(45deg, 
              rgba(255,0,93,0.6), 
              rgba(0,255,255,0.6), 
              rgba(255,0,255,0.6)
            );
            animation: extremeRgbShift 0.2s infinite !important;
          }
          
          .horizontal-glitch-segments {
            position: relative;
            opacity: 0.7;
            mix-blend-mode: screen;
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

          .animate-ellipsis::after {
            content: '';
            animation: ellipsisAnimation 1.5s infinite steps(1);
            font-weight: bold;
            font-size: 110%;
            display: inline-block;
            min-width: 3ch;
            text-align: left;
          }

          /* Neon glow for diagonal lines */
          .neon-glow {
            filter: drop-shadow(0 0 5px #ec4899) drop-shadow(0 0 10px #ec4899);
            opacity: 0.9;
            animation: neonPulse 2s infinite;
          }

          /* Sequential neon trace effect */
          .neon-line-container {
            position: relative;
            overflow: hidden;
          }

          .neon-trace {
            position: absolute;
            top: -5px;
            bottom: -5px;
            width: 15px;
            background: linear-gradient(90deg, transparent, #ec4899, #ec4899, transparent);
            filter: blur(1px) drop-shadow(0 0 5px #ec4899) drop-shadow(0 0 8px #ec4899);
            border-radius: 3px;
            z-index: 1;
          }

          .neon-trace-1 {
            animation: traceFirst 3s linear infinite;
          }

          .neon-trace-2 {
            animation: traceSecond 3s linear infinite;
          }

          @keyframes traceFirst {
            0% { transform: translateX(-15px); opacity: 0; }
            15% { opacity: 1; }
            40% { transform: translateX(55px); opacity: 1; }
            41% { opacity: 0; }
            100% { transform: translateX(55px); opacity: 0; }
          }

          @keyframes traceSecond {
            0%, 40% { transform: translateX(-15px); opacity: 0; }
            41% { opacity: 0; }
            55% { opacity: 1; }
            80% { transform: translateX(45px); opacity: 1; }
            81% { opacity: 0; }
            100% { transform: translateX(45px); opacity: 0; }
          }

          /* Simplified intense neon pulse animations */
          .animate-neon-pulse-intense {
            box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899, 0 0 30px #ec4899;
            animation: intensePulse 2s infinite;
          }

          .animate-neon-pulse-intense-delayed {
            box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899, 0 0 30px #ec4899;
            animation: intensePulse 2s infinite 1s;
          }

          @keyframes intensePulse {
            0% { opacity: 1; box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899, 0 0 30px #ec4899; }
            50% { opacity: 0.3; box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899, 0 0 15px #ec4899; }
            100% { opacity: 1; box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899, 0 0 30px #ec4899; }
          }

          /* Glowing lines with dramatic animation */
          .glowing-line {
            background: linear-gradient(90deg, rgba(236,72,153,0.7), rgba(236,72,153,1), rgba(236,72,153,0.7));
            box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899;
            animation: glow-pulse 1.5s ease-in-out infinite;
          }

          .glowing-line-delayed {
            background: linear-gradient(90deg, rgba(236,72,153,0.7), rgba(236,72,153,1), rgba(236,72,153,0.7));
            box-shadow: 0 0 10px #ec4899, 0 0 20px #ec4899;
            animation: glow-pulse 1.5s ease-in-out infinite 0.75s;
          }

          @keyframes glow-pulse {
            0% { 
              opacity: 0.4;
              background-color: #be185d;
              box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899;
            }
            50% { 
              opacity: 1;
              background-color: #f472b6;
              box-shadow: 0 0 15px #ec4899, 0 0 25px #ec4899, 0 0 35px #ec4899; 
            }
            100% { 
              opacity: 0.4;
              background-color: #be185d; 
              box-shadow: 0 0 5px #ec4899, 0 0 10px #ec4899;
            }
          }

          @keyframes slide-in {
            from {
              right: -200px;
              opacity: 0;
            }
            to {
              right: 1.5rem;
              opacity: 1;
            }
          }
          
          .animate-slide-in {
            animation: slide-in 1.2s ease-out forwards 0.2s;
          }
        `}</style>

        {/* Footer Quote - Updated with larger size and text shadow for better visibility */}
        <div className="absolute bottom-8 w-full text-center text-xl md:text-2xl lg:text-3xl text-purple-200 font-mono" style={{ textShadow: '0 0 8px rgba(216, 180, 254, 0.7)' }}>
          "She guides. She educates. She protects."
        </div>
      </div>

      {/* Contact Email Button with proper blackout behavior */}
      {!rebootActive && (
        <div 
          key={`email-button-${emailButtonKey}`}
          className="fixed bottom-6 right-[-200px] animate-slide-in z-30 opacity-0"
        >
          <a 
            href="mailto:lexie@lexiecrypto.com" 
            className={`email-btn group bg-black text-purple-300 px-3 py-1.5 text-sm rounded-full font-medium shadow-lg transition-colors duration-300 border border-pink-500 flex items-center justify-center hover:bg-pink-200 hover:text-slate-900 hover:border-transparent ${glitchActive ? 'animate-btn-glitch' : ''}`}
            title="Email Lexie at lexie@lexiecrypto.com"
          >
            <span className="mr-1">✉️</span> Email Lexie
          </a>
        </div>
      )}

      <style jsx>{`
        .shadow-glow {
          box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
        }
        
        .email-btn {
          box-shadow: 0 0 5px #a855f7, 0 0 10px #a855f7;
        }
        
        .email-btn:hover {
          box-shadow: none;
        }
      `}</style>
    </main>
  );
}