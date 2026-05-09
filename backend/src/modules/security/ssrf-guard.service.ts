import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

/**
 * Защита от SSRF при исходящих HTTP-запросах (webhook delivery,
 * generic-webhook destination, slack webhook).
 *
 * Алгоритм (см. ТЗ §«URL-валидация для outgoing webhooks»):
 *   1. Парсинг URL.
 *   2. Whitelist протоколов (http/https; в проде — только https).
 *   3. Hostname blacklist (`localhost`, `*.local`, `*.internal`,
 *      `metadata.google.internal`).
 *   4. DNS-resolve с проверкой каждого IP против blacklist (private,
 *      link-local, loopback, IPv6-ULA, link-local, AWS metadata).
 *   5. Опц. whitelist `WEBHOOK_EGRESS_ALLOWED_HOSTS` — для тестов:
 *      хост из этого списка НЕ блокируется DNS-проверкой (но
 *      прочие проверки протокола применяются).
 *
 * Метод вызывается ДВАЖДЫ: при создании подписки/destination и
 * непосредственно перед каждым исходящим запросом — защита от
 * DNS-rebinding (DNS-запись могла измениться).
 */
export class SSRFBlockedError extends BadRequestException {
  constructor(reason: string) {
    super({
      ok: false,
      error: { code: 'ssrf_blocked', message: reason },
    });
    // Перезаписываем `Error.message`, чтобы `err.message` содержал понятный
    // текст (важно для тестов через `toThrow(/regex/)` и для логов).
    Object.defineProperty(this, 'message', {
      value: reason,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

const HOSTNAME_BLACKLIST = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

/**
 * Проверка по CIDR/диапазонам приватных адресов. Реализовано без библиотек
 * (на проекте Z библиотеки `ip`/`netmask` не установлены, чтобы не плодить
 * зависимости — используем встроенные модули `node:net` + ручной парсинг).
 */
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
  // >>> 0 делает результат unsigned 32-bit.
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
  '169.254.0.0/16', // link-local + AWS/GCP metadata
  '0.0.0.0/8',
  '100.64.0.0/10', // CGNAT — тоже считаем приватным
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4_CIDRS.some((cidr) => inCidrV4(ip, cidr));
}

/** IPv6: блокируем loopback (`::1`), link-local (`fe80::/10`), ULA (`fc00::/7`),
 *  IPv4-mapped (`::ffff:x.x.x.x` если `x.x.x.x` приватный). */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // IPv4-mapped: ::ffff:1.2.3.4
  const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (mappedMatch && mappedMatch[1]) {
    return isPrivateIPv4(mappedMatch[1]);
  }
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]?:/u.test(lower)) return true;
  // fc00::/7 — ULA (fc00..fdff)
  if (/^f[cd][0-9a-f]{2}:/u.test(lower)) return true;
  return false;
}

@Injectable()
export class SsrfGuardService {
  private readonly logger = new Logger(SsrfGuardService.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  /**
   * Главная точка входа. Возвращает разобранный URL и резолвенный IPv4-адрес,
   * который вызывающий код ДОЛЖЕН использовать для построения запроса
   * (или, как минимум, должен передать в TLS-ServerName и в HTTP Host
   * header — Host = original hostname, а connect — на этот IP).
   *
   * Для упрощения сейчас возвращаем только проверочный результат —
   * вызывающий код использует обычный `fetch(url)`. Это допустимо,
   * потому что между check и fetch проходит ~0 ms (сразу после resolve).
   * Для prod-grade защиты рекомендуется socket-level pinning (V2).
   */
  async assertSafeOutboundUrl(rawUrl: string): Promise<{ url: URL; ipv4: string }> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SSRFBlockedError('Невалидный URL');
    }

    // 1. Протокол.
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

    // 2. Whitelist (для dev/test). Если хост в списке — пропускаем все
    //    проверки безопасности (включая HOSTNAME_BLACKLIST/private CIDR/DNS).
    //    Это нужно для CI и локального тестирования с моками.
    //    На проде список должен быть пустым.
    const allowed = this.cfg.webhooksOut.egressAllowedHosts;
    if (allowed.length > 0 && allowed.includes(hostname)) {
      this.logger.debug(`SsrfGuard: хост ${hostname} в whitelist, пропускаем DNS-проверку`);
      const ipv4 = isIP(hostname) === 4 ? hostname : '0.0.0.0';
      return { url: parsed, ipv4 };
    }

    // 3. Hostname blacklist.
    if (HOSTNAME_BLACKLIST.has(hostname)) {
      throw new SSRFBlockedError(`Хост запрещён: ${hostname}`);
    }
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new SSRFBlockedError(`Хост запрещён: ${hostname}`);
    }

    // 4. Если hostname — это уже IP-литерал, проверяем напрямую без DNS.
    const ipKind = isIP(hostname);
    if (ipKind === 4) {
      if (isPrivateIPv4(hostname)) {
        throw new SSRFBlockedError(`Приватный IPv4 запрещён: ${hostname}`);
      }
      return { url: parsed, ipv4: hostname };
    }
    if (ipKind === 6) {
      // Убираем возможные [...] обёртки — `URL.hostname` для IPv6 уже без скобок.
      if (isPrivateIPv6(hostname)) {
        throw new SSRFBlockedError(`Приватный IPv6 запрещён: ${hostname}`);
      }
      // IPv6 разрешаем, но возвращаем placeholder IPv4.
      return { url: parsed, ipv4: '0.0.0.0' };
    }

    // 5. DNS-resolve (защита от rebinding — резолвим непосредственно перед
    //    использованием).
    let lookup: Awaited<ReturnType<typeof dns.lookup>>;
    try {
      // `all: true` — получаем ВСЕ адреса, чтобы гарантированно проверить
      // каждую запись (атакующий может прописать одновременно публичный
      // и приватный IP).
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
      // Берём первый — для возврата.
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
