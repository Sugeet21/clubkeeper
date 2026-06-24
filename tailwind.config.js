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
        // Player-side design system tokens. Used ONLY by routes under
        // /c/:slug, /c/:slug/book, /poster/:slug. Staff app never touches
        // these — staff stays on bg/accent/border/busy/free/paused above.
        // Source of truth: .claude/skills/clubkeeper/references/player_design_system.md
        player: {
          'felt': '#0a3d2a',
          'felt-deep': '#062418',
          'felt-light': '#145a3f',
          'cushion': '#6b3410',
          'ball-white': '#f8f4e8',
          'cue-cream': '#f0e6c8',
          'cue-yellow': '#f4c542',
          'chalk': '#4a90a8',
          'ball-red': '#b8312a',
          'ball-green': '#2d6b3a',
        },
      },
      fontFamily: {
        sans: ['Bricolage Grotesque', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        // Player-side type system. Staff keeps font-sans (Bricolage).
        // font-mono is shared (JetBrains Mono either way — identical render).
        display: ['Fraunces', 'serif'],
        body: ['Inter', 'sans-serif'],
      },
      // Player-only motion. Design system §4.10 — pulse, not spin.
      keyframes: {
        'player-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'player-fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'player-pulse': 'player-pulse 1.4s ease-in-out infinite',
        'player-fade-in': 'player-fade-in 200ms ease-out',
      },
    },
  },
  plugins: [],
}
