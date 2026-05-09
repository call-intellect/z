/**
 * Валидация пароля на клиенте — синхронизирована с backend
 * `STRONG_PASSWORD_RX` из `dto/reset-password.dto.ts`.
 *
 * Правила: минимум 8 символов, минимум одна буква (любой алфавит) и одна
 * цифра. Серверный regex — источник правды; здесь — мягкая UX-проверка.
 */

const PASSWORD_RX = /^(?=.*[A-Za-zА-Яа-я])(?=.*\d).{8,}$/;

export interface PasswordValidationResult {
  valid: boolean;
  /** Локализованная причина при `valid=false`. */
  message?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Минимум 8 символов.' };
  }
  if (!PASSWORD_RX.test(password)) {
    return { valid: false, message: 'Пароль должен содержать букву и цифру.' };
  }
  return { valid: true };
}

export function passwordsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}
