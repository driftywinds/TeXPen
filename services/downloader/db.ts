import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface DownloadDB extends DBSchema {
  downloads: {
    key: string; // URL
    value: {
      url: string;
      chunks: Blob[];
      totalBytes: number;
      etag: string | null;
      lastModified: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<DownloadDB>>;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<DownloadDB>('texpen-downloads', 1, {
      upgrade(db) {
        db.createObjectStore('downloads', { keyPath: 'url' });
      },
    });
  }
  return dbPromise;
}

export async function saveChunk(url: string, chunk: Blob, totalBytes: number, _chunkIndex: number, etag: string | null) {
  const db = await getDB();
  const tx = db.transaction('downloads', 'readwrite');
  const store = tx.objectStore('downloads');

  let entry = await store.get(url);
  if (!entry) {
    entry = {
      url,
      chunks: [],
      totalBytes,
      etag,
      lastModified: Date.now(),
    };
  }

  // Verify ETag if resuming
  if (etag && entry.etag && entry.etag !== etag) {
    // ETag mismatch - server file changed. Restart.
    // In a real app we might throw or handle this gracefully.
    // For now, clear and restart.
    await store.delete(url);
    entry = {
      url,
      chunks: [],
      totalBytes,
      etag,
      lastModified: Date.now(),
    };
  }

  entry.chunks.push(chunk);
  entry.lastModified = Date.now();

  await store.put(entry);
  await tx.done;
}

export async function getPartialDownload(url: string) {
  const db = await getDB();
  return db.get('downloads', url);
}

export async function clearPartialDownload(url: string) {
  const db = await getDB();
  return db.delete('downloads', url);
}
