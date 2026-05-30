import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import animate from 'tailwindcss-animate';

/**
 * Tailwind config maps semantic tokens (CSS-vars из src/ui/tokens.css)
 * на utility-классы. Цвета — через `var(--*)`, чтобы переключение темы
 * работало автоматически.
 *
 * OKLCH-палитра + sage/warm-mint introduced in Phase A of
 * plans/tz/2026-05-24-ui-api-modernization.md.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn compatibility aliases — maps to our semantic tokens
        foreground: 'var(--text-primary)',
        background: 'var(--bg-base)',
        muted: {
          DEFAULT: 'var(--bg-subtle)',
          foreground: 'var(--text-secondary)',
        },
        input: 'var(--border)',
        ring: 'var(--accent)',
        // Semantic tokens
        bg: {
          base: 'var(--bg-base)',
          elevated: 'var(--bg-elevated)',
          card: 'var(--bg-card)',
          surface: 'var(--bg-surface)',
          subtle: 'var(--bg-subtle)',
          overlay: 'var(--bg-overlay)',
          muted: 'var(--bg-subtle)',
          hover: 'var(--bg-subtle)',
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
          disabled: 'var(--text-disabled)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          muted: 'var(--accent-muted)',
          'muted-strong': 'var(--accent-muted-strong)',
          border: 'var(--accent-border)',
          fg: 'var(--accent-fg)',
        },
        chip: {
          'success-bg': 'var(--chip-success-bg)',
          'success-fg': 'var(--chip-success-fg)',
          'warning-bg': 'var(--chip-warning-bg)',
          'warning-fg': 'var(--chip-warning-fg)',
          'danger-bg': 'var(--chip-danger-bg)',
          'danger-fg': 'var(--chip-danger-fg)',
          'info-bg': 'var(--chip-info-bg)',
          'info-fg': 'var(--chip-info-fg)',
          'lavender-bg': 'var(--chip-lavender-bg)',
          'lavender-fg': 'var(--chip-lavender-fg)',
          'sand-bg': 'var(--chip-sand-bg)',
          'sand-fg': 'var(--chip-sand-fg)',
        },
        success: 'var(--success)',
        'success-fg': 'var(--chip-success-fg)',
        warning: 'var(--warning)',
        'warning-fg': 'var(--chip-warning-fg)',
        danger: 'var(--danger)',
        'danger-fg': 'var(--chip-danger-fg)',
        info: 'var(--info)',
        'info-fg': 'var(--chip-info-fg)',
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
        // Новая шкала Phase A
        'card-soft': 'var(--shadow-card-soft)',
        'card-raised': 'var(--shadow-card-raised)',
        'accent-focus': 'var(--shadow-accent-focus)',
        modal: 'var(--shadow-modal)',
        // Legacy aliases — Phase B/D почистят
        soft: 'var(--shadow-card-soft)',
        elevated: 'var(--shadow-card-raised)',
        glow: 'var(--shadow-accent-focus)',
        'glow-mint': 'var(--shadow-accent-focus)',
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
  plugins: [
    animate,
    // Утилита `scrollbar-none` — скрываем скроллбар, но скролл остаётся
    // (для горизонтальных pill-фильтров на mobile).
    plugin(({ addUtilities }) => {
      addUtilities({
        '.scrollbar-none': {
          'scrollbar-width': 'none',
          '-ms-overflow-style': 'none',
        },
        '.scrollbar-none::-webkit-scrollbar': {
          display: 'none',
        },
      });
    }),
  ],
};

export default config;
