import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';

// Set wasm location (handled by vite-plugin-static-copy)
ort.env.wasm.wasmPaths = '/';

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: any = null;

// Default Config for TexTeller
export const DEFAULT_CONFIG: ModelConfig = {
  encoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/encoder_model.onnx',
  decoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/decoder_model_merged.onnx',
  tokenizerUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/tokenizer.json',
  imageSize: 224, // Check if 224 or 384
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
    // Load Tokenizer
    if (onProgress) onProgress('Loading Tokenizer', 0);
    const tokenizerRes = await fetch(config.tokenizerUrl);
    if (!tokenizerRes.ok) throw new Error('Failed to load tokenizer.json');
    tokenizer = await tokenizerRes.json();
    if (onProgress) onProgress('Loading Tokenizer', 100);

    // Load Models
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: [config.preferredProvider, 'wasm'],
      graphOptimizationLevel: 'all'
    };

    // Helper to fetch with progress
    const fetchWithProgress = async (url: string, phase: string) => {
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
      return new Uint8Array(await blob.arrayBuffer());
    };

    console.log('Loading Encoder...');
    if (onProgress) onProgress('Loading Encoder', 0);
    const encoderData = await fetchWithProgress(config.encoderModelUrl, 'Loading Encoder');
    encoderSession = await ort.InferenceSession.create(encoderData, options);

    console.log('Loading Decoder...');
    if (onProgress) onProgress('Loading Decoder', 0);
    const decoderData = await fetchWithProgress(config.decoderModelUrl, 'Loading Decoder');
    decoderSession = await ort.InferenceSession.create(decoderData, options);

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
  let outputTokens: string[] = [];

  const maxSteps = 100; // Safety limit

  for (let i = 0; i < maxSteps; i++) {
    const decoderFeeds = {
      [config.decoderInputName]: new ort.Tensor('int64', BigInt64Array.from(Array.from(decoderInputIds).map(BigInt)), [1, decoderInputIds.length]),
      'encoder_hidden_states': encoderHiddenStates
    };

    // Note: decoder_model_merged might require past_key_values or use_cache management
    // For simplicity, we are re-running the full sequence (inefficient but simpler for initial impl)
    // If using 'decoder_with_past', we need to handle KV cache.

    const decoderResults = await decoderSession.run(decoderFeeds);
    const logits = decoderResults[config.decoderOutputName]; // [1, seq_len, vocab_size]

    // Get last token logits
    const [batch, seqLen, vocabSize] = logits.dims;
    const lastTokenOffset = (seqLen - 1) * vocabSize;
    const lastTokenLogits = logits.data.slice(lastTokenOffset, lastTokenOffset + vocabSize) as Float32Array;

    // Greedy Search
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let j = 0; j < vocabSize; j++) {
      if (lastTokenLogits[j] > maxVal) {
        maxVal = lastTokenLogits[j];
        maxIdx = j;
      }
    }

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
  // Resize to config.imageSize if needed (assuming input is already resized or we do it here)
  // For now, assuming input is close or we just resize simply. 
  // Better to use a canvas to resize before passing ImageData.

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

// Tokenizer Helpers (Basic implementation assuming HF tokenizer.json structure)
const getVocabId = (token: string): number => {
  return tokenizer.model.vocab[token] || tokenizer.model.vocab[tokenizer.unk_token] || 0;
};

const getTokenFromId = (id: number): string => {
  // Inefficient reverse lookup, optimize later
  const vocab = tokenizer.model.vocab;
  for (const [token, tokenId] of Object.entries(vocab)) {
    if (tokenId === id) return token;
  }
  return '';
};

const cleanOutput = (text: string): string => {
  return text.replace(/ /g, ' ').replace(/Ġ/g, ' ').trim(); // Handle BPE artifacts if any
};

export const generateVariations = (base: string): string[] => {
  const candidates = [base].filter(Boolean);
  // ... (keep existing variation logic)
  return candidates;
};