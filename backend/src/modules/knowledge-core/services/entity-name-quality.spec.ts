import { describe, it, expect } from 'vitest';

import {
  classifyEntityName,
  isJunkEntityName,
  type EntityNameRejectReason,
} from './entity-name-quality';

describe('classifyEntityName / isJunkEntityName', () => {
  const positives = [
    'ОКК',
    'SEO',
    'Telegram',
    'Битрикс',
    'база клиентов',
    'Молочные реки',
    'VK',
  ];

  const negatives = [
    'MANA-7',
    'DEVE-4',
    'MANA-7 (Изучить сервис)',
    '+79782516469',
    'alekseyorlov998@gmail.com',
    '7',
    '—',
    '12345',
  ];

  it.each(positives)('accepts valid name %s', (name) => {
    expect(classifyEntityName(name).ok).toBe(true);
    expect(classifyEntityName(name).reason).toBe(null);
    expect(isJunkEntityName(name)).toBe(false);
  });

  it.each(negatives)('rejects junk name %s', (name) => {
    expect(classifyEntityName(name).ok).toBe(false);
    expect(isJunkEntityName(name)).toBe(true);
  });

  it.each<[string, EntityNameRejectReason]>([
    ['MANA-7', 'task_id'],
    ['+79782516469', 'phone'],
    ['a@b.cd', 'email'],
    ['12345', 'numeric_only'],
  ])('classifies %s with reason %s', (name, reason) => {
    expect(classifyEntityName(name).reason).toBe(reason);
  });
});
