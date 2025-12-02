import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';
import { getVocabId, getTokenFromId, cleanOutput } from './tokenizerService';

export const runDecoder = async (
  decoderSession: ort.InferenceSession,
  encoderHiddenStates: ort.Tensor,
  config: ModelConfig
): Promise<string> => {
  let decoderInputIds = [getVocabId(config.bosToken)];
  const outputTokens: string[] = [];
  const maxSteps = 40;

  // Create KV Cache
  const dummyPast = createPastKeyValues(decoderSession, 16, 64);

  // Decode Loop
  for (let i = 0; i < maxSteps; i++) {
    const inputTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from(decoderInputIds.map(n => BigInt(n))),
      [1, decoderInputIds.length]
    );

    const decoderFeeds: Record<string, ort.Tensor> = {
      [config.decoderInputName]: inputTensor,
      'encoder_hidden_states': encoderHiddenStates,
      ...dummyPast
    };

    if (decoderSession.inputNames.includes('use_cache_branch')) {
      decoderFeeds['use_cache_branch'] = new ort.Tensor('bool', [false], [1]);
    }

    const decoderResults = await decoderSession.run(decoderFeeds);
    const logits = decoderResults[config.decoderOutputName];

    const [, seqLen, vocabSize] = logits.dims;
    const lastTokenOffset = (seqLen - 1) * vocabSize;
    const lastTokenLogits = logits.data.slice(lastTokenOffset, lastTokenOffset + vocabSize) as Float32Array;

    // Greedy Argmax
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let j = 0; j < lastTokenLogits.length; j++) {
      if (lastTokenLogits[j] > maxVal) {
        maxVal = lastTokenLogits[j];
        maxIdx = j;
      }
    }

    const token = getTokenFromId(maxIdx);
    if (token === config.eosToken) break;

    outputTokens.push(token);
    decoderInputIds.push(maxIdx);
  }

  return cleanOutput(outputTokens.join(''));
};

const createPastKeyValues = (session: ort.InferenceSession, numHeads: number, headDim: number): Record<string, ort.Tensor> => {
  const feeds: Record<string, ort.Tensor> = {};
  const batchSize = 1;
  const seqLen = 0;

  session.inputNames.forEach(name => {
    if (name.startsWith('past_key_values')) {
      feeds[name] = new ort.Tensor(
        'float32',
        new Float32Array(0),
        [batchSize, numHeads, seqLen, headDim]
      );
    }
  });
  return feeds;
};
