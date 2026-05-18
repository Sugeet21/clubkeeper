/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0e0c',
        'bg-elevated': '#131815',
        'bg-card': '#1a201c',
        border: '#2a322d',
        'border-bright': '#3a443e',
        text: '#e8efe9',
        'text-dim': '#8a948c',
        'text-faint': '#555f57',
        accent: '#b8ff5a',
        'accent-dim': '#8fd142',
        free: '#5dd982',
        busy: '#ff6b4a',
        paused: '#ffb84a',
      },
      fontFamily: {
        sans: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
