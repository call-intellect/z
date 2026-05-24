/**
 * Setup для integration-тестов knowledge-core/api (Phase F.2).
 *
 * В отличие от обычного `test/setup-test-env.ts`, здесь DATABASE_URL и
 * REDIS_URL указывают на реально поднятый dev-стек (docker-compose.dev.yml),
 * чтобы можно было дёргать настоящий Postgres + pgvector и проверять
 * RBAC/Tenant-фенсы на живых данных.
 *
 * Если до dev-стека не достучаться — тесты skip'нутся через guard в
 * `db-availability.ts`. Это нормально для CI без docker.
 *
 * Этот файл подключается через `vitest.workspace`/inline includes в самих
 * specs (не глобально), чтобы не ломать обычные unit-тесты.
 */

const TEST_DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ??
  'postgresql://z_app:z_app_dev_password@127.0.0.1:55435/z_main';

const TEST_REDIS_URL =
  process.env.INTEGRATION_REDIS_URL ?? 'redis://127.0.0.1:56381';

// Только если пользователь не задал явно — иначе уважаем явный override.
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('5432/test')) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}
if (!process.env.REDIS_URL || process.env.REDIS_URL === 'redis://localhost:6379') {
  process.env.REDIS_URL = TEST_REDIS_URL;
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
