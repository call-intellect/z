/**
 * Регрессия на баг «не удаётся создать сотрудника» (validation_error, 2026-06-03).
 *
 * UI-модель использует fullName/departmentId, а бэкенд CreatePersonSchema ждёт
 * name/primaryDepartmentId. personsDomainApi.create/update обязаны мапить имена
 * полей, иначе бэк отвечает «Имя сотрудника обязательно» (path: name).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { personsDomainApi } from './structure.api';

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
    return Promise.resolve(new Response(JSON.stringify({ person: {} }), { status: 200 }));
  });
  return calls;
}

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

describe('personsDomainApi — маппинг полей UI → бэкенд-контракт', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('create: fullName→name, departmentId→primaryDepartmentId', async () => {
    const calls = captureFetch();
    await personsDomainApi.create('org1', {
      fullName: 'Никитося',
      email: 'tozix@yandex.ru',
      roleId: null,
      departmentId: null,
    });

    expect(calls[0].url).toContain('/api/v1/persons');
    const body = bodyOf(calls[0].init);
    expect(body).toEqual({
      name: 'Никитося',
      email: 'tozix@yandex.ru',
      primaryDepartmentId: null,
      roleId: null,
    });
    expect(body).not.toHaveProperty('fullName');
    expect(body).not.toHaveProperty('departmentId');
  });

  it('update: маппит только переданные поля (fullName→name, departmentId→primaryDepartmentId)', async () => {
    const calls = captureFetch();
    await personsDomainApi.update('org1', 'p1', {
      fullName: 'Новое имя',
      departmentId: 'dep1',
    });

    const body = bodyOf(calls[0].init);
    expect(body).toEqual({ name: 'Новое имя', primaryDepartmentId: 'dep1' });
  });

  it('update: roleId:null прокидывается (снять должность)', async () => {
    const calls = captureFetch();
    await personsDomainApi.update('org1', 'p1', { roleId: null });

    expect(bodyOf(calls[0].init)).toEqual({ roleId: null });
  });
});
