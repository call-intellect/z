/**
 * Wave 2 polish T6-6c — глобальный setup для vitest.
 *
 * Подключает custom matchers `@testing-library/jest-dom` (toBeInTheDocument,
 * toHaveTextContent и т.д.) к глобальному `expect` vitest.
 */
import '@testing-library/jest-dom/vitest';
