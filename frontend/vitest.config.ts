/**
 * Wave 2 polish T6-6c — конфиг vitest для component-тестов фронта.
 *
 * До T6-6c фронт использовал дефолтный vitest-конфиг (без jsdom и без
 * React plugin), поэтому компонентные тесты через @testing-library/react
 * были невозможны. Этот файл подключает:
 *   - `@vitejs/plugin-react` — для JSX/TSX-трансформа в тестах.
 *   - `environment: 'jsdom'` — DOM-API для рендера компонентов.
 *   - `setupFiles` — глобальные расширения (jest-dom matchers).
 *   - `alias '@'` — тот же резолвер, что в Next.js (tsconfig paths).
 *
 * Скрипт `bun run test:unit` (см. package.json) запускает `vitest run --dir src`,
 * этот конфиг подхватывается автоматически по location.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
