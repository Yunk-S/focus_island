/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0f',
        foreground: '#F7FAFC',
        card: {
          DEFAULT: 'rgba(15, 15, 25, 0.85)',
          foreground: '#F7FAFC',
        },
        border: 'rgba(255, 255, 255, 0.12)',
        input: 'rgba(255, 255, 255, 0.12)',
        ring: '#6C3FF5',
        primary: {
          DEFAULT: '#6C3FF5',
          foreground: '#FAFAFA',
        },
        secondary: {
          DEFAULT: 'rgba(30, 30, 45, 0.95)',
          foreground: '#F7FAFC',
        },
        destructive: {
          DEFAULT: '#EF4444',
          foreground: '#FAFAFA',
        },
        muted: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          foreground: '#A0AEC0',
        },
        surface: {
          DEFAULT: 'rgba(15, 15, 25, 0.8)',
          hover: 'rgba(25, 25, 40, 0.9)',
        },
        glass: {
          border: 'rgba(255, 255, 255, 0.08)',
          hover: 'rgba(255, 255, 255, 0.12)',
        },
        accent: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          foreground: '#F7FAFC',
          mint: '#7FDBDA',
          lavender: '#B794F4',
          coral: '#FC8181',
          gold: '#F6E05E',
        },
        text: {
          primary: '#F7FAFC',
          secondary: '#A0AEC0',
          muted: '#718096',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(127, 219, 218, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(127, 219, 218, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        }
      },
      boxShadow: {
        'glow-mint': '0 0 30px rgba(127, 219, 218, 0.4)',
        'glow-lavender': '0 0 30px rgba(183, 148, 244, 0.4)',
        'inner-glow': 'inset 0 0 30px rgba(127, 219, 218, 0.1)',
      }
    },
  },
  plugins: [],
}
