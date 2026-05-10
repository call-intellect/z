import { NextResponse, type NextRequest } from 'next/server';

/**
 * Защита маршрутов:
 *   - `(authenticated)` группа (`/meetings`, `/meetings/create`,
 *     `/meetings/:id/result`, `/tasks`, `/settings/*`, `/integrations`)
 *     требует cookie `z_session`. Если её нет — редирект на `/`.
 *   - `(admin)` — редирект на `/login` если нет cookie.
 *   - Публичные роуты: `/`, `/login`, `/signup`, `/forgot-password`,
 *     `/reset-password`, `/m/*`, `/share/*`,
 *     `/journal-reference`, `/meeting-reference` (design previews для апрува).
 *
 * Здесь мы НЕ валидируем JWT внутри cookie — только проверяем её наличие.
 * Если cookie битая — backend на любом запросе вернёт 401, `apiClient`
 * сэмитит `auth:expired`, и `AuthProvider` сбросит user.
 */
const SESSION_COOKIE = 'z_session';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/meetings',
  '/tasks',
  '/settings',
  '/integrations',
  '/invitations',
];
const ADMIN_PREFIX = '/admin';

const PUBLIC_EXACT = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/admin/login',
  '/journal-reference',
  '/meeting-reference',
]);

const PUBLIC_PREFIXES = ['/m/', '/share/', '/reset-password/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAdmin =
    pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);

  if (!isProtected && !isAdmin) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (hasSession) {
    return NextResponse.next();
  }

  // Без cookie — для /admin/* на /admin/login, остальные на /login (next).
  const url = req.nextUrl.clone();
  if (isAdmin) {
    url.pathname = '/admin/login';
    url.search = '';
  } else {
    url.pathname = '/login';
    // Сохраняем `?next=` чтобы после логина вернуться куда хотели.
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Исключаем статику, /m/* (public), Next-internals и /api/* (proxy если будет).
    '/((?!_next/static|_next/image|favicon.ico|m/|api/).*)',
  ],
};
