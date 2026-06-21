import { describe, expect, it } from 'vitest';

import { mapExistenceConfirmAnswer } from './existence-confirm.util';

describe('mapExistenceConfirmAnswer', () => {
  it('«Удалить» → reject', () => {
    expect(mapExistenceConfirmAnswer('Удалить')).toEqual({
      decisionType: 'reject',
    });
  });

  it('«Переименовать» → approve_with_edits / name', () => {
    expect(mapExistenceConfirmAnswer('Переименовать')).toEqual({
      decisionType: 'approve_with_edits',
      field: 'name',
    });
  });

  it('«Назначить владельца» → approve_with_edits / ownerPersonId', () => {
    expect(mapExistenceConfirmAnswer('Назначить владельца')).toEqual({
      decisionType: 'approve_with_edits',
      field: 'ownerPersonId',
    });
  });

  it('«Оставить» → approve', () => {
    expect(mapExistenceConfirmAnswer('Оставить')).toEqual({
      decisionType: 'approve',
    });
  });

  it('«Подтверждаю» → approve', () => {
    expect(mapExistenceConfirmAnswer('Подтверждаю')).toEqual({
      decisionType: 'approve',
    });
  });

  it('case-insensitive по подстроке: «давайте оставим как есть» → approve', () => {
    expect(mapExistenceConfirmAnswer('давайте оставим как есть')).toEqual({
      decisionType: 'approve',
    });
  });

  it('«удал» приоритетнее «переименов» в смешанном тексте', () => {
    expect(mapExistenceConfirmAnswer('Удалить, не переименовывать')).toEqual({
      decisionType: 'reject',
    });
  });

  it('«непонятный ответ» → null', () => {
    expect(mapExistenceConfirmAnswer('непонятно')).toBeNull();
  });

  it('пустая строка → null', () => {
    expect(mapExistenceConfirmAnswer('')).toBeNull();
  });
});
