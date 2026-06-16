const PASSWORD_RX = /^(?=.*[A-Za-zА-Яа-я])(?=.*\d).{8,}$/;

export const PASSWORD_RULE_HINT =
  "Минимум 8 символов, минимум одна буква и одна цифра.";

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (!password || password.length < 8 || !PASSWORD_RX.test(password)) {
    return { valid: false, message: PASSWORD_RULE_HINT };
  }
  return { valid: true };
}

export function passwordsMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}
