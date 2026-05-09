import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * E2E-тесты делят одну тестовую БД и пишут в одни и те же таблицы.
 * При параллельном запуске двух e2e-файлов `afterEach` одного из них
 * сносит данные второго — получаем flakey тесты.
 *
 * Решение: запускаем все test-files в одном пуле последовательно
 * (`fileParallelism: false`). Юнит-тесты быстрые — это не больно.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/workers/main.ts'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
