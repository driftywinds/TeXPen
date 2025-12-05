export const INFERENCE_CONFIG = {
  MODEL_ID: 'onnx-community/TexTeller3-ONNX',
  DEFAULT_QUANTIZATION: 'fp32',
  DEFAULT_PROVIDER: 'webgpu', // Note: Service detects WebGPU support, this is just a fallback/default string

  // Generation defaults
  MAX_NEW_TOKENS: 256,
  NUM_BEAMS: 1,
  DO_SAMPLE: false,

  // Penalties
  FP16_REPETITION_PENALTY: 1.25,
};

export function getSessionOptions(device: string, dtype: string) {
  let sessionOptions: any = {
    device: device,
    dtype: dtype,
  };

  if (dtype === 'fp16') {
    // Mixed Precision: Encoder (FP32) + Decoder (FP16)
    // This prevents encoder instability while keeping decoder speed.
    sessionOptions = {
      device: device,
      dtype: {
        encoder_model: 'fp32',
        decoder_model_merged: 'fp16',
        decoder_with_past_model: 'fp16',
      },
      // Explicitly point to the files
      encoder_model_file_name: 'encoder_model.onnx', // Default FP32
      decoder_model_file_name: 'decoder_with_past_model_fp16.onnx',
    };
  } else if (dtype === 'q8') {
    sessionOptions = {
      ...sessionOptions,
      encoder_model_file_name: 'encoder_model_int8.onnx',
      decoder_model_file_name: 'decoder_with_past_model_int8.onnx',
    };
  }
  // For fp32 (default), we rely on standard naming or explicit defaults if needed.

  return sessionOptions;
}

export function getGenerationConfig(dtype: string, tokenizer: any) {
  return {
    max_new_tokens: INFERENCE_CONFIG.MAX_NEW_TOKENS,
    do_sample: INFERENCE_CONFIG.DO_SAMPLE,
    num_beams: INFERENCE_CONFIG.NUM_BEAMS,
    pad_token_id: tokenizer.pad_token_id,
    eos_token_id: tokenizer.eos_token_id,
    bos_token_id: tokenizer.bos_token_id,
    decoder_start_token_id: tokenizer.bos_token_id,
    // Only apply repetition penalty for fp16 to prevent loops
    ...(dtype === 'fp16' ? { repetition_penalty: INFERENCE_CONFIG.FP16_REPETITION_PENALTY } : {}),
  };
}
