// ESLint 10 flat config (заменил .eslintrc.json — eslintrc больше не поддерживается).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importPlugin, { createNodeResolver } from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/**/*.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', sourceType: 'module', ecmaVersion: 2022 },
      globals: { ...globals.node },
    },
    plugins: { 'import-x': importPlugin },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: './tsconfig.json', alwaysTryTypes: true }),
        createNodeResolver(),
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-unresolved': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Phase 0a — запрет прямого Cypher вне `common/graph/`.
  //
  // Все обращения к Apache AGE — через `GraphService` (двойная запись
  // Postgres EntityLink + AGE гарантируется только внутри сервиса). Прямой
  // `$queryRaw cypher(...)` из бизнес-сервисов приводит к рассинхрону
  // Postgres↔AGE — см. `second-brain/02_architecture/code-pitfalls.md`
  // «Cypher только через GraphService».
  //
  // Escape-hatch: `GraphService.traverse(...)` для сложных запросов
  // (например, ContextBuilder в RoleProfileAgent). Доступен только внутри
  // `common/graph/` и `*/services/context-builder.service.ts` (явно
  // одобренные потребители).
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/common/graph/**',
      // ContextBuilder для RoleProfileAgent — одобренный потребитель traverse.
      'src/modules/role-profiles/services/context-builder.service.ts',
      // Тесты могут вызывать GraphService.traverse напрямую.
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Шаблонные строки с прямым обращением к AGE: `SELECT ... cypher(...)`.
          // esquery не поддерживает inline-флаги `(?i)`, поэтому ловим
          // case-sensitive `cypher(` — это покрывает все реальные случаи.
          selector:
            "TemplateLiteral[quasis.0.value.cooked=/\\bcypher\\s*\\(/]",
          message:
            'Прямой Cypher запрещён вне common/graph/. Используй GraphService (см. second-brain/02_architecture/code-pitfalls.md «Cypher только через GraphService»).',
        },
        {
          // Обычные строковые литералы 'cypher(' / "cypher(".
          selector:
            "Literal[value=/\\bcypher\\s*\\(/]",
          message:
            'Прямой Cypher запрещён вне common/graph/. Используй GraphService.',
        },
      ],
    },
  },
  prettier,
);
