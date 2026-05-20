// Tailwind 4: PostCSS-плагин вынесен в отдельный пакет @tailwindcss/postcss.
// Autoprefixer и import-обработка теперь встроены в Tailwind — отдельные плагины не нужны.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
