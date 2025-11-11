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
  const [openFAQ, setOpenFAQ] = useState(null);
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

  const faqData = [
    {
      question: "What is LexieVault and how does it work?",
      answer: "LexieVault is a non-custodial privacy vault powered by zero-knowledge proofs. Once assets are shielded, your balances and transactions become invisible to everyone but you."
    },
    {
      question: "How does Lexie ensure privacy and anonymity?",
      answer: "Lexie uses zk-SNARK cryptography (the same tech behind Railgun) to hide sender, receiver, and amount — providing full on-chain privacy while staying completely transparent in validation."
    },
    {
      question: "What networks does Lexie support?",
      answer: "Currently supports BNB Chain, Ethereum, Polygon, and Arbitrum — with Optimism and Base coming soon."
    },
    {
      question: "Which assets can I deposit?",
      answer: "You can shield and transact with most ERC-20 tokens and NFTs (ERC-721)."
    },
    {
      question: "Can I send or receive funds privately?",
      answer: "Yes — send funds from vault to vault or to any wallet. Recipients won't see who sent them or what's in your vault."
    },
    {
      question: "Does Lexie support compliance or KYC options?",
      answer: "Yes — optional compliance tools include viewing keys, deposit limits, and travel-rule compatibility."
    },
    {
      question: "What is LexieAI?",
      answer: "LexieAI is your intelligent crypto assistant that provides real-time market data, yield insights, and technical analysis — currently on Telegram, with in-vault integration coming soon."
    },
    {
      question: "Will Lexie offer swaps, lending, and yield farming?",
      answer: "Yes — private swaps and yield go live in Phase 2, followed by lending and derivatives in Phase 3."
    },
    {
      question: "How can I recover my vault?",
      answer: "Lexie will support zero-knowledge social recovery and encrypted backup options similar to zk-email and zk-passport systems."
    },
    {
      question: "Are there deposit limits?",
      answer: "Deposit limits may apply for compliance reasons, but regular users won't be affected."
    }
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
                  What is <span className="text-fuchsia-300">Lexie</span>?
                </h2>
                <p className="text-xl text-gray-300">
                  Your AI companion for private trading and crypto intelligence.
                </p>
              </div>

              {/* Body Content */}
              <div className="space-y-6 text-lg text-gray-300 leading-relaxed">
                <p>
                  Lexie is a ZK-powered AI that activates stealth mode on-chain, shielding your wallet balances and transaction data through advanced zero-knowledge proofs.
                  She ensures your crypto activities remain completely private and untraceable on-chain.
                </p>
                <p>
                  In coming updates, she'll also provide swaps, yield pools, market data, technical analysis, and alpha discovery — all without leaving a footprint on-chain.
                </p>
              </div>
            </div>

            {/* Right side - Holographic Lexie Illustration */}
            <div className="relative flex justify-center">
              {/* Main Holographic Container */}
              <div className="relative w-80 h-80 bg-gradient-to-br from-black/80 to-purple-900/20 rounded-2xl border border-purple-500/30 backdrop-blur-sm overflow-hidden shadow-2xl shadow-purple-500/10">

                {/* Candlestick Chart Background */}
                <div className="absolute inset-0 opacity-20">
                  <svg className="w-full h-full" viewBox="0 0 400 300" fill="none">
                    <defs>
                      <linearGradient id="candleGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="rgb(168, 85, 247)" stopOpacity="0.8"/>
                        <stop offset="50%" stopColor="rgb(168, 85, 247)" stopOpacity="0.4"/>
                        <stop offset="100%" stopColor="rgb(168, 85, 247)" stopOpacity="0.2"/>
                      </linearGradient>
                    </defs>

                    {/* Grid Lines */}
                    <g stroke="currentColor" strokeWidth="0.5" opacity="0.3" className="text-purple-400">
                      <line x1="0" y1="50" x2="400" y2="50"/>
                      <line x1="0" y1="100" x2="400" y2="100"/>
                      <line x1="0" y1="150" x2="400" y2="150"/>
                      <line x1="0" y1="200" x2="400" y2="200"/>
                      <line x1="0" y1="250" x2="400" y2="250"/>
                      <line x1="50" y1="0" x2="50" y2="300"/>
                      <line x1="150" y1="0" x2="150" y2="300"/>
                      <line x1="250" y1="0" x2="250" y2="300"/>
                      <line x1="350" y1="0" x2="350" y2="300"/>
                    </g>

                    {/* Candlesticks */}
                    <g stroke="currentColor" className="text-fuchsia-400">
                      {/* Candle 1 - Bullish */}
                      <line x1="60" y1="80" x2="60" y2="160" strokeWidth="1"/>
                      <rect x="55" y="100" width="10" height="40" fill="url(#candleGradient)" strokeWidth="1"/>
                      <line x1="60" y1="75" x2="60" y2="85" strokeWidth="2"/>
                      <line x1="60" y1="155" x2="60" y2="165" strokeWidth="2"/>

                      {/* Candle 2 - Bearish */}
                      <line x1="110" y1="120" x2="110" y2="180" strokeWidth="1"/>
                      <rect x="105" y="135" width="10" height="25" fill="rgb(239, 68, 68)" opacity="0.7" strokeWidth="1"/>
                      <line x1="110" y1="115" x2="110" y2="125" strokeWidth="2"/>
                      <line x1="110" y1="175" x2="110" y2="185" strokeWidth="2"/>

                      {/* Candle 3 - Bullish */}
                      <line x1="160" y1="90" x2="160" y2="170" strokeWidth="1"/>
                      <rect x="155" y="110" width="10" height="35" fill="url(#candleGradient)" strokeWidth="1"/>
                      <line x1="160" y1="85" x2="160" y2="95" strokeWidth="2"/>
                      <line x1="160" y1="165" x2="160" y2="175" strokeWidth="2"/>

                      {/* Candle 4 - Small Range */}
                      <line x1="210" y1="130" x2="210" y2="160" strokeWidth="1"/>
                      <rect x="205" y="135" width="10" height="15" fill="url(#candleGradient)" strokeWidth="1"/>
                      <line x1="210" y1="125" x2="210" y2="135" strokeWidth="2"/>
                      <line x1="210" y1="155" x2="210" y2="165" strokeWidth="2"/>

                      {/* Candle 5 - Volatile */}
                      <line x1="260" y1="60" x2="260" y2="190" strokeWidth="1"/>
                      <rect x="255" y="120" width="10" height="30" fill="url(#candleGradient)" strokeWidth="1"/>
                      <line x1="260" y1="55" x2="260" y2="65" strokeWidth="2"/>
                      <line x1="260" y1="185" x2="260" y2="195" strokeWidth="2"/>

                      {/* Candle 6 - Bullish */}
                      <line x1="310" y1="100" x2="310" y2="180" strokeWidth="1"/>
                      <rect x="305" y="125" width="10" height="30" fill="url(#candleGradient)" strokeWidth="1"/>
                      <line x1="310" y1="95" x2="310" y2="105" strokeWidth="2"/>
                      <line x1="310" y1="175" x2="310" y2="185" strokeWidth="2"/>
                    </g>

                    {/* Price Line */}
                    <g stroke="rgb(34, 197, 94)" strokeWidth="1.5" opacity="0.8">
                      <path d="M20 140 Q60 130 100 145 T180 135 Q220 125 260 140 T340 130 Q380 120 400 135"/>
                    </g>
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

                {/* Floating Data Panels */}
                <div className="absolute top-6 right-6 space-y-3">
                  {/* Price Alert Panel */}
                  <div className="bg-black/80 backdrop-blur-sm border border-fuchsia-500/40 rounded-lg p-3 shadow-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-2 h-2 bg-fuchsia-400 rounded-full animate-pulse"></div>
                      <span className="text-fuchsia-400 text-xs font-mono">ALERT</span>
                    </div>
                    <div className="text-white text-sm font-semibold">$PEPE +127%</div>
                    <div className="text-gray-400 text-xs">2m ago</div>
                  </div>

                  {/* Market Data Panel */}
                  <div className="bg-black/80 backdrop-blur-sm border border-cyan-500/40 rounded-lg p-3 shadow-lg">
                    <div className="flex items-center space-x-2 mb-1">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                      <span className="text-cyan-400 text-xs font-mono">MARKET</span>
                    </div>
                    <div className="text-white text-sm font-semibold">BTC $67,432</div>
                    <div className="text-green-400 text-xs">+2.3%</div>
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
              Create your private vault, fund it, and go stealth on-chain — all in a few simple steps.
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
                Complete transaction privacy using advanced ZK-proofs. Your on-chain history 
                remains invisible to everyone.
              </p>
            </div>

            <div className="bg-black/40 backdrop-blur-sm border border-blue-500/30 rounded-xl p-8 text-center hover:border-blue-500/60 transition-all duration-300">
              <div className="text-4xl mb-4">🔑</div>
              <h3 className="text-xl font-semibold text-white mb-3">Powered by Railgun</h3>
              <p className="text-gray-300">
                Audited by top security firms and trusted by Vitalik Buterin.
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
                <div className="text-3xl font-bold text-blue-400 mb-2">100%</div>
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

      {/* Roadmap Section */}
      <section className="relative z-30 py-20 bg-[#0a0a0a] overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0">
          {/* Animated Grid Pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                linear-gradient(rgba(168, 85, 247, 0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(168, 85, 247, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
              animation: 'gridMove 20s linear infinite'
            }}></div>
          </div>

          {/* Flowing Data Streams */}
          <div className="absolute inset-0 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="absolute w-px bg-gradient-to-b from-transparent via-purple-500/20 to-transparent animate-pulse"
                style={{
                  left: `${(i * 12.5) + 5}%`,
                  top: '-20%',
                  height: '140%',
                  animationDelay: `${i * 0.8}s`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                  opacity: 0.7 + Math.random() * 0.3
                }}
              ></div>
            ))}
          </div>

          {/* Glowing Connectors */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="relative w-full h-px bg-gradient-to-r from-green-500/50 via-purple-500/50 to-pink-500/50 animate-pulse"></div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          {/* Section Header */}
          <div className="text-center mb-20">
            <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6">
              Roadmap
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              From privacy vault to full private DeFi ecosystem — our journey to revolutionize decentralized finance
            </p>
          </div>

          {/* Roadmap Timeline */}
          <div className="relative">
            {/* Desktop Timeline Line */}
            <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-green-500/30 via-purple-500/50 to-pink-500/30 transform -translate-y-1/2"></div>

            {/* Phases */}
            <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
              {/* Phase 1 - Completed */}
              <div className="relative group">
                {/* Phase Card */}
                <div className="bg-black/60 backdrop-blur-sm border-2 border-green-500/40 rounded-2xl p-8 hover:border-green-400/60 transition-all duration-500 hover:transform hover:scale-105 hover:shadow-2xl hover:shadow-green-500/20">
                  {/* Phase Header */}
                  <div className="text-center mb-8">
                    <h3 className="text-2xl font-bold text-green-400 mb-2">Phase 1</h3>
                    <div className="inline-flex items-center space-x-2 bg-green-500/20 border border-green-500/30 rounded-full px-4 py-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-green-400 font-semibold text-sm">COMPLETED</span>
                    </div>
                  </div>

                  {/* Phase Items */}
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                        <span className="text-black text-sm font-bold">✓</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-green-300 transition-colors duration-300">
                          Ship Privacy Vault (private shield/unshield; zero-knowledge proofs)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                        <span className="text-black text-sm font-bold">✓</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-green-300 transition-colors duration-300">
                          Launch LexieAI on Telegram (market data & crypto intelligence)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline Node */}
                <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 w-8 h-8 bg-green-500 rounded-full border-4 border-black shadow-lg shadow-green-500/50"></div>
              </div>

              {/* Phase 2 - Current */}
              <div className="relative group">
                {/* Phase Card */}
                <div className="bg-black/60 backdrop-blur-sm border-2 border-purple-500/40 rounded-2xl p-8 hover:border-purple-400/60 transition-all duration-500 hover:transform hover:scale-105 hover:shadow-2xl hover:shadow-purple-500/20">
                  {/* Phase Header */}
                  <div className="text-center mb-8">
                    <h3 className="text-2xl font-bold text-purple-400 mb-2">Phase 2</h3>
                    <div className="inline-flex items-center space-x-2 bg-purple-500/20 border border-purple-500/30 rounded-full px-4 py-2">
                      <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                      <span className="text-purple-400 font-semibold text-sm">CURRENT</span>
                    </div>
                  </div>

                  {/* Phase Items */}
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Launch Lexie Token
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Add private swaps and yield farming to the vault
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Integrate LexieAI directly into the vault (AI market insights inside app)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Expand multi-chain support for Solana, Base, and more
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Add NFT shielding (ERC-721 support)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-purple-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-purple-300 transition-colors duration-300">
                          Launch advanced compliance tools using Chainalysis
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline Node */}
                <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 w-8 h-8 bg-purple-500 rounded-full border-4 border-black shadow-lg shadow-purple-500/50"></div>
              </div>

              {/* Phase 3 - Future */}
              <div className="relative group">
                {/* Phase Card */}
                <div className="bg-black/60 backdrop-blur-sm border-2 border-pink-500/40 rounded-2xl p-8 hover:border-pink-400/60 transition-all duration-500 hover:transform hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/20">
                  {/* Phase Header */}
                  <div className="text-center mb-8">
                    <h3 className="text-2xl font-bold text-pink-400 mb-2">Phase 3</h3>
                    <div className="inline-flex items-center space-x-2 bg-pink-500/20 border border-pink-500/30 rounded-full px-4 py-2">
                      <div className="w-2 h-2 bg-pink-400 rounded-full animate-pulse"></div>
                      <span className="text-pink-400 font-semibold text-sm">FUTURE</span>
                    </div>
                  </div>

                  {/* Phase Items */}
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Native wallet & mobile app with optional privacy mode
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Private cross-chain DeFi (Aztec-style bridging to protocols like Uniswap, Aave)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Private lending, borrowing, and derivatives
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Remote proving & off-chain deposits
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          ZK-based social recovery (ZKemail/ZKpassport integration)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Private multi-signature vaults
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3 group/item">
                      <div className="flex-shrink-0 w-6 h-6 text-pink-400 mt-0.5 flex items-center justify-center">
                        <span className="text-lg">•</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-300 leading-relaxed group-hover/item:text-pink-300 transition-colors duration-300">
                          Governance & staking for token holders
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline Node */}
                <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 w-8 h-8 bg-pink-500 rounded-full border-4 border-black shadow-lg shadow-pink-500/50"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="relative z-30 py-20 bg-[#0a0a0a] overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0">
          {/* Subtle Grid Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: `
                linear-gradient(rgba(168, 85, 247, 0.08) 1px, transparent 1px),
                linear-gradient(90deg, rgba(168, 85, 247, 0.08) 1px, transparent 1px)
              `,
              backgroundSize: '50px 50px'
            }}></div>
          </div>

          {/* Floating Glow Orbs */}
          <div className="absolute top-1/4 right-1/4 w-32 h-32 bg-fuchsia-500/3 rounded-full blur-2xl animate-pulse"></div>
          <div className="absolute bottom-1/4 left-1/4 w-48 h-48 bg-cyan-500/3 rounded-full blur-2xl animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>

        <div className="max-w-4xl mx-auto px-6 relative z-10">
          {/* Section Header */}
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-4">
              FAQs
            </h2>
            <p className="text-xl text-gray-300">
              Everything you need to know about Lexie and private DeFi
            </p>
          </div>

          {/* FAQ Container */}
          <div className="bg-black/40 backdrop-blur-sm border border-purple-500/40 rounded-2xl p-8 shadow-2xl">
            <div className="space-y-4">
              {faqData.map((faq, index) => (
                <div key={index} className="border-b border-cyan-500/20 last:border-b-0">
                  <button
                    className="w-full text-left py-4 focus:outline-none focus:ring-2 focus:ring-purple-500/50 rounded-lg transition-all duration-300 hover:bg-purple-500/5 group"
                    onClick={() => setOpenFAQ(openFAQ === index ? null : index)}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-purple-400 group-hover:text-purple-300 transition-colors duration-300 pr-4">
                        {faq.question}
                      </h3>
                      <div className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full border-2 border-purple-400/50 transition-all duration-300 ${
                        openFAQ === index ? 'bg-purple-500/20 rotate-180' : 'bg-transparent'
                      }`}>
                        <svg
                          className={`w-3 h-3 text-purple-400 transition-transform duration-300 ${
                            openFAQ === index ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </button>

                  <div className={`overflow-hidden transition-all duration-300 ${
                    openFAQ === index ? 'max-h-96 opacity-100 pb-4' : 'max-h-0 opacity-0'
                  }`}>
                    <p className="text-gray-300/90 leading-relaxed pl-0">
                      {faq.answer}
                    </p>
                  </div>
                </div>
              ))}
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
              <span className="block text-transparent bg-gradient-to-r from-purple-200 to-purple-600 bg-clip-text">
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
              with Lexie's ZK-powered privacy vault. Beta access is limited.
            </p>

            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
              <a
                href="https://app.lexiecrypto.com/lexievault"
                target="_blank"
                rel="noopener noreferrer"
                className="group px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold text-base rounded-full hover:from-purple-700 hover:to-pink-700 transition-all duration-300 shadow-xl hover:shadow-purple-500/50 hover:scale-105 flex items-center space-x-2"
              >
                <span>🚀</span>
                <span>Launch dApp</span>
              </a>
              
              <div className="flex space-x-4">
                <a
                  href="https://t.me/lexieAI"
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
              <div className="text-2xl font-bold text-purple-300/90 mb-2">LEXIE</div>
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

        {/* Custom styles */}
        <style jsx>{`
          @keyframes gridMove {
            0% {
              transform: translate(0, 0);
            }
            100% {
              transform: translate(60px, 60px);
            }
          }
        `}</style>
      </main>
    </>
  );
}