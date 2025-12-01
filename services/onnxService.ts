import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';
import { getModelFromCache, storeModelInCache } from './cacheService';

// Set wasm location (handled by vite-plugin-static-copy)
ort.env.wasm.wasmPaths = '/';

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
interface Tokenizer {
  model: {
    vocab: { [token: string]: number };
    unk_token: string;
  };
}

let tokenizer: Tokenizer | null = null;
let reverseTokenizer: { [id: number]: string } = {};

// Default Config for TexTeller
export const DEFAULT_CONFIG: ModelConfig = {
  encoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/encoder_model.onnx',
  decoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/decoder_model_merged.onnx',
  tokenizerUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/tokenizer.json',
  imageSize: 384, // TrOCR-based models use 384x384
  encoderInputName: 'pixel_values',
  decoderInputName: 'input_ids',
  decoderOutputName: 'logits',
  mean: [0.5, 0.5, 0.5], // Standard ViT mean
  std: [0.5, 0.5, 0.5],  // Standard ViT std
  invert: false, // Usually not needed for ViT unless trained on inverted
  eosToken: '</s>',
  bosToken: '<s>',
  padToken: '<pad>',
  preferredProvider: 'webgpu'
};

export const initModel = async (
  config: ModelConfig,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> => {
  try {
    // Load Tokenizer from cache or fetch
    if (onProgress) onProgress('Loading Tokenizer', 0);
    const cachedTokenizer = localStorage.getItem('tokenizer');
    if (cachedTokenizer) {
      tokenizer = JSON.parse(cachedTokenizer);
    } else {
      const tokenizerRes = await fetch(config.tokenizerUrl);
      if (!tokenizerRes.ok) throw new Error('Failed to load tokenizer.json');
      const tokenizerData = await tokenizerRes.json();
      tokenizer = tokenizerData;
      localStorage.setItem('tokenizer', JSON.stringify(tokenizerData));
    }
    // Create reverse tokenizer map
    if (Object.keys(reverseTokenizer).length === 0) {
      reverseTokenizer = Object.fromEntries(Object.entries(tokenizer.model.vocab).map(([key, value]) => [value, key]));
    }
    if (onProgress) onProgress('Loading Tokenizer', 100);

    // Load Models in parallel
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: [config.preferredProvider, 'wasm'],
      graphOptimizationLevel: 'all'
    };

    // Helper to fetch with progress
    const fetchWithProgress = async (url: string, phase: string) => {
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
      const data = new Uint8Array(await blob.arrayBuffer());
      await storeModelInCache(url, data);
      return data;
    };

    console.log('Loading models...');
    if (onProgress) onProgress('Loading Models', 0);

    const [encoderData, decoderData] = await Promise.all([
      fetchWithProgress(config.encoderModelUrl, 'Loading Encoder'),
      fetchWithProgress(config.decoderModelUrl, 'Loading Decoder')
    ]);

    const [newEncoderSession, newDecoderSession] = await Promise.all([
      ort.InferenceSession.create(encoderData, options),
      ort.InferenceSession.create(decoderData, options)
    ]);

    encoderSession = newEncoderSession;
    decoderSession = newDecoderSession;

    console.log('Models Loaded!');
    if (onProgress) onProgress('Ready', 100);
  } catch (e) {
    console.error("Failed to load models:", e);
    throw e;
  }
};

export const runInference = async (
  image: ImageData,
  config: ModelConfig
): Promise<string> => {
  if (!encoderSession || !decoderSession || !tokenizer) {
    throw new Error('Models not initialized');
  }

  // 1. Preprocess Image
  const pixelValues = preprocessImage(image, config);

  // 2. Run Encoder
  const encoderFeeds = { [config.encoderInputName]: pixelValues };
  const encoderResults = await encoderSession.run(encoderFeeds);
  const encoderHiddenStates = encoderResults.last_hidden_state || encoderResults[Object.keys(encoderResults)[0]];

  // 3. Decode Loop
  let decoderInputIds = new Int32Array([getVocabId(config.bosToken)]); // Start with BOS
  const outputTokens: string[] = [];

  const maxSteps = 100; // Safety limit

  for (let i = 0; i < maxSteps; i++) {
    const decoderFeeds = {
      [config.decoderInputName]: new ort.Tensor('int64', BigInt64Array.from(Array.from(decoderInputIds).map(BigInt)), [1, decoderInputIds.length]),
      'encoder_hidden_states': encoderHiddenStates
    };

    const decoderResults = await decoderSession.run(decoderFeeds);
    const logits = decoderResults[config.decoderOutputName]; // [1, seq_len, vocab_size]

    // Get last token logits
    const [,, vocabSize] = logits.dims;
    const lastTokenOffset = (logits.dims[1] - 1) * vocabSize;
    const lastTokenLogits = logits.data.slice(lastTokenOffset, lastTokenOffset + vocabSize) as Float32Array;

    // Greedy Search
    const maxIdx = lastTokenLogits.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0);

    const token = getTokenFromId(maxIdx);

    if (token === config.eosToken) break;

    outputTokens.push(token);

    // Append to input for next step
    const newIds = new Int32Array(decoderInputIds.length + 1);
    newIds.set(decoderInputIds);
    newIds[decoderInputIds.length] = maxIdx;
    decoderInputIds = newIds;
  }

  return cleanOutput(outputTokens.join(''));
};

const preprocessImage = (imageData: ImageData, config: ModelConfig): ort.Tensor => {
  const { data, width, height } = imageData;
  const floatData = new Float32Array(3 * width * height);

  // HWC -> CHW and Normalize
  for (let i = 0; i < width * height; i++) {
    let r = data[i * 4] / 255.0;
    let g = data[i * 4 + 1] / 255.0;
    let b = data[i * 4 + 2] / 255.0;

    if (config.invert) {
      r = 1.0 - r;
      g = 1.0 - g;
      b = 1.0 - b;
    }

    floatData[i] = (r - config.mean[0]) / config.std[0]; // R
    floatData[i + width * height] = (g - config.mean[1]) / config.std[1]; // G
    floatData[i + 2 * width * height] = (b - config.mean[2]) / config.std[2]; // B
  }

  return new ort.Tensor('float32', floatData, [1, 3, height, width]);
};

// Tokenizer Helpers
const getVocabId = (token: string): number => {
  if (!tokenizer) return 0;
  return tokenizer.model.vocab[token] || tokenizer.model.vocab[tokenizer.model.unk_token] || 0;
};

const getTokenFromId = (id: number): string => {
  return reverseTokenizer[id] || '';
};

const cleanOutput = (text: string): string => {
  return text.replace(/ |Ġ/g, ' ').trim(); // Handle BPE artifacts
};

export const generateVariations = (base: string): string[] => {
  const candidates = [base].filter(Boolean);
  // ... (keep existing variation logic)
  return candidates;
};