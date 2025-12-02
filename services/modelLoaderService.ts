import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';
import { getModelFromCache, storeModelInCache } from './cacheService';

// Setup ONNX Runtime Env
ort.env.wasm.wasmPaths = '/';
ort.env.wasm.numThreads = 4;
ort.env.wasm.proxy = false;

interface ModelSessions {
  encoderSession: ort.InferenceSession;
  decoderSession: ort.InferenceSession;
}

const fetchWithProgress = async (url: string, phase: string, onProgress?: (p: string, v: number) => void) => {
  const cachedData = await getModelFromCache(url);
  if (cachedData) {
    if (onProgress) onProgress(phase, 100);
    return cachedData;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is null');

  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total && onProgress) {
      onProgress(phase, Math.round((loaded / total) * 100));
    }
  }

  const blob = new Blob(chunks);
  const buffer = await blob.arrayBuffer();
  const data = new Uint8Array(buffer);
  await storeModelInCache(url, data);
  return data;
};

export const loadModelSessions = async (
  config: ModelConfig,
  onProgress?: (phase: string, progress: number) => void
): Promise<ModelSessions> => {
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: [config.preferredProvider, 'wasm'],
    graphOptimizationLevel: 'all',
  };

  console.log(`Loading models (Image Size: ${config.imageSize})...`);
  if (onProgress) onProgress('Loading Models', 0);

  const [encoderData, decoderData] = await Promise.all([
    fetchWithProgress(config.encoderModelUrl, 'Loading Encoder', onProgress),
    fetchWithProgress(config.decoderModelUrl, 'Loading Decoder', onProgress)
  ]);

  const [encoderSession, decoderSession] = await Promise.all([
    ort.InferenceSession.create(encoderData, options),
    ort.InferenceSession.create(decoderData, options)
  ]);

  console.log('Models Loaded. Ready for Inference.');
  if (onProgress) onProgress('Ready', 100);

  return { encoderSession, decoderSession };
};

export const clearModelCache = async () => {
  try {
    const dbs = await window.indexedDB.databases();
    for (const db of dbs) {
      if (db.name) window.indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    console.log("Cache cleared.");
  } catch (e) {
    console.error("Error clearing cache:", e);
  }
};
