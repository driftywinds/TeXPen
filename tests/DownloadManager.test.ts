import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadManager } from '../services/downloader/DownloadManager';
import { getDB, clearPartialDownload } from '../services/downloader/db';

// Mock DB
vi.mock('../services/downloader/db', () => ({
  getDB: vi.fn(),
  saveChunk: vi.fn(),
  getPartialDownload: vi.fn(),
  clearPartialDownload: vi.fn(),
}));

// Access mocked functions
import { saveChunk, getPartialDownload, clearPartialDownload as mockClearPartial } from '../services/downloader/db';

describe('DownloadManager', () => {
  let downloadManager: DownloadManager;

  beforeEach(() => {
    // Reset singleton if possible, or just ignore since we mock dependencies
    // Since DownloadManager is a singleton, we might need to access the private instance or just rely on state reset
    // For this test we can just get the instance. State like 'abortControllers' is internal.
    downloadManager = DownloadManager.getInstance();
    vi.clearAllMocks();

    // Mock global fetch
    global.fetch = vi.fn();

    // Mock caches
    (global as any).caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      }),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should download a file and save chunks sequentially', async () => {
    const mockUrl = 'https://example.com/model.onnx';
    const mockContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(mockContent.slice(0, 5));
        controller.enqueue(mockContent.slice(5, 10));
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': '10', 'Etag': 'test-etag' }),
      body: mockStream,
    });

    await downloadManager.downloadFile(mockUrl);

    // Verify saveChunk called for each chunk
    expect(saveChunk).toHaveBeenCalledTimes(2);

    // Check call arguments: url, blob, totalSize, chunkIndex, etag
    expect(saveChunk).toHaveBeenNthCalledWith(1, mockUrl, expect.any(Blob), 10, 0, 'test-etag');
    expect(saveChunk).toHaveBeenNthCalledWith(2, mockUrl, expect.any(Blob), 10, 1, 'test-etag'); // Index must increment
  });

  it('should resume from generic partial state', async () => {
    const mockUrl = 'https://example.com/large.bin';

    // Mock existing partial state
    (getPartialDownload as any).mockResolvedValue({
      url: mockUrl,
      downloadedBytes: 50,
      contentLength: 100,
      chunks: [new Blob([new Uint8Array(50)])], // Simulated existing chunks
      chunkCount: 1
    });

    // Mock fetch to return remaining 50 bytes
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(50));
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': '50', 'Etag': 'test-etag' }), // Server returns length of *content sent* usually with 206
      status: 206,
      body: mockStream,
    });

    await downloadManager.downloadFile(mockUrl);

    // Should call fetch with Range header
    expect(global.fetch).toHaveBeenCalledWith(mockUrl, expect.objectContaining({
      headers: { 'Range': 'bytes=50-' }
    }));

    // Should save new chunk at index 1 (since 0 existed)
    expect(saveChunk).toHaveBeenCalledWith(mockUrl, expect.any(Blob), 100, 1, 'test-etag');
  });
});
