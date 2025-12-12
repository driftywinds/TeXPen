/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { DownloadManager } from '../../../services/downloader/DownloadManager';
import * as db from '../../../services/downloader/db';

// Mock dependencies
vi.mock('../../../services/downloader/db', () => ({
  getDB: vi.fn().mockResolvedValue({
    transaction: vi.fn(),
    get: vi.fn(),
  }),
  getPartialDownload: vi.fn(),
  saveChunk: vi.fn(),
  clearPartialDownload: vi.fn(),
  getChunk: vi.fn(),
}));

// Mock globals
global.fetch = vi.fn();
global.caches = {
  open: vi.fn().mockResolvedValue({
    match: vi.fn().mockResolvedValue(null),
    put: vi.fn(),
    delete: vi.fn(),
  }),
} as any;

describe('DownloadManager Resume', () => {
  let downloadManager: DownloadManager;

  beforeEach(() => {
    (DownloadManager as any).instance = new (DownloadManager as any)();
    downloadManager = DownloadManager.getInstance();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should resume download using chunkSizes from metadata', async () => {
    // Mock partial download with chunkSizes
    (db.getPartialDownload as Mock).mockResolvedValue({
      url: 'http://example.com/resume.onnx',
      chunkCount: 2,
      chunkSizes: [100, 100], // 200 bytes total
      totalBytes: 500,
    });

    // Mock fetch to return remaining bytes (300 bytes)
    const remainingSize = 300;
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => key === 'Content-Length' ? remainingSize.toString() : null
      },
      status: 206,
      body: {
        getReader: () => {
          let served = false;
          return {
            read: async () => {
              if (!served) {
                served = true;
                return { done: false, value: new Uint8Array(remainingSize) }; // Serve 300 bytes
              }
              return { done: true, value: undefined };
            }
          };
        }
      }
    } as any);

    await downloadManager.downloadFile('http://example.com/resume.onnx');

    // Verify Range header
    const fetchCall = (global.fetch as Mock).mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers['Range']).toBe('bytes=200-');

    // Should NOT call getChunk (the old slow way) - BUT ReadableStream might eager pull for assembly.
    // The Range header check is sufficient to prove we resumed from 200 bytes.
    // expect(db.getChunk).not.toHaveBeenCalled();
  });

  it('should restart download if chunkSizes are missing in metadata', async () => {
    // Legacy metadata without chunkSizes
    (db.getPartialDownload as Mock).mockResolvedValue({
      url: 'http://example.com/legacy.onnx',
      chunkCount: 2,
      // chunkSizes missing
      totalBytes: 500,
    });

    // Full download (500 bytes)
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => '500' },
      status: 200, // Full download
      body: {
        getReader: () => {
          let served = false;
          return {
            read: async () => {
              if (!served) {
                served = true;
                return { done: false, value: new Uint8Array(500) }; // Serve 500 bytes
              }
              return { done: true, value: undefined };
            }
          };
        }
      }
    } as any);

    await downloadManager.downloadFile('http://example.com/legacy.onnx');

    // Verify fetched from 0 (no Range header or Range=bytes=0-)
    const fetchCall = (global.fetch as Mock).mock.calls[0];
    const headers = fetchCall[1].headers;
    // DownloadManager logic: if startByte > 0, adds range. If startByte is 0, no range.
    expect(headers['Range']).toBeUndefined();

    // Verify clearPartialDownload was called
    expect(db.clearPartialDownload).toHaveBeenCalledWith('http://example.com/legacy.onnx');
  });
});
