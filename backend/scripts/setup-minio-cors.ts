import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const ENDPOINT = process.env.S3_ENDPOINT_URL ?? 'http://localhost:59000';
const BUCKET = process.env.S3_BUCKET ?? 'meetings-dev';
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'z_minio_dev';
const SECRET_KEY = process.env.S3_SECRET_KEY ?? 'z_minio_dev_password';
const REGION = process.env.S3_REGION ?? 'us-east-1';

const client = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const origins = ['http://localhost:3001', 'http://localhost:3000', 'http://localhost:8080'];

await client.send(
  new PutBucketCorsCommand({
    Bucket: BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'ETag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.log(`✓ CORS настроен на bucket "${BUCKET}" (${ENDPOINT})`);
console.log(`  Разрешённые origins: ${origins.join(', ')}`);
