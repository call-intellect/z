import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { SSRFBlockedError, SsrfGuardService } from './ssrf-guard.service';

function makeCfg(overrides?: {
  isProduction?: boolean;
  egressAllowedHosts?: string[];
}): TypedConfigService {
  return {
    runtime: { isProduction: overrides?.isProduction ?? false },
    webhooksOut: {
      egressAllowedHosts: overrides?.egressAllowedHosts ?? [],
    },
  } as unknown as TypedConfigService;
}

describe('SsrfGuardService.assertSafeOutboundUrl', () => {
  it('пропускает обычный публичный HTTPS-URL (через моки DNS)', async () => {
    const svc = new SsrfGuardService(makeCfg({ egressAllowedHosts: ['example.com'] }));
    const result = await svc.assertSafeOutboundUrl('https://example.com/hook');
    expect(result.url.hostname).toBe('example.com');
  });

  it('блокирует javascript:', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('javascript:alert(1)')).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('блокирует file:///etc/passwd', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('блокирует gopher:', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('gopher://example.com/foo')).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('блокирует http:// в production', async () => {
    const svc = new SsrfGuardService(makeCfg({ isProduction: true }));
    await expect(svc.assertSafeOutboundUrl('http://example.com')).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('блокирует localhost', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://localhost:8080/foo')).rejects.toThrow(
      /Хост запрещён/u,
    );
  });

  it('блокирует metadata.google.internal', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(
      svc.assertSafeOutboundUrl('http://metadata.google.internal/foo'),
    ).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it('блокирует *.local', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://server.local/foo')).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });

  it('блокирует 127.0.0.1', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://127.0.0.1:8080')).rejects.toThrow(
      /Приватный IPv4/u,
    );
  });

  it('блокирует 10.0.0.1', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://10.0.0.1')).rejects.toThrow(/Приватный IPv4/u);
  });

  it('блокирует 169.254.169.254 (AWS metadata)', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(
      svc.assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(/Приватный IPv4/u);
  });

  it('блокирует 192.168.1.1', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://192.168.1.1')).rejects.toThrow(
      /Приватный IPv4/u,
    );
  });

  it('блокирует ::1 (IPv6 loopback)', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('http://[::1]:8080/foo')).rejects.toThrow(
      /приватный IPv6/iu,
    );
  });

  it('блокирует пустой URL', async () => {
    const svc = new SsrfGuardService(makeCfg());
    await expect(svc.assertSafeOutboundUrl('not-a-url')).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it('IP-литерал публичного 8.8.8.8 проходит', async () => {
    const svc = new SsrfGuardService(makeCfg());
    const r = await svc.assertSafeOutboundUrl('https://8.8.8.8/foo');
    expect(r.ipv4).toBe('8.8.8.8');
  });

  it('whitelisted host не падает на DNS-проверке', async () => {
    const svc = new SsrfGuardService(
      makeCfg({ egressAllowedHosts: ['hooks.slack.com', 'localhost'] }),
    );
    const r = await svc.assertSafeOutboundUrl('http://localhost/hook');
    expect(r.url.hostname).toBe('localhost');
    vi.restoreAllMocks();
  });
});
