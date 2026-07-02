import { describe, expect, it } from 'vitest';

import { detectMultiHop } from './chat-v2.service';

describe('detectMultiHop — эвристика многошаговости вопроса', () => {
  it('фразовые маркеры «то, что» → true', () => {
    expect(detectMultiHop('Кто отвечает за то, что блокирует продажи?')).toBe(true);
  });

  it('«из-за чего» → true', () => {
    expect(detectMultiHop('Из-за чего срываются сделки?')).toBe(true);
  });

  it('«который» + chain-verb «блокир» → true', () => {
    expect(detectMultiHop('Кто отвечает за задачу, которая блокирует релиз?')).toBe(true);
  });

  it('«что стоит за» → true', () => {
    expect(detectMultiHop('Что стоит за оттоком клиентов?')).toBe(true);
  });

  it('«который» без chain-verb → false', () => {
    expect(detectMultiHop('Кто ответственный за клиента, который жалуется?')).toBe(false);
  });

  it('простой фактический вопрос → false', () => {
    expect(detectMultiHop('Что с ошибкой 429?')).toBe(false);
  });

  it('chain-verb «отвечает за» без «который» и без фраз → false', () => {
    expect(detectMultiHop('Кто отвечает за продажи?')).toBe(false);
  });

  it('вопрос про риски → false', () => {
    expect(detectMultiHop('Какие риски по проекту?')).toBe(false);
  });

  it('вопрос про бюджет → false', () => {
    expect(detectMultiHop('Что решили по бюджету?')).toBe(false);
  });
});
