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
  const [currentVisibleStep, setCurrentVisibleStep] = useState(-1);
  const carouselRef = useRef(null);
  const stepRefs = useRef([]);
  
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

  // Scroll-triggered step animations
  useEffect(() => {
    const handleScroll = () => {
      let latestVisibleStep = -1;

      stepRefs.current.forEach((ref, index) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          const windowHeight = window.innerHeight;

          // Trigger animation when step is 70% visible from bottom
          if (rect.top < windowHeight * 0.7) {
            latestVisibleStep = index; // Keep track of the latest visible step
          }
        }
      });

      setCurrentVisibleStep(latestVisibleStep);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial visibility

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      {/* Navigation */}
      <Navbar />

      <main className="relative min-h-screen w-full bg-[#0A0A0A] text-white overflow-x-hidden">
        {/* Loading overlay */}
        <div className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${bgLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="text-purple-300 text-2xl font-mono">
            Loading<span className="animate-pulse">...</span>
          </div>
        </div>
        

      {/* Hero Section */}
      <section className="relative z-30 min-h-screen flex items-center justify-center overflow-hidden">
        {/* Cyberpunk Background Effects */}
        <div className="absolute inset-0 bg-[#0A0A0A]">
          {/* Grid Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                linear-gradient(rgba(168, 85, 247, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(168, 85, 247, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: '50px 50px'
            }}></div>
          </div>

          {/* Glowing Orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl animate-pulse" style={{animationDelay: '2s'}}></div>
          <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-magenta-500/5 rounded-full blur-3xl animate-pulse" style={{animationDelay: '4s'}}></div>

          {/* Matrix-style Data Streams */}
          <div className="absolute inset-0 overflow-hidden">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-px bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent animate-pulse"
                style={{
                  left: `${(i * 8.33) + Math.random() * 2}%`,
                  top: '-20%',
                  height: '140%',
                  animationDelay: `${Math.random() * 4}s`,
                  animationDuration: `${2 + Math.random() * 2}s`,
                  opacity: 0.6 + Math.random() * 0.3
                }}
              ></div>
            ))}
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`secondary-${i}`}
                className="absolute w-px bg-gradient-to-b from-transparent via-purple-500/15 to-transparent animate-pulse"
                style={{
                  left: `${(i * 12.5) + 4 + Math.random() * 2}%`,
                  top: '-15%',
                  height: '130%',
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                  opacity: 0.5 + Math.random() * 0.3
                }}
              ></div>
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`tertiary-${i}`}
                className="absolute w-px bg-gradient-to-b from-transparent via-green-500/12 to-transparent animate-pulse"
                style={{
                  left: `${(i * 16.67) + 6 + Math.random() * 2}%`,
                  top: '-25%',
                  height: '150%',
                  animationDelay: `${Math.random() * 5}s`,
                  animationDuration: `${4 + Math.random() * 2}s`,
                  opacity: 0.4 + Math.random() * 0.3
                }}
              ></div>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-20 relative z-10">
          <div className="grid lg:grid-cols-2 gap-48 items-center">
            
            {/* Left side - Text content */}
            <div className="space-y-8">
              {/* Main headline */}
              <div className="space-y-4">
                <h1 className="text-5xl lg:text-7xl font-bold leading-tight">
                  <span className="text-purple-400">
                    Lexie:
                  </span>
                  <br />
                  <span className="text-white">
                    ZK-Powered
                  </span>
                  <br />
                  <span className="text-purple-300">
                    Privacy Vault
                  </span>
            </h1>

                <p className="text-xl text-gray-300 max-w-lg">
                  Go private on-chain. Hide your assets. Cloak your moves.
                </p>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <a
                  href="https://t.me/lexie_crypto_bot"
              target="_blank"
              rel="noopener noreferrer"
                  className="px-8 py-4 bg-white text-black font-semibold rounded-lg hover:bg-gray-100 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 text-center"
            >
                  Chat with Lexie
            </a>
            <a
                    href="https://app.lexiecrypto.com/lexievault"
              target="_blank"
              rel="noopener noreferrer"
                    className="px-8 py-4 border-2 border-purple-300 text-white font-semibold rounded-lg hover:bg-purple-300 hover:text-black transition-all duration-300 hover:scale-105 text-center"
            >
                    Launch Privacy Vault
            </a>
          </div>
        </div>

            {/* Right side - ZK Privacy Terminal */}
            <div className="relative flex justify-center">
              {/* Terminal-style Background Frame */}
              <div className="relative bg-black rounded-lg border border-purple-500/30 shadow-2xl overflow-hidden max-w-lg w-full backdrop-blur-sm">
                {/* Terminal Header */}
                <div className="flex items-center justify-between bg-gray-900 px-4 py-3 border-b border-purple-500/20">
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
                  <div className="absolute inset-0 bg-[#0a0a0a] blur-sm"></div>
                </div>

                {/* Terminal Footer */}
                <div className="bg-gray-900 px-4 py-2 border-t border-purple-500/20">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center space-x-4">
                      <span>Process: zk-vault-core</span>
                      <span>•</span>
                      <span>Status: SECURE</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-purple-400">ZK-Enabled</span>
                      <span>•</span>
                      <span className="text-cyan-400">AI-Active</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What is Lexie Section */}
      <section className="relative z-30 py-20 bg-[#0E0F17] overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0">
          {/* Subtle Grid Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                linear-gradient(rgba(168, 85, 247, 0.08) 1px, transparent 1px),
                linear-gradient(90deg, rgba(168, 85, 247, 0.08) 1px, transparent 1px)
              `,
              backgroundSize: '40px 40px'
            }}></div>
          </div>

          {/* Floating Glow Orbs */}
          <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-fuchsia-500/3 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute bottom-1/3 left-1/4 w-48 h-48 bg-cyan-500/3 rounded-full blur-3xl animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left side - Text content */}
            <div className="space-y-8">
              {/* Section Title */}
              <div className="space-y-4">
                <h2 className="text-4xl lg:text-5xl font-bold text-white">
                  What is <span className="text-fuchsia-400">Lexie</span>?
                </h2>
                <p className="text-xl text-gray-300">
                  Your AI companion for crypto intelligence and private trading.
                </p>
              </div>

              {/* Body Content */}
              <div className="space-y-6 text-lg text-gray-300 leading-relaxed">
                <p>
                  Lexie is a ZK-powered AI that helps users activate stealth mode on-chain, shielding wallet balances and transaction data through advanced zero-knowledge proofs.
                  She ensures your crypto activities remain completely private and untraceable.
                </p>
                <p>
                  In coming updates, she'll also provide market data, yield pools, technical analysis, and alpha discovery — all while maintaining your complete privacy.
                </p>
                <p>
                  When integrated inside LexieVault, she'll deliver private, on-chain market intelligence right where you store your assets, combining stealth trading with smart market insights.
                </p>
              </div>

              {/* Telegram Badge */}
              <div className="flex items-center space-x-4">
                <a
                  href="https://t.me/lexie_crypto_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-3 px-6 py-3 bg-black/60 backdrop-blur-sm border border-fuchsia-500/40 rounded-full hover:border-fuchsia-500/80 hover:bg-fuchsia-500/10 transition-all duration-300 group"
                >
                  <div className="w-8 h-8 bg-gradient-to-br from-fuchsia-500 to-purple-500 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-fuchsia-400 font-semibold text-sm">Available on Telegram</span>
                    <span className="text-gray-400 text-xs">@lexie_crypto_bot</span>
                  </div>
                  <svg className="w-4 h-4 text-fuchsia-400 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Right side - Holographic Lexie Illustration */}
            <div className="relative flex justify-center">
              {/* Main Holographic Container */}
              <div className="relative w-80 h-80 bg-gradient-to-br from-black/80 to-purple-900/20 rounded-2xl border border-purple-500/30 backdrop-blur-sm overflow-hidden shadow-2xl shadow-purple-500/10">

                {/* Background Circuit Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <svg className="w-full h-full" viewBox="0 0 400 400" fill="none">
                    <defs>
                      <pattern id="circuit" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M10 10h20v20h-20z" stroke="currentColor" strokeWidth="0.5" fill="none"/>
                        <circle cx="20" cy="20" r="1" fill="currentColor"/>
                        <path d="M20 10v10M10 20h10M30 20h10M20 30v10" stroke="currentColor" strokeWidth="0.5"/>
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#circuit)" className="text-purple-400"/>
                  </svg>
                </div>

                {/* Central AI Avatar */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    {/* Outer Glow Ring */}
                    <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/20 via-purple-500/20 to-cyan-500/20 rounded-full blur-xl animate-pulse scale-150"></div>

                    {/* Avatar Circle */}
                    <div className="relative w-32 h-32 bg-gradient-to-br from-purple-600 via-fuchsia-500 to-cyan-500 rounded-full flex items-center justify-center border-2 border-cyan-400/50 shadow-lg shadow-purple-500/25">
                      <div className="w-24 h-24 bg-gradient-to-br from-black to-purple-900 rounded-full flex items-center justify-center">
                      </div>
                      {/* Scanning Line */}
                      <div className="absolute inset-0 rounded-full border-2 border-cyan-400/30 animate-ping"></div>
                    </div>
                  </div>
                </div>

                {/* Trading Chart Panels */}
                <div className="absolute top-6 right-6 space-y-3">
                  {/* Token Pair Panel */}
                  <div className="bg-black/80 backdrop-blur-sm border border-fuchsia-500/40 rounded-lg p-3 shadow-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-400 rounded-full flex items-center justify-center text-xs font-bold text-white">W</div>
                        <span className="text-white text-sm font-semibold">WETH/USDC</span>
                      </div>
                      <div className="text-fuchsia-400 text-xs font-mono">UNI</div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">Price</span>
                        <span className="text-white text-sm font-mono">$1,847.32</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">24h</span>
                        <span className="text-green-400 text-sm font-mono">+2.8%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">Vol</span>
                        <span className="text-cyan-400 text-sm font-mono">$12.4M</span>
                      </div>
                    </div>
                  </div>

                  {/* DEX Pool Panel */}
                  <div className="bg-black/80 backdrop-blur-sm border border-cyan-500/40 rounded-lg p-3 shadow-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                      <span className="text-cyan-400 text-xs font-mono">POOL</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">TVL</span>
                        <span className="text-white text-sm font-mono">$2.4B</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">APY</span>
                        <span className="text-green-400 text-sm font-mono">24.7%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400 text-xs">Fee</span>
                        <span className="text-purple-400 text-sm font-mono">0.3%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Elements */}
                <div className="absolute bottom-6 left-6">
                  <div className="bg-black/80 backdrop-blur-sm border border-purple-500/40 rounded-lg p-3 shadow-lg">
                    <div className="text-purple-400 text-xs font-mono mb-1">ANALYZING</div>
                    <div className="text-white text-sm font-semibold">47 pools</div>
                    <div className="text-gray-400 text-xs">scanned</div>
                  </div>
                </div>

                {/* Animated Waveforms */}
                <div className="absolute bottom-4 left-4 right-4">
                  <svg className="w-full h-8" viewBox="0 0 300 32" fill="none">
                    <path
                      d="M0 16 Q25 8 50 16 T100 16 Q125 24 150 16 T200 16 Q225 8 250 16 T300 16"
                      stroke="url(#waveGradient)"
                      strokeWidth="2"
                      className="animate-pulse"
                    />
                    <defs>
                      <linearGradient id="waveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="rgb(168, 85, 247)" stopOpacity="0.6"/>
                        <stop offset="50%" stopColor="rgb(139, 92, 246)" stopOpacity="0.8"/>
                        <stop offset="100%" stopColor="rgb(6, 182, 212)" stopOpacity="0.6"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative z-30 py-20 bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto px-6">
          {/* Section Header */}
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-4">
              <span className="text-fuchsia-400"></span> How It <span className="text-purple-400">Works</span>
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Create your private vault, fund it, and go dark on-chain — all in a few simple steps.
            </p>
          </div>

          {/* Steps Container */}
          <div className="relative">
            {/* Animated Flow Line - Vertical */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-purple-500/50 via-purple-400/50 to-purple-600/50 hidden lg:block">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/50 via-purple-400/50 to-purple-600/50 animate-pulse"></div>
              {/* Flow indicators */}
              <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-purple-400 rounded-full animate-ping" style={{animationDelay: '0s'}}></div>
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-purple-500 rounded-full animate-ping" style={{animationDelay: '0.5s'}}></div>
            </div>

            <div className="space-y-8 lg:space-y-12">
              {/* Step 1 */}
              <div ref={el => stepRefs.current[0] = el} className="relative flex items-start space-x-6 lg:space-x-8">
                <div className="flex-shrink-0">
                  <div className={`relative w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-500 rounded-full flex items-center justify-center border-2 border-purple-400 shadow-lg shadow-purple-500/25 transition-all duration-500 ${currentVisibleStep === 0 ? 'scale-110' : 'scale-100'}`}>
                    <span className="text-2xl font-bold text-white">1</span>
                    <div className={`absolute inset-0 rounded-full bg-purple-500/20 transition-all duration-500 ${currentVisibleStep === 0 ? 'animate-ping opacity-100' : 'opacity-0'}`}></div>
                  </div>
                </div>
                <div className={`flex-1 bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 transition-all duration-500 ${currentVisibleStep === 0 ? 'hover:border-purple-500/60 transform scale-[1.02]' : ''}`}>
                  <h3 className={`text-xl font-bold text-purple-400 mb-2 transition-all duration-500 ${currentVisibleStep === 0 ? 'text-purple-300' : ''}`}>Create a Private Vault</h3>
                  <p className={`text-gray-300 leading-relaxed transition-all duration-500 ${currentVisibleStep === 0 ? 'text-gray-200' : ''}`}>
                    Connect your existing wallet (MetaMask, Trust Wallet, etc.) on BNB Chain, Ethereum, Polygon, or Arbitrum.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div ref={el => stepRefs.current[1] = el} className="relative flex items-start space-x-6 lg:space-x-8">
                <div className="flex-shrink-0">
                  <div className={`relative w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-400 rounded-full flex items-center justify-center border-2 border-purple-300 shadow-lg shadow-purple-500/25 transition-all duration-500 ${currentVisibleStep === 1 ? 'scale-110' : 'scale-100'}`}>
                    <span className="text-2xl font-bold text-white">2</span>
                    <div className={`absolute inset-0 rounded-full bg-purple-400/20 transition-all duration-500 ${currentVisibleStep === 1 ? 'animate-ping opacity-100' : 'opacity-0'}`}></div>
                  </div>
                </div>
                <div className={`flex-1 bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 transition-all duration-500 ${currentVisibleStep === 1 ? 'hover:border-purple-500/60 transform scale-[1.02]' : ''}`}>
                  <h3 className={`text-xl font-bold text-purple-300 mb-2 transition-all duration-500 ${currentVisibleStep === 1 ? 'text-purple-200' : ''}`}>Add Funds</h3>
                  <p className={`text-gray-300 leading-relaxed transition-all duration-500 ${currentVisibleStep === 1 ? 'text-gray-200' : ''}`}>
                    Deposit assets from your wallet into your vault in one click.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div ref={el => stepRefs.current[2] = el} className="relative flex items-start space-x-6 lg:space-x-8">
                <div className="flex-shrink-0">
                  <div className={`relative w-16 h-16 bg-gradient-to-br from-purple-400 to-purple-300 rounded-full flex items-center justify-center border-2 border-purple-200 shadow-lg shadow-purple-500/25 transition-all duration-500 ${currentVisibleStep === 2 ? 'scale-110' : 'scale-100'}`}>
                    <span className="text-2xl font-bold text-white">3</span>
                    <div className={`absolute inset-0 rounded-full bg-purple-300/20 transition-all duration-500 ${currentVisibleStep === 2 ? 'animate-ping opacity-100' : 'opacity-0'}`}></div>
                  </div>
                </div>
                <div className={`flex-1 bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 transition-all duration-500 ${currentVisibleStep === 2 ? 'hover:border-purple-500/60 transform scale-[1.02]' : ''}`}>
                  <h3 className={`text-xl font-bold text-purple-200 mb-2 transition-all duration-500 ${currentVisibleStep === 2 ? 'text-purple-100' : ''}`}>Cloak Your Assets</h3>
                  <p className={`text-gray-300 leading-relaxed transition-all duration-500 ${currentVisibleStep === 2 ? 'text-gray-200' : ''}`}>
                    Once added, your balances and transactions become invisible to everyone but you.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div ref={el => stepRefs.current[3] = el} className="relative flex items-start space-x-6 lg:space-x-8">
                <div className="flex-shrink-0">
                  <div className={`relative w-16 h-16 bg-gradient-to-br from-purple-700 to-purple-600 rounded-full flex items-center justify-center border-2 border-purple-500 shadow-lg shadow-purple-500/25 transition-all duration-500 ${currentVisibleStep === 3 ? 'scale-110' : 'scale-100'}`}>
                    <span className="text-2xl font-bold text-white">4</span>
                    <div className={`absolute inset-0 rounded-full bg-purple-600/20 transition-all duration-500 ${currentVisibleStep === 3 ? 'animate-ping opacity-100' : 'opacity-0'}`}></div>
                  </div>
                </div>
                <div className={`flex-1 bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 transition-all duration-500 ${currentVisibleStep === 3 ? 'hover:border-purple-500/60 transform scale-[1.02]' : ''}`}>
                  <h3 className={`text-xl font-bold text-purple-500 mb-2 transition-all duration-500 ${currentVisibleStep === 3 ? 'text-purple-400' : ''}`}>Send Privately</h3>
                  <p className={`text-gray-300 leading-relaxed transition-all duration-500 ${currentVisibleStep === 3 ? 'text-gray-200' : ''}`}>
                    Transfer from vault to any wallet or another vault. The receiver won't see where funds originated or what's inside.
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div ref={el => stepRefs.current[4] = el} className="relative flex items-start space-x-6 lg:space-x-8">
                <div className="flex-shrink-0">
                  <div className={`relative w-16 h-16 bg-gradient-to-br from-purple-800 to-purple-700 rounded-full flex items-center justify-center border-2 border-purple-600 shadow-lg shadow-purple-500/25 transition-all duration-500 ${currentVisibleStep === 4 ? 'scale-110' : 'scale-100'}`}>
                    <span className="text-2xl font-bold text-white">5</span>
                    <div className={`absolute inset-0 rounded-full bg-purple-700/20 transition-all duration-500 ${currentVisibleStep === 4 ? 'animate-ping opacity-100' : 'opacity-0'}`}></div>
                  </div>
                </div>
                <div className={`flex-1 bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 transition-all duration-500 ${currentVisibleStep === 4 ? 'hover:border-purple-500/60 transform scale-[1.02]' : ''}`}>
                  <h3 className={`text-xl font-bold text-purple-600 mb-2 transition-all duration-500 ${currentVisibleStep === 4 ? 'text-purple-500' : ''}`}>Receive Anonymously</h3>
                  <p className={`text-gray-300 leading-relaxed transition-all duration-500 ${currentVisibleStep === 4 ? 'text-gray-200' : ''}`}>
                    Share a payment link so others can deposit into your vault without viewing your holdings.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Advanced AI Wallet Features Section */}
      <section id="features" className="relative z-30 py-32 overflow-hidden">
        {/* Section Background */}
        <div className="absolute inset-0 bg-[#0a0a0a]"></div>
        


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

      {/* Why Lexie Section */}
      <section className="relative z-30 py-20 bg-[#0a0a0a]">
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
          <div className="mt-16 bg-[#0a0a0a] rounded-2xl p-8">
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
      <section id="beta" className="relative z-30 py-20 bg-[#0a0a0a]">
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
              <div className="text-2xl font-bold text-pink-400/90 mb-2">LEXIE</div>
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