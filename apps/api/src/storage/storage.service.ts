import { createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { safeEqualHex } from '../auth/auth.crypto.js';
import { env } from '../config/env.js';

const LINK_TTL_SECONDS = 60 * 60;

/**
 * Photos and documents. Files live in object storage (SeaweedFS locally,
 * Amazon S3 in production) and are never public: the apps display them
 * through short-lived signed links that this service issues and checks.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  private readonly s3 = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT, forcePathStyle: true }),
    ...(env.S3_ACCESS_KEY &&
      env.S3_SECRET_KEY && { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } }),
  });

  /** Locally the bucket may not exist yet; in production it is created by infrastructure. */
  async onModuleInit() {
    if (!env.S3_ENDPOINT) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
        this.logger.log(`Created local bucket ${env.S3_BUCKET}`);
      } catch (error) {
        this.logger.warn(`Could not reach object storage at ${env.S3_ENDPOINT}: ${String(error)}`);
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Readable> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return result.Body as Readable;
  }

  /** The whole file in memory. Only for files we need to process, such as a licence to be read. */
  async getBuffer(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.get(key)) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }

  /** A link to an attachment's content that works for the next hour without logging in. */
  signedPath(attachmentId: string): string {
    const expires = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
    return `/attachments/${attachmentId}/content?exp=${expires}&sig=${this.signature(attachmentId, expires)}`;
  }

  verifySignedPath(attachmentId: string, expires: number, signature: string): boolean {
    if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
    return safeEqualHex(this.signature(attachmentId, expires), signature);
  }

  private signature(attachmentId: string, expires: number): string {
    return createHmac('sha256', env.FILE_URL_SECRET).update(`${attachmentId}:${expires}`).digest('hex');
  }
}
