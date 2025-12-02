import { ModelConfig } from '../types';

export const DEFAULT_CONFIG: ModelConfig = {
  encoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/encoder_model.onnx',
  decoderModelUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/decoder_model_merged.onnx',
  tokenizerUrl: 'https://huggingface.co/OleehyO/TexTeller/resolve/main/tokenizer.json',

  imageSize: 448,

  // Note: These values are for display only. 
  // The actual preprocessing logic is hardcoded in preprocessImage to match 
  // the (x - 0.5) / 0.5 logic from the Python script.
  mean: [0.5],
  std: [0.5],

  encoderInputName: 'pixel_values',
  decoderInputName: 'input_ids',
  decoderOutputName: 'logits',
  invert: false,
  eosToken: '</s>',
  bosToken: '<s>',
  padToken: '<pad>',
  preferredProvider: 'wasm'
};
