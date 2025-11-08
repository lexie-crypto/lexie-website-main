/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cyberpunk color palette
        cyber: {
          bg: '#0A0A0A',      // near-black background
          primary: '#FF4EFF',  // vibrant neon magenta
          secondary: '#FF69B4', // hot pink
          neutral: '#1E1E1E',   // dark grey
          glow: '#FFB2FF',     // light pastel magenta
          text: '#FFFFFF',     // white text
          'text-secondary': '#EAEAEA', // light grey text
        },
      },
      backgroundImage: {
        'cyber-gradient': 'linear-gradient(135deg, #0A0A0A 0%, #1E1E1E 100%)',
        'neon-glow': 'linear-gradient(135deg, rgba(255, 78, 255, 0.1) 0%, rgba(255, 105, 180, 0.1) 100%)',
      },
      boxShadow: {
        'cyber': '0 0 20px rgba(255, 78, 255, 0.3)',
        'cyber-hover': '0 0 30px rgba(255, 78, 255, 0.5)',
        'pink-glow': '0 0 20px rgba(255, 105, 180, 0.3)',
      },
      animation: {
        'cyber-pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'neon-flicker': 'flicker 1.5s infinite alternate',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
} 