/** @type {import('next').NextConfig} */

// Полный CSP с whitelist под все нужды Z:
//   - default-src 'self' — всё локальное по умолчанию.
//   - script-src 'self' 'unsafe-inline' — Next.js RSC требует inline-скриптов.
//     'unsafe-eval' оставляем только в dev (HMR). В prod — убран.
//   - style-src 'self' 'unsafe-inline' — Tailwind/Next.js inject inline-стили.
//   - connect-src 'self' ${BACKEND} ${LIVEKIT} wss://*.crossmark.ru — XHR/WS.
//   - media-src 'self' blob: — LiveKit аудио/видео-треки приходят как blob.
//   - img-src 'self' blob: data: https: — аватарки + LiveKit-snapshots.
//   - frame-ancestors 'none' — защита от clickjacking + business-rule (Crossmark
//     встраивает Z как внешнюю ссылку, не iframe).
//   - object-src 'none' — никаких <object>/<embed>.
//
// Источники для connect-src на prod подставляются из ENV
// (NEXT_PUBLIC_BACKEND_URL, NEXT_PUBLIC_LIVEKIT_URL). Локально — http://localhost.
const isProd = process.env.NODE_ENV === 'production';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'wss://media.crossmark.ru';

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-eval' — только в dev (Next.js HMR). В prod — недопустимо.
  isProd
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${backendUrl} ${livekitUrl} wss://*.crossmark.ru ${isProd ? '' : 'http://localhost:3000 ws://localhost:3000'}`.trim(),
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: cspDirectives.join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), display-capture=(self)',
  },
  // HSTS — только в prod (когда TLS реально стоит на nginx).
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains',
        },
      ]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@livekit/components-react',
    '@livekit/components-styles',
    'livekit-client',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
