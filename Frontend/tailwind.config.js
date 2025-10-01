/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      fontFamily: { inter: ["Inter", "system-ui", "Arial", "sans-serif"] },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0, transform: 'scale(.98)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
        shimmer: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        fadeIn: 'fadeIn .24s ease-out',
        shimmer: 'shimmer 3s ease-in-out infinite',
      },
      boxShadow: {
        glow: '0 10px 30px rgba(99, 102, 241, .25)',
      },
    },
  },
  plugins: [],
}