import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind config maps semantic tokens (CSS-vars из src/ui/tokens.css)
 * на utility-классы. Цвета — через `var(--*)`, чтобы переключение темы
 * работало автоматически.
 *
 * Дизайн-источник: plans/analysis/2026-05-09-ai-meeting-workspace-design.md
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens
        bg: {
          base: 'var(--bg-base)',
          elevated: 'var(--bg-elevated)',
          card: 'var(--bg-card)',
          overlay: 'var(--bg-overlay)',
        },
        border: {
          DEFAULT: 'var(--border)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        fg: {
          DEFAULT: 'var(--text-primary)',
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
          'muted-strong': 'var(--accent-muted-strong)',
          border: 'var(--accent-border)',
          fg: 'var(--accent-fg)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'var(--font-sans)'],
        mono: ['var(--font-geist-mono)', 'var(--font-mono)'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.4' }],
        sm: ['13px', { lineHeight: '1.45' }],
        base: ['14px', { lineHeight: '1.5' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['17px', { lineHeight: '1.4' }],
        xl: ['20px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        '2xl': ['24px', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        '3xl': ['32px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        '4xl': ['48px', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        elevated: 'var(--shadow-elevated)',
        modal: 'var(--shadow-modal)',
        glow: 'var(--shadow-glow-mint)',
        'glow-mint': 'var(--shadow-glow-mint)',
      },
      backdropBlur: {
        glass: '12px',
        modal: '8px',
      },
      spacing: {
        sb: 'var(--sidebar-w)',
        'sb-collapsed': 'var(--sidebar-w-collapsed)',
        header: 'var(--header-h)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-1200px 0' },
          '100%': { backgroundPosition: '1200px 0' },
        },
        'pulse-mint': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite linear',
        'pulse-mint': 'pulse-mint 2.4s ease-in-out infinite',
        'fade-in': 'fade-in 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 240ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
};

export default config;
