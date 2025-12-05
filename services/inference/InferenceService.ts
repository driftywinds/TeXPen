import { AutoTokenizer, AutoModelForVision2Seq, PreTrainedModel, PreTrainedTokenizer, Tensor } from '@huggingface/transformers';
import { removeStyle, addNewlines } from '../latexUtils';
import { preprocess } from './imagePreprocessing';
import { beamSearch } from './beamSearch';
import { isWebGPUAvailable } from '../../utils/env';
import { INFERENCE_CONFIG, getSessionOptions, getGenerationConfig } from './config';

export class InferenceService {
  private model: PreTrainedModel | null = null;
  private tokenizer: PreTrainedTokenizer | null = null;
  private static instance: InferenceService;
  private isInferring: boolean = false;
  private dtype: string = INFERENCE_CONFIG.DEFAULT_QUANTIZATION;

  private constructor() { }

  public static getInstance(): InferenceService {
    if (!InferenceService.instance) {
      InferenceService.instance = new InferenceService();
    }
    return InferenceService.instance;
  }

  public async init(onProgress?: (status: string, progress?: number) => void, options: { dtype?: string, device?: 'webgpu' | 'wasm' | 'webgl' } = {}): Promise<void> {
    if (this.model && this.tokenizer) {
      // If the model is already loaded, but the quantization or device is different, we need to dispose and reload.
      if ((options.dtype && (this.model as any).config.dtype !== options.dtype) ||
        (options.device && (this.model as any).config.device !== options.device)) {
        if (this.isInferring) {
          throw new Error("Cannot change model settings while an inference is in progress.");
        }
        await this.dispose();
      } else {
        return;
      }
    }

    try {
      if (onProgress) onProgress('Loading tokenizer...');
      this.tokenizer = await AutoTokenizer.from_pretrained(INFERENCE_CONFIG.MODEL_ID);

      const webgpuAvailable = await isWebGPUAvailable();
      const device = options.device || (webgpuAvailable ? 'webgpu' : 'wasm');
      const dtype = options.dtype || (webgpuAvailable ? INFERENCE_CONFIG.DEFAULT_QUANTIZATION : 'q8');
      this.dtype = dtype;

      if (onProgress) onProgress(`Loading model with ${device} (${dtype})... (this may take a while)`);

      const sessionOptions = getSessionOptions(device, dtype);

      this.model = await AutoModelForVision2Seq.from_pretrained(INFERENCE_CONFIG.MODEL_ID, sessionOptions);

      if (onProgress) onProgress('Ready');
    } catch (error) {
      console.error('Failed to load model:', error);
      throw error;
    }
  }

  public async infer(imageBlob: Blob, numCandidates: number = 1): Promise<{ latex: string; candidates: string[]; debugImage: string }> {
    if (this.isInferring) {
      throw new Error("Another inference is already in progress.");
    }
    this.isInferring = true;

    let pixelValues: Tensor | null = null;
    let debugImage: string = '';

    try {
      if (!this.model || !this.tokenizer) {
        await this.init();
      }

      // 1. Preprocess
      const { tensor, debugImage: dbgImg } = await preprocess(imageBlob);
      pixelValues = tensor;
      debugImage = dbgImg;

      // 2. Generate candidates
      let candidates: string[];
      if (numCandidates <= 1) {
        const generationConfig = getGenerationConfig(this.dtype, this.tokenizer);

        const outputTokenIds = await this.model!.generate({
          pixel_values: pixelValues,
          ...generationConfig,
        } as any);

        const generatedText = this.tokenizer!.decode(outputTokenIds[0], {
          skip_special_tokens: true,
        });
        candidates = [this.postprocess(generatedText)];
      } else {
        candidates = await beamSearch(this.model!, this.tokenizer!, pixelValues, numCandidates);
        candidates = candidates.map(c => this.postprocess(c));
      }

      return {
        latex: candidates[0] || '',
        candidates,
        debugImage
      };
    } finally {
      if (pixelValues) {
        pixelValues.dispose();
      }
      this.isInferring = false;
    }
  }

  private postprocess(latex: string): string {
    // 1. Remove style (bold, italic, etc.) - optional but recommended for cleaner output
    let processed = removeStyle(latex);

    // 2. Add newlines for readability
    processed = addNewlines(processed);

    return processed;
  }

  public async dispose(): Promise<void> {
    if (this.isInferring) {
      throw new Error("Cannot dispose model while an inference is in progress.");
    }
    if (this.model) {
      if ('dispose' in this.model && typeof (this.model as any).dispose === 'function') {
        await (this.model as any).dispose();
      }
      this.model = null;
    }
    this.tokenizer = null;
    (InferenceService as any).instance = null;
  }
}

export const inferenceService = InferenceService.getInstance();
