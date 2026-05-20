// ESLint 10 flat config. Next 16 убрал `next lint`, а eslint-config-next под
// ESLint 10 + FlatCompat падает на циклической ссылке — поэтому подключаем
// @next/eslint-plugin-next напрямую + ts-парсер для TSX.
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'build/**', 'next-env.d.ts'] },
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}', '*.{ts,tsx}', 'middleware.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
