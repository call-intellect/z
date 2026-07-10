import { describe, expect, it } from 'vitest';

import { proxyRootUrl, resolveEffectiveConnection } from './effective-connection.util';

const PROXY = { baseUrl: 'https://proxy.agent-lia.ru/v1', prefix: 'myFeedproxy3128' };

describe('proxyRootUrl', () => {
  it('срезает хвостовой /v1', () => {
    expect(proxyRootUrl(PROXY)).toBe('https://proxy.agent-lia.ru');
  });

  it('срезает /v1/ со слэшем', () => {
    expect(proxyRootUrl({ ...PROXY, baseUrl: 'https://proxy.agent-lia.ru/v1/' })).toBe(
      'https://proxy.agent-lia.ru',
    );
  });

  it('без /v1 возвращает как есть', () => {
    expect(proxyRootUrl({ ...PROXY, baseUrl: 'https://proxy.agent-lia.ru' })).toBe(
      'https://proxy.agent-lia.ru',
    );
  });
});

describe('resolveEffectiveConnection', () => {
  it('useProxy=false → baseUrl/apiKey без изменений', () => {
    const r = resolveEffectiveConnection(
      { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', useProxy: false, proxyPath: null },
      PROXY,
    );
    expect(r).toEqual({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x' });
  });

  it('useProxy=true, proxyPath=null → baseUrl прокси как есть, ключ с префиксом', () => {
    const r = resolveEffectiveConnection(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', useProxy: true, proxyPath: null },
      PROXY,
    );
    expect(r).toEqual({
      baseUrl: 'https://proxy.agent-lia.ru/v1',
      apiKey: 'myFeedproxy3128:sk-x',
    });
  });

  it('useProxy=true, proxyPath="grsai" → корень прокси + слаг + /v1', () => {
    const r = resolveEffectiveConnection(
      { baseUrl: 'https://grsaiapi.com', apiKey: 'sk-x', useProxy: true, proxyPath: 'grsai' },
      PROXY,
    );
    expect(r).toEqual({
      baseUrl: 'https://proxy.agent-lia.ru/grsai/v1',
      apiKey: 'myFeedproxy3128:sk-x',
    });
  });

  it('useProxy=true без ключа → ключ не префиксуется (остаётся null)', () => {
    const r = resolveEffectiveConnection(
      { baseUrl: 'https://api.openai.com/v1', apiKey: null, useProxy: true, proxyPath: null },
      PROXY,
    );
    expect(r.apiKey).toBeNull();
  });

  it('anthropic-messages (SDK сам добавляет /v1/messages) + proxyPath → без /v1 в конце', () => {
    const r = resolveEffectiveConnection(
      {
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-x',
        useProxy: true,
        proxyPath: 'anthropic',
        protocolKind: 'anthropic-messages',
      },
      PROXY,
    );
    expect(r).toEqual({
      baseUrl: 'https://proxy.agent-lia.ru/anthropic',
      apiKey: 'myFeedproxy3128:sk-ant-x',
    });
  });

  it('anthropic-messages + proxyPath=null → корень прокси без /v1', () => {
    const r = resolveEffectiveConnection(
      {
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-x',
        useProxy: true,
        proxyPath: null,
        protocolKind: 'anthropic-messages',
      },
      PROXY,
    );
    expect(r.baseUrl).toBe('https://proxy.agent-lia.ru');
  });

  it('kie-native (сервис сам строит /{model}/v1/…) + proxyPath → без /v1 в конце', () => {
    const r = resolveEffectiveConnection(
      {
        baseUrl: 'https://api.kie.ai',
        apiKey: 'k',
        useProxy: true,
        proxyPath: 'kie',
        protocolKind: 'kie-native',
      },
      PROXY,
    );
    expect(r.baseUrl).toBe('https://proxy.agent-lia.ru/kie');
  });

  it('openai-chat с protocolKind → формула с /v1 не меняется', () => {
    const r = resolveEffectiveConnection(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-x',
        useProxy: true,
        proxyPath: null,
        protocolKind: 'openai-chat',
      },
      PROXY,
    );
    expect(r.baseUrl).toBe('https://proxy.agent-lia.ru/v1');
  });
});
