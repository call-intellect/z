import { describe, expect, it } from 'vitest';

import { DisposableEmailService } from './disposable-email.service';

describe('DisposableEmailService', () => {
  const svc = new DisposableEmailService();

  it('распознаёт mailinator.com', () => {
    expect(svc.isDisposable('foo@mailinator.com')).toBe(true);
  });

  it('распознаёт yopmail.com', () => {
    expect(svc.isDisposable('user@yopmail.com')).toBe(true);
  });

  it('распознаёт guerrillamail.com', () => {
    expect(svc.isDisposable('a@guerrillamail.com')).toBe(true);
  });

  it('распознаёт throwaway.email', () => {
    expect(svc.isDisposable('a@throwaway.email')).toBe(true);
  });

  it('не считает gmail.com одноразовым', () => {
    expect(svc.isDisposable('user@gmail.com')).toBe(false);
  });

  it('не считает корпоративные домены одноразовыми', () => {
    expect(svc.isDisposable('user@crossmark.ru')).toBe(false);
    expect(svc.isDisposable('user@yandex.ru')).toBe(false);
  });

  it('нормализует регистр и пробелы', () => {
    expect(svc.isDisposable('  USER@MAILINATOR.COM  ')).toBe(true);
  });

  it('возвращает false на невалидном email', () => {
    expect(svc.isDisposable('not-an-email')).toBe(false);
    expect(svc.isDisposable('user@')).toBe(false);
    expect(svc.isDisposable('')).toBe(false);
  });

  it('size возвращает положительное число', () => {
    expect(svc.size()).toBeGreaterThan(40);
  });
});
