import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

export class SSRFBlockedError extends BadRequestException {
  constructor(reason: string) {
    super({
      ok: false,
      error: { code: 'ssrf_blocked', message: reason },
    });
    Object.defineProperty(this, 'message', {
      value: reason,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

const HOSTNAME_BLACKLIST = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (part === undefined) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  if (base === undefined || prefixStr === undefined) return false;
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const baseInt = ipv4ToInt(base);
  const ipInt = ipv4ToInt(ip);
  if (baseInt === null || ipInt === null) return false;
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

const PRIVATE_V4_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '0.0.0.0/8',
  '100.64.0.0/10',
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4_CIDRS.some((cidr) => inCidrV4(ip, cidr));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (mappedMatch && mappedMatch[1]) {
    return isPrivateIPv4(mappedMatch[1]);
  }
  if (/^fe[89ab][0-9a-f]?:/u.test(lower)) return true;
  if (/^f[cd][0-9a-f]{2}:/u.test(lower)) return true;
  return false;
}

@Injectable()
export class SsrfGuardService {
  private readonly logger = new Logger(SsrfGuardService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async assertSafeOutboundUrl(rawUrl: string): Promise<{ url: URL; ipv4: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SSRFBlockedError('Невалидный URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SSRFBlockedError(`Запрещённый протокол: ${parsed.protocol}`);
    }
    if (this.cfg.runtime.isProduction && parsed.protocol !== 'https:') {
      throw new SSRFBlockedError('В production разрешён только HTTPS');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) {
      throw new SSRFBlockedError('URL без hostname');
    }

    const allowed = this.cfg.webhooksOut.egressAllowedHosts;
    if (allowed.length > 0 && allowed.includes(hostname)) {
      this.logger.debug(`SsrfGuard: хост ${hostname} в whitelist, пропускаем DNS-проверку`);
      const ipv4 = isIP(hostname) === 4 ? hostname : '0.0.0.0';
      return { url: parsed, ipv4 };
    }

    if (HOSTNAME_BLACKLIST.has(hostname)) {
      throw new SSRFBlockedError(`Хост запрещён: ${hostname}`);
    }
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new SSRFBlockedError(`Хост запрещён: ${hostname}`);
    }

    const ipKind = isIP(hostname);
    if (ipKind === 4) {
      if (isPrivateIPv4(hostname)) {
        throw new SSRFBlockedError(`Приватный IPv4 запрещён: ${hostname}`);
      }
      return { url: parsed, ipv4: hostname };
    }
    if (ipKind === 6) {
      if (isPrivateIPv6(hostname)) {
        throw new SSRFBlockedError(`Приватный IPv6 запрещён: ${hostname}`);
      }
      return { url: parsed, ipv4: '0.0.0.0' };
    }

    let lookup: Awaited<ReturnType<typeof dns.lookup>>;
    try {
      const results = await dns.lookup(hostname, { all: true });
      if (results.length === 0) {
        throw new SSRFBlockedError(`DNS не разрезолвил ${hostname}`);
      }
      for (const r of results) {
        if (r.family === 4 && isPrivateIPv4(r.address)) {
          throw new SSRFBlockedError(`DNS вернул приватный IPv4: ${r.address}`);
        }
        if (r.family === 6 && isPrivateIPv6(r.address)) {
          throw new SSRFBlockedError(`DNS вернул приватный IPv6: ${r.address}`);
        }
      }
      const first = results[0];
      lookup = first ?? { address: '0.0.0.0', family: 4 };
    } catch (err) {
      if (err instanceof SSRFBlockedError) throw err;
      throw new SSRFBlockedError(
        `DNS lookup упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { url: parsed, ipv4: lookup.address };
  }
}
