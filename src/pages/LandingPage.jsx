import React, { useEffect, useState, useRef } from 'react';
import { Navbar } from '../components/Navbar';

export default function LandingPage() {
  const [bgLoaded, setBgLoaded] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [imageVisible, setImageVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [heroTerminalText, setHeroTerminalText] = useState('');
  const [heroTerminalIndex, setHeroTerminalIndex] = useState(0);
  const [mainTerminalText, setMainTerminalText] = useState('');
  const [mainTerminalLines, setMainTerminalLines] = useState([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [bootSequenceLines, setBootSequenceLines] = useState([]);
  const [bootCurrentLine, setBootCurrentLine] = useState(0);
  const [bootCurrentChar, setBootCurrentChar] = useState(0);
  const [bootIsTyping, setBootIsTyping] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const carouselRef = useRef(null);
  
  const scrollCarousel = () => {
    if (carouselRef.current) {
      const scrollAmount = 352; // Width of one card plus gap (320px + 32px)
      const container = carouselRef.current;
      const totalWidth = container.scrollWidth;
      const containerWidth = container.clientWidth;
      const originalSetWidth = totalWidth / 3; // Since we have 3 sets of cards
      
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
      
      // Update active card index
      const newIndex = (activeCardIndex + 1) % 3;
      setActiveCardIndex(newIndex);
      
      // Check if we've scrolled past the second set, reset to first set position
      setTimeout(() => {
        if (container.scrollLeft >= originalSetWidth * 2) {
          container.scrollLeft = originalSetWidth;
        }
      }, 300);
    }
  };

  const scrollCarouselLeft = () => {
    if (carouselRef.current) {
      const scrollAmount = 352; // Width of one card plus gap (320px + 32px)
      const container = carouselRef.current;
      const totalWidth = container.scrollWidth;
      const originalSetWidth = totalWidth / 3; // Since we have 3 sets of cards
      
      container.scrollBy({
        left: -scrollAmount,
        behavior: 'smooth'
      });
      
      // Update active card index
      const newIndex = (activeCardIndex - 1 + 3) % 3;
      setActiveCardIndex(newIndex);
      
      // Check if we've scrolled before the first set, reset to second set position
      setTimeout(() => {
        if (container.scrollLeft <= 0) {
          container.scrollLeft = originalSetWidth;
        }
      }, 300);
    }
  };

  const scrollToCard = (cardIndex) => {
    if (carouselRef.current) {
      const container = carouselRef.current;
      const cardWidth = 352; // Width of one card plus gap (320px + 32px)
      const cardsPerSet = 3; // Number of cards in each set
      const middleSetStart = cardWidth * cardsPerSet; // Start of middle set
      const targetPosition = middleSetStart + (cardIndex * cardWidth);
      
      container.scrollTo({
        left: targetPosition,
        behavior: 'smooth'
      });
      
      setActiveCardIndex(cardIndex);
    }
  };
  
  const heroTerminalLines = [
    '> Initializing AI Wallet Protocol...',
    '> Loading Neural Network...',
    '> Connecting to Web3...',
    '> Lexie is now online.',
  ];

  const productTerminalLines = [
    'root@lexie:~$ ./initialize_ai_protocols.sh',
    'Loading LexieAI Wallet v2.1.3...',
    'Neural network status: ONLINE',
    'Privacy protocols: ACTIVATED',
    '',
    'root@lexie:~$ show capabilities',
    'Auto-Airdrop Quester.........[ACTIVE]',
    'Smart DCA Engine..............[ACTIVE]', 
    'Guardian Consent Mode.........[ACTIVE]',
    'Dark Wallet Mode..............[ACTIVE]',
    'Alpha Loop Integration........[ACTIVE]',
    '',
    'root@lexie:~$ security_check',
    '✓ 256-bit AES encryption: ENABLED',
    '✓ Zero-knowledge proofs: ENABLED', 
    '✓ Key sharding: ENABLED',
    'Security status: MAXIMUM',
    '',
    'root@lexie:~$ portfolio_analysis',
    'Total assets protected: $2.4M+',
    'Success rate: 96.7%',
    'Profit optimization: +127.45%',
    '',
    'root@lexie:~$ echo "Ready for Web3 domination"',
    'Ready for Web3 domination',
    'root@lexie:~$ _'
  ];

  const bootSequenceTerminalLines = [
    'LEXIEAI SYSTEM BOOT v2.1.3',
    'Initializing neural networks...',
    '✓ Core systems loaded',
    '✓ Security protocols active',
    '✓ Web3 interfaces ready',
    '✓ AI companion online',
    'ALL SYSTEMS OPERATIONAL',
    'Ready for commands...'
  ];
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Preload background
    const bgImg = new Image();
    bgImg.src = '/background.png';
    bgImg.onload = () => {
      setBgLoaded(true);
      setTimeout(() => setContentVisible(true), 300);
      setTimeout(() => setImageVisible(true), 800); // 300ms + 500ms delay
    };
    
    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);
  
  // Hero terminal typewriter effect
  useEffect(() => {
    if (contentVisible && heroTerminalIndex < heroTerminalLines.length) {
      const currentLine = heroTerminalLines[heroTerminalIndex];
      let charIndex = 0;
      
      const typeInterval = setInterval(() => {
        if (charIndex <= currentLine.length) {
          setHeroTerminalText(prev => prev + currentLine[charIndex]);
          charIndex++;
        } else {
          clearInterval(typeInterval);
          setTimeout(() => {
            setHeroTerminalText(prev => prev + '\n');
            setHeroTerminalIndex(prev => prev + 1);
          }, 300);
        }
      }, 30);
      
      return () => clearInterval(typeInterval);
    }
  }, [contentVisible, heroTerminalIndex]);

  // Boot sequence typewriter effect (starts after distortion effects)
  useEffect(() => {
    if (!imageVisible) return;
    
    // Start boot sequence after distortion effects (500ms after image appears)
    const startDelay = setTimeout(() => {
      setBootIsTyping(true);
    }, 500);
      
    return () => clearTimeout(startDelay);
  }, [imageVisible]);

  useEffect(() => {
    if (!bootIsTyping || bootCurrentLine >= bootSequenceTerminalLines.length) return;

    const currentLine = bootSequenceTerminalLines[bootCurrentLine];
    
    if (bootCurrentChar <= currentLine.length) {
      const typeInterval = setInterval(() => {
        setBootSequenceLines(prev => {
          const newLines = [...prev];
          if (newLines.length <= bootCurrentLine) {
            newLines.push('');
          }
          newLines[bootCurrentLine] = currentLine.slice(0, bootCurrentChar + 1);
          return newLines;
        });
        setBootCurrentChar(prev => prev + 1);
      }, 15); // Speed of typing - faster

      const cleanup = setTimeout(() => {
        clearInterval(typeInterval);
      }, (currentLine.length + 1) * 15);

      return () => {
        clearInterval(typeInterval);
        clearTimeout(cleanup);
      };
    } else {
      // Line complete, move to next after delay
      const nextLineDelay = setTimeout(() => {
        setBootCurrentLine(prev => prev + 1);
        setBootCurrentChar(0);
      }, 200);

      return () => clearTimeout(nextLineDelay);
    }
  }, [bootIsTyping, bootCurrentLine, bootCurrentChar, bootSequenceTerminalLines]);

  // Main terminal typewriter effect
  useEffect(() => {
    if (!contentVisible) return;
    
    // Start main terminal after a delay
    const startDelay = setTimeout(() => {
      setIsTyping(true);
      }, 2000);
      
    return () => clearTimeout(startDelay);
  }, [contentVisible]);

  // Initialize carousel position for infinite scroll
  useEffect(() => {
    if (carouselRef.current && contentVisible) {
      // Set initial position to show Predictive Intelligence (first card of middle set) flush left
      const container = carouselRef.current;
      const cardWidth = 352; // Width of one card plus gap (320px card + 32px gap)
      const cardsPerSet = 3; // Number of cards in each set
      const initialOffset = cardWidth * cardsPerSet; // Start of middle set where Predictive Intelligence is
      
      setTimeout(() => {
        container.scrollLeft = initialOffset;
      }, 100);
    }
  }, [contentVisible]);

  useEffect(() => {
    if (!isTyping || currentLineIndex >= productTerminalLines.length) return;

    const currentLine = productTerminalLines[currentLineIndex];
    
    if (currentLine === '') {
      // Empty line, move to next immediately
      setMainTerminalLines(prev => [...prev, '']);
      setCurrentLineIndex(prev => prev + 1);
      setCurrentCharIndex(0);
      return;
    }

    if (currentCharIndex <= currentLine.length) {
      const typeInterval = setInterval(() => {
        setMainTerminalLines(prev => {
          const newLines = [...prev];
          if (newLines.length <= currentLineIndex) {
            newLines.push('');
          }
          newLines[currentLineIndex] = currentLine.slice(0, currentCharIndex + 1);
          return newLines;
        });
        setCurrentCharIndex(prev => prev + 1);
      }, currentLine.startsWith('root@lexie:~$') ? 60 : 20);

      const cleanup = setTimeout(() => {
        clearInterval(typeInterval);
      }, (currentLine.length + 1) * (currentLine.startsWith('root@lexie:~$') ? 60 : 20));

      return () => {
        clearInterval(typeInterval);
        clearTimeout(cleanup);
      };
    } else {
      // Line complete, move to next after delay
      const nextLineDelay = setTimeout(() => {
        setCurrentLineIndex(prev => prev + 1);
        setCurrentCharIndex(0);
      }, currentLine.includes('$') ? 500 : 150);

      return () => clearTimeout(nextLineDelay);
    }
  }, [isTyping, currentLineIndex, currentCharIndex, productTerminalLines]);
  
  return (
    <>
      {/* Navigation */}
      <Navbar />

      <main className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
        {/* Loading overlay */}
        <div className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${bgLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="text-purple-300 text-2xl font-mono">
            Loading<span className="animate-pulse">...</span>
          </div>
        </div>
        
        {/* Enhanced Cyberpunk Background */}
        <div className="fixed inset-0 z-0">
          {/* Base gradient layers */}
          <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
          
          {/* Futuristic cityscape silhouette */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
          <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
          
          {/* Dynamic grid system */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>


            
          {/* Subtle ambient orbs */}
          <div className="absolute inset-0 overflow-hidden">
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


      {/* Hero Section */}
      <section className="relative z-30 min-h-screen flex items-center justify-center">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            
            {/* Left side - Text content */}
            <div className="space-y-8">
              {/* Main headline */}
              <div className="space-y-4">
                <h1 className="text-5xl lg:text-7xl font-bold leading-tight">
                  <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                    Lexie:
                  </span>
                  <br />
                  <span className="text-white">
                    Your AI Companion
                  </span>
                  <br />
                  <span className="text-purple-300">
                    for Web3
                  </span>
            </h1>
                
                <p className="text-xl text-gray-300 max-w-lg">
                  Trade smarter. Quest deeper. Stay private.
                </p>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="https://t.me/lexie_crypto_bot"
              target="_blank"
              rel="noopener noreferrer"
                  className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 shadow-lg hover:shadow-purple-500/25 hover:scale-105 text-center"
            >
                  Join Telegram
            </a>
            <a
                  href="https://forms.gle/sbTJFRccd14qJLPEA"
              target="_blank"
              rel="noopener noreferrer"
                  className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-cyan-700 transition-all duration-300 shadow-lg hover:shadow-blue-500/25 hover:scale-105 text-center"
            >
                  Join Beta
            </a>
            <a
                    href="https://x.com/0xLexieAI"
              target="_blank"
              rel="noopener noreferrer"
                    className="px-8 py-4 border-2 border-purple-500 text-purple-300 font-semibold rounded-lg hover:bg-purple-500 hover:text-white transition-all duration-300 hover:scale-105 text-center animate-twitter-flicker"
            >
                    Join Twitter
            </a>
          </div>
        </div>

            {/* Right side - Lexie Avatar */}
            <div className="relative flex justify-center">
              {/* Terminal-style Background Frame */}
              <div className="relative bg-gray-900 rounded-lg border border-gray-700 shadow-2xl overflow-hidden max-w-lg w-full">
                {/* Terminal Header */}
                <div className="flex items-center justify-between bg-gray-800 px-4 py-3 border-b border-gray-700">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-gray-400 ml-4 font-mono text-sm">lexie-ai</span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-green-400 text-xs font-mono">ONLINE</span>
                    </div>
                  </div>
                </div>
          
                {/* Terminal Body with Avatar */}
                                <div className="bg-black px-8 pt-4 pb-0 relative h-90 flex items-center justify-center">
                  {/* Boot sequence terminal text - top left */}
                  <div className={`absolute top-4 left-4 font-mono text-xs text-green-400 pointer-events-none z-0 transition-opacity duration-1000 ${imageVisible ? 'opacity-80' : 'opacity-0'}`}>
                    {bootSequenceLines.map((line, index) => (
                      <div 
                        key={index} 
                        className={`mb-1 ${
                          line.startsWith('✓') ? 'text-green-300' : 
                          line.includes('OPERATIONAL') ? 'text-green-300 font-bold' : 
                          line.includes('BOOT') ? 'text-green-500' :    
                          'text-green-400'
                        }`}
                      >
                        {line}
                                                  {/* Show blinking cursor at end of "Ready for commands..." */}
                          {line === 'Ready for commands...' && (
                            <span className="text-green-300 animate-pulse" style={{animationDuration: '2s', fontSize: '9px'}}>█</span>
                          )}
                      </div>
                    ))}
                    {bootIsTyping && bootCurrentLine < bootSequenceTerminalLines.length && (
                      <span className="animate-pulse text-green-300">█</span>
                    )}
                  </div>
  
                  <div className="pixel-distortion-container">
                    <img
                      src="/lexie.png"
                      alt="LexieAI Avatar"
                      className={`relative z-10 h-full w-auto mx-auto object-contain transition-opacity duration-1000 ${imageVisible ? 'opacity-100' : 'opacity-0'}`}
                    />
                    
                    {/* Horizontal glitch overlay */}
                    <div className="absolute inset-0 horizontal-glitch-overlay pointer-events-none">
                      {/* Intense horizontal displacement lines */}
                      {Array.from({ length: 15 }).map((_, i) => (
                        <div 
                          key={i}
                          className="absolute w-full horizontal-glitch-line"
                          style={{
                            height: `${Math.random() * 8 + 2}px`,
                            top: `${i * 6.67}%`,
                            background: `rgba(255, 255, 255, ${0.4 + Math.random() * 0.4})`,
                            transform: `translateX(${(Math.random() * 60 - 30)}px)`,
                            animationDelay: `${i * 0.05}s`,
                            filter: `blur(${Math.random() * 0.5}px)`
                          }}
                        />
                      ))}
                      
                      {/* Additional chaotic lines */}
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div 
                          key={`chaos-${i}`}
                          className="absolute w-full chaos-glitch-line"
                          style={{
                            height: `${Math.random() * 4 + 1}px`,
                            top: `${Math.random() * 100}%`,
                            background: `rgba(255, 255, 255, ${0.3 + Math.random() * 0.5})`,
                            transform: `translateX(${(Math.random() * 80 - 40)}px) skewX(${Math.random() * 10 - 5}deg)`,
                            animationDelay: `${i * 0.08}s`
                          }}
                        />
                      ))}
                      
                      {/* Intense RGB channel separation */}
                      <div className="absolute inset-0 rgb-glitch-lines"></div>
                      <div className="absolute inset-0 rgb-glitch-intense"></div>
                    </div>
                  </div>
                  
                  {/* Holographic effect */}
                  <div className="absolute inset-0 bg-gradient-to-t from-purple-500/20 via-transparent to-blue-500/20 blur-sm"></div>
                </div>

                {/* Terminal Footer */}
                <div className="bg-gray-800 px-4 py-2 border-t border-gray-700">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center space-x-4">
                      <span>Process: lexie-avatar</span>
                      <span>•</span>
                      <span>Status: Active</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-green-400">Connected</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Terminal Section */}
      <section className="relative z-30 py-20 bg-gradient-to-b from-black via-gray-900/50 to-black">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4">
              Watch Lexie in <span className="text-purple-400">Action</span>
            </h2>
            <p className="text-lg text-gray-300 max-w-2xl mx-auto">
              See how Lexie's AI protocols work behind the scenes to protect and optimize your Web3 experience
            </p>
          </div>

          {/* Main Terminal */}
          <div className="relative bg-gray-900 rounded-lg border border-gray-700 shadow-2xl overflow-hidden">
            {/* Terminal Header */}
            <div className="flex items-center justify-between bg-gray-800 px-4 py-3 border-b border-gray-700">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-gray-400 ml-4 font-mono text-sm">lexie-ai-terminal</span>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-green-400 text-xs font-mono">ONLINE</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <span className="text-blue-400 text-xs font-mono">SECURE</span>
                </div>
              </div>
            </div>

            {/* Terminal Body */}
            <div className="bg-black p-6 font-mono text-sm leading-relaxed h-[480px] overflow-hidden">
              <div className="text-green-400">
                {mainTerminalLines.map((line, index) => (
                  <div key={index} className="mb-1">
                    {line.startsWith('root@lexie:~$') ? (
                      <div className="text-green-400">
                        <span className="text-green-300">root@lexie</span>
                        <span className="text-green-400">:</span>
                        <span className="text-green-300">~</span>
                        <span className="text-green-400">$ </span>
                        <span className="text-green-200">{line.replace('root@lexie:~$ ', '')}</span>
                      </div>
                    ) : line.startsWith('✓') ? (
                      <div className="text-green-300">{line}</div>
                    ) : line.includes('ACTIVE') ? (
                      <div>
                        <span className="text-green-500">{line.split('[')[0]}</span>
                        <span className="text-green-300 font-semibold">[ACTIVE]</span>
                      </div>
                    ) : line.includes('ENABLED') ? (
                      <div className="text-green-300">{line}</div>
                    ) : line.includes('ONLINE') ? (
                      <div>
                        <span className="text-green-500">{line.split(':')[0]}:</span>
                        <span className="text-green-300 font-semibold"> ONLINE</span>
                      </div>
                    ) : line.includes('ACTIVATED') ? (
                      <div>
                        <span className="text-green-500">{line.split(':')[0]}:</span>
                        <span className="text-green-300 font-semibold"> ACTIVATED</span>
                      </div>
                    ) : line.includes('MAXIMUM') ? (
                      <div>
                        <span className="text-green-500">{line.split(':')[0]}:</span>
                        <span className="text-green-300 font-semibold"> MAXIMUM</span>
                      </div>
                    ) : line.includes('$') && line.includes('M') ? (
                      <div className="text-green-200">{line}</div>
                    ) : line.includes('%') ? (
                      <div className="text-green-200">{line}</div>
                    ) : line.includes('LOW') ? (
                      <div>
                        <span className="text-green-500">{line.split(':')[0]}:</span>
                        <span className="text-green-300 font-semibold"> LOW</span>
                      </div>
                    ) : line === 'Ready for Web3 domination' ? (
                      <div className="text-green-200 font-semibold">{line}</div>
                    ) : line.startsWith('Loading') || line.startsWith('Connecting') || line.startsWith('Checking') || line.startsWith('Analyzing') ? (
                      <div className="text-green-400">{line}</div>
                    ) : (
                      <div className="text-green-500">{line}</div>
                    )}
                  </div>
                ))}
                {isTyping && currentLineIndex < productTerminalLines.length && (
                  <span className="animate-pulse text-green-300">█</span>
                )}
              </div>
            </div>

            {/* Terminal Footer */}
            <div className="bg-gray-800 px-4 py-2 border-t border-gray-700">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <div className="flex items-center space-x-4">
                  <span>Process: lexie-ai-core</span>
                  <span>•</span>
                  <span>Memory: 2.1GB</span>
                  <span>•</span>
                  <span>CPU: 12%</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span>Lines: {mainTerminalLines.length}</span>
                  <span>•</span>
                  <span className="text-green-400">Connected</span>
                </div>
              </div>
            </div>
          </div>

          {/* Terminal Description */}
          <div className="mt-8 text-center">
            <p className="text-gray-400 max-w-3xl mx-auto">
              This is a live simulation of Lexie's AI protocols. In the real application, these processes run continuously 
              to analyze markets, execute trades, maintain security, and optimize your Web3 portfolio.
            </p>
          </div>
        </div>
      </section>

      {/* Advanced AI Wallet Features Section */}
      <section id="features" className="relative z-30 py-32 overflow-hidden">
        {/* Section Background */}
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 via-black/50 to-blue-900/10"></div>
        


        <div className="max-w-7xl mx-auto px-6 relative">
          {/* Section Header */}
          <div className="text-center mb-20">
            <h2 className="text-5xl lg:text-7xl font-bold text-white mb-6">
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                LEXIE PLATFORM
              </span>
            </h2>
          </div>

          {/* Feature Panels Container with External Navigation */}
          <div className="relative flex items-center">
            {/* Scroll Left Arrow - External - Hidden on Mobile */}
            <div className="hidden md:flex flex-shrink-0 mr-6">
              <button 
                onClick={scrollCarouselLeft}
                className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm border border-purple-500/40 rounded-full px-4 py-2 hover:border-purple-500/80 hover:bg-purple-500/20 transition-all duration-300 cursor-pointer group"
              >
                <svg className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span className="text-purple-300 text-sm font-mono group-hover:text-purple-200">SCROLL</span>
              </button>
            </div>
            
            {/* Carousel Container */}
            <div className="flex-1 overflow-hidden">
              <div ref={carouselRef} className="flex space-x-4 md:space-x-8 pb-8 overflow-x-auto scrollbar-hide snap-x snap-mandatory" style={{scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch'}}>
                {/* Create three sets of cards for infinite scroll */}
                {[...Array(3)].map((_, setIndex) => {
                  const features = [
                {
                  title: "LexieVault",
                  missionType: "VAULT_PROTOCOL",
                  description: "zk-secured, non-custodial vault for shielding, sending, and receiving assets with gasless transactions and full on-chain confidentiality",
                  icon: "🛡️",
                  color: "purple",
                  status: "SECURE",
                  efficiency: "100%"
                },
                {
                  title: "LexieChat",
                  missionType: "AI_ANALYST",
                  description: "AI-powered crypto analyst that provides real-time prices, news, and technical analysis with optional Degen Mode for unfiltered alpha",
                  icon: "🤖",
                  color: "blue",
                  status: "ANALYZING",
                  efficiency: "97.3%"
                },
                {
                  title: "LexieTitans",
                  missionType: "GAMING_PROTOCOL",
                  description: "Tap-to-earn Web3 game where you charge Titans, complete quests, earn points, and climb leaderboards for rewards",
                  icon: "⚔️",
                  color: "yellow",
                  status: "ACTIVE",
                  efficiency: "95.8%"
                }
                  ];
                  
                  return features.map((feature, index) => (
                <div
                  key={`${setIndex}-${index}`}
                  className="group relative flex-shrink-0 w-72 sm:w-80 h-80 sm:h-96 snap-center"
                  style={{ animationDelay: `${index * 0.2}s` }}
                >
                  {/* Main Panel */}
                  <div className="relative h-full bg-black/60 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4 sm:p-6 overflow-hidden transition-all duration-500 hover:border-purple-500/80 hover:shadow-2xl hover:shadow-purple-500/25 sm:group-hover:scale-105">
                    
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-purple-500/5 via-transparent to-purple-500/10"></div>
                    
                    {/* Panel Header */}
                    <div className="relative z-10 flex items-center justify-between mb-3 sm:mb-4">
                      <div className="text-2xl sm:text-3xl p-1.5 sm:p-2 rounded-lg bg-purple-500/20">
                        {feature.icon}
                      </div>
                      <div className="px-2 py-1 rounded text-xs font-mono border border-purple-500/40 bg-purple-500/20 text-purple-300">
                        {feature.status}
                      </div>
                    </div>

                    {/* Mission Type */}
                    <div className="relative z-10 mb-2 sm:mb-3">
                      <div className="text-xs font-mono text-gray-500 mb-1">// MISSION_TYPE:</div>
                      <div className="font-mono font-semibold text-xs sm:text-sm tracking-wider text-purple-300">
                        {feature.missionType}
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className="relative z-10 text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4 group-hover:text-purple-300 transition-colors duration-300">
                      {feature.title}
                    </h3>

                    {/* Description */}
                    <p className="relative z-10 text-gray-300 text-xs sm:text-sm leading-relaxed mb-4 sm:mb-6 group-hover:text-gray-100 transition-colors duration-300">
                      {feature.description}
                    </p>

                    {/* Efficiency Meter */}
                    <div className="relative z-10 mt-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-500">EFFICIENCY</span>
                        <span className="text-xs font-mono text-purple-400">{feature.efficiency}</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-1.5">
                        <div 
                          className="h-1.5 bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-1000 group-hover:animate-pulse"
                          style={{ width: feature.efficiency }}
                        ></div>
                      </div>
                    </div>

                    {/* Corner Accents */}
                    <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-purple-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-purple-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-purple-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-purple-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  </div>

                  {/* Floating Connection Lines */}
                  <div className="absolute -bottom-4 left-1/2 w-px h-8 bg-gradient-to-b from-purple-500/50 to-transparent transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </div>
                  ));
                }).flat()}
              </div>
            </div>
            
            {/* Scroll Right Arrow - External - Hidden on Mobile */}
            <div className="hidden md:flex flex-shrink-0 ml-6">
              <button 
                onClick={scrollCarousel}
                className="flex items-center space-x-2 bg-black/80 backdrop-blur-sm border border-purple-500/40 rounded-full px-4 py-2 hover:border-purple-500/80 hover:bg-purple-500/20 transition-all duration-300 cursor-pointer group"
              >
                <span className="text-purple-300 text-sm font-mono group-hover:text-purple-200">SCROLL</span>
                <svg className="w-5 h-5 text-purple-400 group-hover:text-purple-300 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Navigation Dots - Hidden on Mobile */}
          <div className="hidden md:flex justify-center space-x-2 mt-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <button
                key={i}
                onClick={() => scrollToCard(i)}
                className={`w-2 h-2 rounded-full transition-all duration-300 cursor-pointer hover:scale-125 ${
                  activeCardIndex === i 
                    ? 'bg-purple-400 w-3 h-3' 
                    : 'bg-purple-500/40 hover:bg-purple-400'
                }`}
                aria-label={`Go to card ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Tokenomics Section */}
      <section className="relative z-30 py-20 bg-gradient-to-b from-black via-purple-900/10 to-black">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6">
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                $LEXIE Tokenomics
              </span>
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Strategic token allocation designed for long-term sustainability and community growth
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Cyberpunk Pie Chart */}
            <div className="relative">
              <div className="relative w-full max-w-md mx-auto">
                <svg viewBox="0 0 400 400" className="w-full h-full drop-shadow-2xl">
                  {/* Background glow */}
                  <defs>
                    {/* Gradients for each slice */}
                    <radialGradient id="seedGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#ff6b6b" />
                      <stop offset="100%" stopColor="#ee5a52" />
                    </radialGradient>
                    <radialGradient id="strategicGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#4ecdc4" />
                      <stop offset="100%" stopColor="#44a08d" />
                    </radialGradient>
                    <radialGradient id="publicGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#45b7d1" />
                      <stop offset="100%" stopColor="#96ceb4" />
                    </radialGradient>
                    <radialGradient id="kolGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#feca57" />
                      <stop offset="100%" stopColor="#ff9ff3" />
                    </radialGradient>
                    <radialGradient id="partnersGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#ff9ff3" />
                      <stop offset="100%" stopColor="#f368e0" />
                    </radialGradient>
                    <radialGradient id="teamGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#54a0ff" />
                      <stop offset="100%" stopColor="#5f27cd" />
                    </radialGradient>
                    <radialGradient id="stakingGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#00d2d3" />
                      <stop offset="100%" stopColor="#54a0ff" />
                    </radialGradient>
                    <radialGradient id="exchangeGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#ff9f43" />
                      <stop offset="100%" stopColor="#ee5a24" />
                    </radialGradient>
                    <radialGradient id="treasuryGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#00d2d3" />
                      <stop offset="100%" stopColor="#3c40c6" />
                    </radialGradient>
                    <radialGradient id="marketingGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#fd79a8" />
                      <stop offset="100%" stopColor="#e84393" />
                    </radialGradient>
                    <radialGradient id="liquidityGradient" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#a29bfe" />
                      <stop offset="100%" stopColor="#6c5ce7" />
                    </radialGradient>

                    {/* Glow filters */}
                    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                      <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Pie slices with cyberpunk styling */}
                  <g transform="translate(200,200)">
                    {/* Seed - 6.10% */}
                    <path
                      d="M 0,0 L 150,0 A 150,150 0 0,1 147.9,-26.1 z"
                      fill="url(#seedGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Strategic - 5.61% */}
                    <path
                      d="M 147.9,-26.1 A 150,150 0 0,1 139.7,-58.7 z"
                      fill="url(#strategicGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Public - 10.00% */}
                    <path
                      d="M 139.7,-58.7 A 150,150 0 0,1 112.5,-112.5 z"
                      fill="url(#publicGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* KOL - 3.00% */}
                    <path
                      d="M 112.5,-112.5 A 150,150 0 0,1 93.3,-129.9 z"
                      fill="url(#kolGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Partners & Advisors - 4.00% */}
                    <path
                      d="M 93.3,-129.9 A 150,150 0 0,1 56.7,-143.3 z"
                      fill="url(#partnersGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Team - 10.00% */}
                    <path
                      d="M 56.7,-143.3 A 150,150 0 0,1 -56.7,-143.3 z"
                      fill="url(#teamGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Staking - 3.00% */}
                    <path
                      d="M -56.7,-143.3 A 150,150 0 0,1 -93.3,-129.9 z"
                      fill="url(#stakingGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Exchange Listings - 3.00% */}
                    <path
                      d="M -93.3,-129.9 A 150,150 0 0,1 -112.5,-112.5 z"
                      fill="url(#exchangeGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Treasury - 16.29% */}
                    <path
                      d="M -112.5,-112.5 A 150,150 0 0,1 -150,0 z"
                      fill="url(#treasuryGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Marketing - 19.00% */}
                    <path
                      d="M -150,0 A 150,150 0 0,1 -139.7,58.7 z"
                      fill="url(#marketingGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Liquidity - 20.0% */}
                    <path
                      d="M -139.7,58.7 A 150,150 0 0,1 150,0 z"
                      fill="url(#liquidityGradient)"
                      filter="url(#glow)"
                      className="hover:opacity-80 transition-opacity duration-300 cursor-pointer"
                    />

                    {/* Center circle with glow */}
                    <circle cx="0" cy="0" r="60" fill="black" stroke="rgba(147,51,234,0.3)" strokeWidth="2"/>
                    <circle cx="0" cy="0" r="50" fill="url(#liquidityGradient)" filter="url(#glow)"/>
                    <text x="0" y="-5" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" className="font-mono">$LEXIE</text>
                    <text x="0" y="10" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="10" className="font-mono">TOTAL</text>
                    <text x="0" y="22" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" className="font-mono">350M</text>
                  </g>

                  {/* Animated scanning lines */}
                  <g className="animate-pulse">
                    <line x1="50" y1="200" x2="350" y2="200" stroke="rgba(147,51,234,0.3)" strokeWidth="1" opacity="0.5"/>
                    <line x1="200" y1="50" x2="200" y2="350" stroke="rgba(59,130,246,0.3)" strokeWidth="1" opacity="0.5"/>
                  </g>
                </svg>

                {/* Legend */}
                <div className="mt-8 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-red-400 to-red-600"></div>
                      <span className="text-gray-300 font-mono">Seed (6.10%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-teal-400 to-teal-600"></div>
                      <span className="text-gray-300 font-mono">Strategic (5.61%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-400 to-green-400"></div>
                      <span className="text-gray-300 font-mono">Public (10.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-yellow-400 to-pink-400"></div>
                      <span className="text-gray-300 font-mono">KOL (3.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-pink-400 to-purple-500"></div>
                      <span className="text-gray-300 font-mono">Partners (4.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-blue-400 to-purple-600"></div>
                      <span className="text-gray-300 font-mono">Team (10.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-400"></div>
                      <span className="text-gray-300 font-mono">Staking (3.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-orange-400 to-red-500"></div>
                      <span className="text-gray-300 font-mono">Exchange (3.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-600"></div>
                      <span className="text-gray-300 font-mono">Treasury (16.29%)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-pink-400 to-red-500"></div>
                      <span className="text-gray-300 font-mono">Marketing (19.00%)</span>
                    </div>
                    <div className="flex items-center space-x-2 col-span-2 justify-center">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-purple-400 to-purple-600"></div>
                      <span className="text-gray-300 font-mono">Liquidity (20.00%)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tokenomics Table */}
            <div className="space-y-6">
              <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <h3 className="text-xl font-semibold text-white mb-4 text-center">Token Allocation Details</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-purple-500/30">
                        <th className="text-left py-2 px-3 text-purple-300 font-mono">Allocation</th>
                        <th className="text-center py-2 px-3 text-purple-300 font-mono">% of Supply</th>
                        <th className="text-right py-2 px-3 text-purple-300 font-mono">Tokens</th>
                        <th className="text-center py-2 px-3 text-purple-300 font-mono">TGE %</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-300">
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Seed</td>
                        <td className="text-center py-2 px-3 font-mono">6.10%</td>
                        <td className="text-right py-2 px-3 font-mono">21,363,636</td>
                        <td className="text-center py-2 px-3 font-mono text-green-400">4.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Strategic</td>
                        <td className="text-center py-2 px-3 font-mono">5.61%</td>
                        <td className="text-right py-2 px-3 font-mono">19,642,850</td>
                        <td className="text-center py-2 px-3 font-mono text-green-400">10.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Public</td>
                        <td className="text-center py-2 px-3 font-mono">10.00%</td>
                        <td className="text-right py-2 px-3 font-mono">35,000,000</td>
                        <td className="text-center py-2 px-3 font-mono text-green-400">25.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">KOL</td>
                        <td className="text-center py-2 px-3 font-mono">3.00%</td>
                        <td className="text-right py-2 px-3 font-mono">10,500,000</td>
                        <td className="text-center py-2 px-3 font-mono text-green-400">50.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Partners & Advisors</td>
                        <td className="text-center py-2 px-3 font-mono">4.00%</td>
                        <td className="text-right py-2 px-3 font-mono">21,000,000</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Team</td>
                        <td className="text-center py-2 px-3 font-mono">10.00%</td>
                        <td className="text-right py-2 px-3 font-mono">35,000,000</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Staking</td>
                        <td className="text-center py-2 px-3 font-mono">3.00%</td>
                        <td className="text-right py-2 px-3 font-mono">10,500,000</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Exchange Listings</td>
                        <td className="text-center py-2 px-3 font-mono">3.00%</td>
                        <td className="text-right py-2 px-3 font-mono">10,500,000</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Treasury</td>
                        <td className="text-center py-2 px-3 font-mono">16.29%</td>
                        <td className="text-right py-2 px-3 font-mono">50,000,000</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="border-b border-gray-800/50 hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono">Marketing</td>
                        <td className="text-center py-2 px-3 font-mono">19.00%</td>
                        <td className="text-right py-2 px-3 font-mono">66,493,514</td>
                        <td className="text-center py-2 px-3 font-mono text-red-400">0.0%</td>
                      </tr>
                      <tr className="hover:bg-purple-500/10 transition-colors">
                        <td className="py-2 px-3 font-mono font-bold text-purple-300">Liquidity</td>
                        <td className="text-center py-2 px-3 font-mono font-bold text-purple-300">20.00%</td>
                        <td className="text-right py-2 px-3 font-mono font-bold text-purple-300">70,000,000</td>
                        <td className="text-center py-2 px-3 font-mono font-bold text-green-400">20.0%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Token Info Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4">
                  <div className="text-center">
                    <div className="text-2xl mb-2">💰</div>
                    <h4 className="font-semibold text-white mb-2">Total Supply</h4>
                    <div className="text-2xl font-bold text-purple-400">350,000,000</div>
                    <div className="text-sm text-gray-400">$LEXIE Tokens</div>
                  </div>
                </div>
                <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4">
                  <div className="text-center">
                    <div className="text-2xl mb-2">🚀</div>
                    <h4 className="font-semibold text-white mb-2">TGE Unlock</h4>
                    <div className="text-2xl font-bold text-green-400">22.1%</div>
                    <div className="text-sm text-gray-400">Available at Launch</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Lexie Section */}
      <section className="relative z-30 py-20 bg-gradient-to-r from-purple-900/20 to-blue-900/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <h2 className="text-4xl lg:text-5xl font-bold text-white">
                Why <span className="text-purple-400">Lexie</span>?
              </h2>
              <div className="space-y-4 text-lg text-gray-300">
                <p>
                  The fusion of AI and Web3 isn't just the future—it's happening now. 
                  Lexie represents the next evolution of decentralized finance, where 
                  artificial intelligence doesn't replace human decision-making but 
                  amplifies it exponentially.
                </p>
                <p>
                  While others build simple trading bots, we're crafting an intelligent 
                  companion that understands the nuances of DeFi, learns from market 
                  patterns, and protects your assets with military-grade security.
                </p>
              </div>
              
              {/* Live UI elements */}
              <div className="space-y-3">
                <div className="flex items-center space-x-3 text-green-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="font-mono text-sm">Neural network: ACTIVE</span>
                </div>
                <div className="flex items-center space-x-3 text-blue-400">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                  <span className="font-mono text-sm">Market analysis: RUNNING</span>
                </div>
                <div className="flex items-center space-x-3 text-purple-400">
                  <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                  <span className="font-mono text-sm">Privacy protocols: ENABLED</span>
                </div>
              </div>
            </div>

            {/* Code logs simulation */}
            <div className="bg-black/60 border border-purple-500/30 rounded-lg p-6 font-mono text-sm">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-gray-400 ml-2">ai.logs</span>
              </div>
              <div className="space-y-2 text-green-400">
                <div className="flex items-center space-x-2">
                  <span className="text-green-600">[12:34:56]</span>
                  <span className="text-green-400">Analyzing 47 DEX pools...</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-600">[12:34:57]</span>
                  <span className="text-green-300">Best route found: 0.23% slippage</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-600">[12:34:58]</span>
                  <span className="text-green-200">Executing trade...</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-600">[12:34:59]</span>
                  <span className="text-green-300">Transaction confirmed ✓</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-green-600">[12:35:00]</span>
                  <span className="text-green-200">Profit: +$127.45 (+3.2%)</span>
                </div>
                <div className="flex items-center space-x-2 animate-pulse">
                  <span className="text-green-600">[12:35:01]</span>
                  <span className="text-green-400">Scanning for next opportunity...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security & Privacy Section */}
      <section id="security" className="relative z-30 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-4">
              Security & <span className="text-purple-400">Privacy First</span>
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Your assets and privacy are protected by cutting-edge cryptographic protocols 
              and zero-knowledge architectures
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8 text-center hover:border-purple-500/60 transition-all duration-300">
              <div className="text-4xl mb-4">🔐</div>
              <h3 className="text-xl font-semibold text-white mb-3">Zero-Knowledge Transactions</h3>
              <p className="text-gray-300">
                Complete transaction privacy using advanced ZK-proofs. Your trading history 
                remains invisible to everyone, including us.
              </p>
            </div>

            <div className="bg-black/40 backdrop-blur-sm border border-blue-500/30 rounded-xl p-8 text-center hover:border-blue-500/60 transition-all duration-300">
              <div className="text-4xl mb-4">🔑</div>
              <h3 className="text-xl font-semibold text-white mb-3">Key Sharding</h3>
              <p className="text-gray-300">
                Your private keys are sharded across multiple secure enclaves. No single point 
                of failure, maximum security.
              </p>
            </div>

            <div className="bg-black/40 backdrop-blur-sm border border-green-500/30 rounded-xl p-8 text-center hover:border-green-500/60 transition-all duration-300">
              <div className="text-4xl mb-4">🛡️</div>
              <h3 className="text-xl font-semibold text-white mb-3">HMAC-Secured</h3>
              <p className="text-gray-300">
                Military-grade authentication protocols ensure that every interaction 
                with our AI is verified and secure.
              </p>
            </div>
          </div>

          {/* Security metrics */}
          <div className="mt-16 bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-2xl p-8">
            <div className="grid md:grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-purple-400 mb-2">256-bit</div>
                <div className="text-gray-300">Encryption</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-blue-400 mb-2">99.9%</div>
                <div className="text-gray-300">Uptime</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-green-400 mb-2">0</div>
                <div className="text-gray-300">Breaches</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-pink-400 mb-2">24/7</div>
                <div className="text-gray-300">Monitoring</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section id="beta" className="relative z-30 py-20 bg-gradient-to-t from-purple-900/40 to-transparent">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="space-y-8">
            <h2 className="text-4xl lg:text-6xl font-bold text-white">
              Ready to Experience the 
              <span className="block text-transparent bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text">
                Future of DeFi?
              </span>
            </h2>
            {/* Beta status indicator */}
            <div className="inline-flex items-center space-x-2 bg-green-500/20 border border-green-500/30 rounded-full px-6 py-3">
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-green-400 font-semibold">Beta Access Available</span>
            </div>
            
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Join thousands of early adopters who are already trading smarter 
              with Lexie's AI-powered wallet. Beta access is limited.
            </p>

            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <a
                href="https://t.me/Lexie_Crypto_Bot"
                target="_blank"
                rel="noopener noreferrer"
                className="group px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold text-base rounded-full hover:from-purple-700 hover:to-pink-700 transition-all duration-300 shadow-xl hover:shadow-purple-500/50 hover:scale-105 flex items-center space-x-2"
              >
                <span>🚀</span>
                <span>Join Beta</span>
              </a>
              
              <div className="flex space-x-4">
                <a
                  href="https://t.me/lexie_crypto_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 border-2 border-cyan-500 text-cyan-400 rounded-full hover:bg-cyan-500 hover:text-white transition-all duration-300 hover:scale-110"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                </a>
                <a
                  href="https://twitter.com/0xLexieAI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 border-2 border-blue-500 text-blue-400 rounded-full hover:bg-blue-500 hover:text-white transition-all duration-300 hover:scale-110"
                >
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                  </svg>
                </a>
          <a 
            href="mailto:lexie@lexiecrypto.com" 
                  className="p-4 border-2 border-purple-500 text-purple-400 rounded-full hover:bg-purple-500 hover:text-white transition-all duration-300 hover:scale-110"
          >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
          </a>
        </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-30 py-12 border-t border-purple-500/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="text-center md:text-left">
              <div className="text-2xl font-bold text-purple-300 mb-2">LEXIEAI</div>
              <p className="text-gray-400">
                Trade smarter. Quest deeper. Stay private.  
              </p>
            </div>
            
            <div className="flex space-x-6">
              <a href="#features" className="text-gray-400 hover:text-purple-300 transition-colors">Features</a>
              <a href="#security" className="text-gray-400 hover:text-purple-300 transition-colors">Security</a>
              <a href="#beta" className="text-gray-400 hover:text-purple-300 transition-colors">Beta</a>
              <a href="/t&cs" className="text-gray-400 hover:text-purple-300 transition-colors">Terms & Conditions</a>
              <a href="/privacy" className="text-gray-400 hover:text-purple-300 transition-colors">Privacy Policy</a>
              <a href="mailto:lexie@lexiecrypto.com" className="text-gray-400 hover:text-purple-300 transition-colors">Contact</a>
            </div>
          </div>
          
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-500">
            <p>&copy; 2025 LexieAI. All rights reserved.</p>
          </div>
        </div>
      </footer>

        {/* Custom styles - CLEAN VERSION */}
        <style jsx>{`
          /* No custom animations needed - using only Tailwind defaults */
        `}</style>
      </main>
    </>
  );
}