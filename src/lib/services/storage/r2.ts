import type { R2Bucket } from "@cloudflare/workers-types/index.ts";

import {
  normalizeStorageKey,
  StorageObjectNotFoundError,
  type StorageService,
} from "./types.ts";

/** Private R2 access through a request-scoped Worker binding. */
export function createR2StorageService(bucket: R2Bucket): StorageService {
  const bucketName = "r2";

  async function get(key: string) {
    const normalizedKey = normalizeStorageKey(key);
    const object = await bucket.get(normalizedKey);
    if (!object) throw new StorageObjectNotFoundError(normalizedKey);
    return { normalizedKey, object };
  }

  return {
    async deleteObject(key) {
      await bucket.delete(normalizeStorageKey(key));
    },
    async getObject(key) {
      const { normalizedKey, object } = await get(key);
      return {
        bucketName,
        key: normalizedKey,
        body: new Uint8Array(await object.arrayBuffer()),
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        etag: object.etag,
      };
    },
    async getObjectStream(key) {
      const { normalizedKey, object } = await get(key);
      const reader = object.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) controller.close();
            else controller.enqueue(new Uint8Array(result.value));
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return {
        bucketName,
        key: normalizedKey,
        contentLength: object.size,
        contentType: object.httpMetadata?.contentType,
        stream,
      };
    },
    async headObject(key) {
      const normalizedKey = normalizeStorageKey(key);
      const object = await bucket.head(normalizedKey);
      return object
        ? {
            bucketName,
            key: normalizedKey,
            exists: true,
            contentLength: object.size,
            contentType: object.httpMetadata?.contentType,
            etag: object.etag,
          }
        : { bucketName, key: normalizedKey, exists: false };
    },
    async putObject(input) {
      const key = normalizeStorageKey(input.key);
      const onlyIf = input.keepExisting ? { etagDoesNotMatch: "*" } : undefined;
      await bucket.put(key, new Uint8Array(input.body), {
        httpMetadata: { contentType: input.contentType },
        ...(onlyIf ? { onlyIf } : {}),
      });
      // A failed conditional write returns null, meaning the existing object
      // was kept, which is the requested keepExisting behavior.
      return { bucketName, key };
    },
  };
}
