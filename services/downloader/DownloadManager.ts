
import { ParallelDownloader } from './ParallelDownloader';
import { ChunkStore } from './ChunkStore';
import { env } from '@huggingface/transformers';
import { DownloadProgress } from './types';
import { createSHA256 } from 'hash-wasm';

// @ts-expect-error - env.cacheName exists in runtime
const CACHE_NAME = env.cacheName || 'transformers-cache';

export class DownloadManager {
  private static instance: DownloadManager;
  private store: ChunkStore;
  private activeDownloads: Map<string, ParallelDownloader> = new Map();
  private queue: Array<{ url: string, onProgress?: (p: DownloadProgress) => void, resolve: () => void, reject: (err: unknown) => void }> = [];
  private activeCount = 0;
  private readonly MAX_CONCURRENT_FILES = 2; // Mobile friendly limit

  private constructor() {
    this.store = new ChunkStore();
  }

  public static getInstance(): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager();
    }
    return DownloadManager.instance;
  }

  private getCache(): Promise<Cache> {
    return caches.open(CACHE_NAME);
  }

  private extractFilename(url: string): string {
    return url.split('/').pop() || 'unknown';
  }

  public setQuotaErrorHandler(handler: () => Promise<boolean>) {
    // TODO: Implement quota handling in V3
    console.warn('Quota handling not yet implemented in V3', handler);
  }

  public async downloadFile(url: string, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    const cache = await this.getCache();
    const cachedResponse = await cache.match(url);

    if (cachedResponse) {
      const contentLength = cachedResponse.headers.get('Content-Length');
      const expectedSize = contentLength ? parseInt(contentLength, 10) : 0;
      if (expectedSize > 0) {
        onProgress?.({
          loaded: expectedSize,
          total: expectedSize,
          file: this.extractFilename(url)
        });
        return;
      }
    }

    await this.scheduleDownload(url, onProgress);
    await this.finalizeCache(url, cache);
  }

  private async scheduleDownload(url: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
    if (this.activeDownloads.has(url)) {
      // Wait for existing download to complete
      while (this.activeDownloads.has(url)) {
        await new Promise(r => setTimeout(r, 100));
      }
      return;
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ url, onProgress, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.MAX_CONCURRENT_FILES) return;

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    const { url, onProgress, resolve, reject } = item;

    const downloader = new ParallelDownloader(url, this.store, {
      onProgress: (p) => {
        onProgress?.({
          loaded: p.loaded,
          total: p.total,
          file: this.extractFilename(url)
        });
      }
    });

    this.activeDownloads.set(url, downloader);

    try {
      await downloader.start();
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      this.activeDownloads.delete(url);
      this.activeCount--;
      this.processQueue();
    }
  }

  private async finalizeCache(url: string, cache: Cache): Promise<void> {
    const meta = await this.store.getMetadata(url);
    if (!meta) throw new Error(`Download failed: Metadata missing for ${url}`);

    const stream = await this.store.getStream(url);
    const response = new Response(stream, {
      headers: {
        'Content-Length': meta.totalBytes.toString(),
        'Content-Type': meta.mimeType || 'application/octet-stream'
      }
    });

    await cache.put(url, response);
    await this.store.deleteFile(url);
  }

  private async computeSha256(blob: Blob): Promise<string> {
    const hasher = await createSHA256();
    hasher.init();

    if (blob.stream) {
      const reader = blob.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) hasher.update(value);
      }
    } else {
      const buffer = await blob.arrayBuffer();
      hasher.update(new Uint8Array(buffer));
    }

    return hasher.digest();
  }

  public async checkCacheIntegrity(url: string, expectedChecksum?: string): Promise<{ ok: boolean, reason?: string, missing?: boolean }> {
    const cache = await this.getCache();
    const cachedResponse = await cache.match(url);

    if (!cachedResponse) {
      return { ok: false, missing: true, reason: 'File not found in cache' };
    }

    const contentLength = cachedResponse.headers.get('Content-Length');
    if (!contentLength) {
      return { ok: true };
    }

    const expectedSize = parseInt(contentLength, 10);
    const blob = await cachedResponse.clone().blob();

    if (blob.size !== expectedSize) {
      return { ok: false, reason: `Size mismatch: expected ${expectedSize}, got ${blob.size}` };
    }

    if (expectedChecksum) {
      try {
        const hashHex = await this.computeSha256(blob);
        if (hashHex !== expectedChecksum) {
          return { ok: false, reason: `Checksum mismatch: expected ${expectedChecksum}, got ${hashHex}` };
        }
      } catch (error) {
        console.error('Checksum verification failed:', error);
        return { ok: false, reason: `Checksum calculation failed: ${error}` };
      }
    }

    return { ok: true };
  }

  public async cancelDownload(url: string): Promise<void> {
    const downloader = this.activeDownloads.get(url);
    if (downloader) {
      downloader.abort();
      return;
    }

    const index = this.queue.findIndex(item => item.url === url);
    if (index !== -1) {
      const item = this.queue[index];
      this.queue.splice(index, 1);
      item.reject(new Error('Download cancelled'));
    }
  }

  public async deleteFromCache(url: string): Promise<void> {
    await this.cancelDownload(url);
    const cache = await this.getCache();
    await cache.delete(url);
    await this.store.deleteFile(url);
  }
}

export const downloadManager = DownloadManager.getInstance();
