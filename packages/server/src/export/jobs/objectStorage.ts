import fs from 'fs';
import path from 'path';
import type { ExportFormat } from '../types';
import { formatExtension } from './artifactStore';

export interface StoredArtifact {
  filePath: string;
  storageUri: string | null;
  sha256: string;
  bytes: number;
}

function minioConfigured(): boolean {
  return Boolean(
    process.env.MINIO_ENDPOINT
    && process.env.MINIO_BUCKET
    && process.env.MINIO_ACCESS_KEY
    && process.env.MINIO_SECRET_KEY,
  );
}

export async function uploadArtifactIfConfigured(
  jobId: string,
  format: ExportFormat,
  localPath: string,
  sha256: string,
): Promise<string | null> {
  if (!minioConfigured() || !fs.existsSync(localPath)) return null;

  try {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const key = `exports/${jobId}.${formatExtension(format)}`;
    const client = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
      forcePathStyle: true,
    });

    const body = fs.readFileSync(localPath);
    await client.send(new PutObjectCommand({
      Bucket: process.env.MINIO_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(format),
      Metadata: { sha256 },
    }));

    return `s3://${process.env.MINIO_BUCKET}/${key}`;
  } catch {
    return null;
  }
}

export async function resolveSignedDownloadUrl(storageUri: string): Promise<string | null> {
  if (!storageUri.startsWith('s3://') || !minioConfigured()) return null;

  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const withoutScheme = storageUri.slice('s3://'.length);
    const slash = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slash);
    const key = withoutScheme.slice(slash + 1);

    const client = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
      },
      forcePathStyle: true,
    });

    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 3600,
    });
  } catch {
    return null;
  }
}

function contentTypeFor(format: ExportFormat): string {
  if (format === 'PDF') return 'application/pdf';
  if (format === 'XLSX') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'text/csv';
}

export function removePartialArtifact(filePath: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const htmlSibling = path.join(dir, `${base}.html`);
    if (fs.existsSync(htmlSibling)) fs.unlinkSync(htmlSibling);
  } catch {
    /* best-effort cleanup */
  }
}
