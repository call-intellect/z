/**
 * Тип входных данных промпта (A0.2, мастер-ТЗ). Машинный гард: raw-* входы
 * ОБЯЗАНЫ оборачиваться через applyInputGuards/wrapUserData (CI-lint
 * backend/scripts/lint-input-guards.ts).
 *
 * - raw-transcript — сырой транскрипт встречи (ASR-вывод участников);
 * - raw-user-text — сырой пользовательский текст (custom prompt, заголовок,
 *   сообщение чата, внешний канал intake/telegram);
 * - derived — текст, уже произведённый нашим кодом из проверенных данных;
 * - machine — структурированный машинный вход (id, числа, JSON), без NL-инъекции.
 */
export type InputKind = 'raw-transcript' | 'raw-user-text' | 'derived' | 'machine';

/** raw-входы, требующие обёртки guard'ом. */
export const RAW_INPUT_KINDS: readonly InputKind[] = ['raw-transcript', 'raw-user-text'];

export function isRawInputKind(kind: InputKind): boolean {
  return RAW_INPUT_KINDS.includes(kind);
}
