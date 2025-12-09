export interface DownloadProgress {
  loaded: number;
  total: number;
  file: string;
}

export interface PartialDownload {
  url: string;
  blob: Blob; // The full assembled blob so far (or chunks if we want to get fancy, but starting simple)
  downloadedBytes: number;
  totalBytes: number;
  etag: string | null;
  lastModified: number;
}
