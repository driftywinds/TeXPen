import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';
import { loadTokenizer, isTokenizerReady } from './tokenizerService';
import { preprocessImage } from './imageProcessingService';
import { loadModelSessions, clearModelCache } from './modelLoaderService';
import { runDecoder } from './decoderService';
import { DEFAULT_CONFIG } from './config';

// Re-export clearModelCache and DEFAULT_CONFIG for use in UI
export { clearModelCache, DEFAULT_CONFIG };

// Global Sessions
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;

export const initModel = async (
  config: ModelConfig,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> => {
  try {
    // --- Load Tokenizer ---
    await loadTokenizer(config, onProgress);

    // --- Load Models ---
    const sessions = await loadModelSessions(config, onProgress);
    encoderSession = sessions.encoderSession;
    decoderSession = sessions.decoderSession;

  } catch (e) {
    console.error("Failed to load models:", e);
    throw e;
  }
};

export const runInference = async (
  image: ImageData,
  config: ModelConfig
): Promise<string> => {
  if (!encoderSession || !decoderSession || !isTokenizerReady()) {
    throw new Error('Models not initialized');
  }

  try {
    // 1. Preprocess (Exact python replication)
    const pixelValues = await preprocessImage(image, config);

    // 2. Run Encoder
    const encoderFeeds = { [config.encoderInputName]: pixelValues };
    const encoderResults = await encoderSession.run(encoderFeeds);
    const encoderHiddenStates = encoderResults.last_hidden_state || encoderResults[Object.keys(encoderResults)[0]];

    // 3. Run Decoder
    return await runDecoder(decoderSession, encoderHiddenStates, config);

  } catch (e) {
    console.error("Inference Failed:", e);
    throw e;
  }
};

export const generateVariations = (base: string): string[] => {
  return [base];
};
