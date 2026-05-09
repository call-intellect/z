import { NextResponse, type NextRequest } from 'next/server';

/**
 * Защита маршрутов:
 *   - `(authenticated)` группа (`/meetings`, `/meetings/create`,
 *     `/meetings/:id/result`) требует cookie `z_session`. Если её нет —
 *     редирект на `/`.
 *   - `(admin)` — Phase 8 (пока пропускаем).
 *   - `(public)` (`/m/:id`, `/`) — без проверок.
 *
 * Здесь мы НЕ валидируем JWT внутри cookie — только проверяем её наличие.
 * Если cookie битая — backend на любом запросе вернёт 401, `apiClient`
 * сэмитит `auth:expired`, и `AuthProvider` сбросит user.
 *
 * `matcher` исключает статику, /m/, /, /api proxy и Next-internal.
 */
const SESSION_COOKIE = 'z_session';

const PROTECTED_PREFIXES = ['/meetings'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (hasSession) {
    return NextResponse.next();
  }

  // Без cookie — на главную.
  const url = req.nextUrl.clone();
  url.pathname = '/';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Исключаем статику, /m/* (public), Next-internals и /api/* (proxy если будет).
    '/((?!_next/static|_next/image|favicon.ico|m/|api/).*)',
  ],
};
