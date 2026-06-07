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
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' blob: data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // LiveKit-клиент перед WS делает HTTP(S)-validate на тот же хост — нужен и http(s)-вариант livekit-URL.
  `connect-src 'self' ${backendUrl} ${livekitUrl} ${livekitUrl.replace(/^ws/, 'http')} wss://*.crossmark.ru https: ${isProd ? '' : 'http://localhost:3000 ws://localhost:3000 http://localhost:7880 ws://localhost:7880 wss://localhost:7880 http://localhost:59000'}`.trim(),
  // S3 presigned URLs — MinIO в dev на :59000, HTTPS S3 в prod.
  // blob: — LiveKit аудио/видео-треки. https: — любой HTTPS S3.
  `media-src 'self' blob: https: ${isProd ? '' : 'http://localhost:59000 http://localhost:3000'}`.trim(),
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
  // Самодостаточная сборка (server.js + минимальные node_modules) для запуска
  // фронта контейнером: `bun server.js`. nginx на хосте проксирует. См. deploy/README.md.
  output: 'standalone',
  // git sha сборки → штатная защита Next от version skew: при несовпадении
  // билда клиента и сервера выполняется hard MPA-navigation (полная перезагрузка
  // с ассетами нового билда). Пусто при локальной сборке без build-arg — это ок
  // (skew-защита просто неактивна). next.config — build-time, чтение process.env здесь штатно.
  deploymentId: process.env.DEPLOYMENT_VERSION,
  transpilePackages: [
    '@livekit/components-react',
    '@livekit/components-styles',
    'livekit-client',
    '@vidstack/react',
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

export default nextConfig;
