export interface ModelConfig {
  encoderModelUrl: string;
  decoderModelUrl: string;
  tokenizerUrl: string;
  imageSize: number;
  encoderInputName: string;
  decoderInputName: string;
  decoderOutputName: string;
  mean: number[];
  std: number[];
  invert: boolean;
  eosToken: string;
  bosToken: string;
  padToken: string;
  preferredProvider: 'webgpu' | 'webgl' | 'wasm';
}

export interface Candidate {
  id: number;
  latex: string;
}

export interface HistoryItem {
  id: string;
  latex: string;
  timestamp: number;
}

export type ModelStatus = 'loading' | 'ready' | 'error' | 'inferencing';

// Extend Window for MathJax and ONNX
declare global {
  interface Window {
    MathJax: any;
    ort: any;
  }
}