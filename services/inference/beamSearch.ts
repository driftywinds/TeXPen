import { PreTrainedTokenizer, Tensor } from '@huggingface/transformers';
import { VisionEncoderDecoderModel } from './types';

// Beam type
import { Beam } from './types';


export async function beamSearch(
  model: VisionEncoderDecoderModel,
  tokenizer: PreTrainedTokenizer,
  pixelValues: Tensor,
  numBeams: number,
  signal?: AbortSignal,
  maxTokens: number = 256,
  repetitionPenalty: number = 1.0,
): Promise<string[]> {
  const eosTokenId = tokenizer.eos_token_id as number;
  const bosTokenId = tokenizer.bos_token_id as number;
  const padTokenId = tokenizer.pad_token_id as number;

  let beams: Beam[] = [{ tokens: [bosTokenId], score: 0, done: false }];

  // 1. Run Encoder ONCE
  let encoderOutputs: any = null;
  try {
    if (signal?.aborted) throw new Error("Aborted");

    if ((model as any).encoder) {
      encoderOutputs = await (model as any).encoder({
        pixel_values: pixelValues,
      });
    }
  } catch (e) {
    if ((e as Error).message === "Aborted") throw e;
    console.error("Failed to run encoder:", e);
    throw e;
  }

  // Step through generation token by token
  for (let step = 0; step < maxTokens; step++) {
    if (signal?.aborted) {
      // Dispose encoder outputs before throwing
      if (encoderOutputs) {
        for (const key in encoderOutputs) {
          const val = encoderOutputs[key];
          if (val && typeof val.dispose === 'function') {
            val.dispose();
          }
        }
      }
      throw new Error("Aborted");
    }

    const allCandidates: Beam[] = [];

    for (const beam of beams) {
      if (beam.done) {
        allCandidates.push(beam);
        continue;
      }

      let decoderInputIds: Tensor | null = null;
      let logitsData: Float32Array | null = null;
      let outputs: any = null;

      try {
        // Create input tensor for this beam
        decoderInputIds = new Tensor(
          'int64',
          BigInt64Array.from(beam.tokens.map(t => BigInt(t))),
          [1, beam.tokens.length]
        );

        // Try forward pass to get logits
        if ((model as any).forward) {
          outputs = await (model as any).forward({
            pixel_values: pixelValues,
            encoder_outputs: encoderOutputs,
            decoder_input_ids: decoderInputIds,
            use_cache: true,
          });

          const logits = outputs.logits || outputs.decoder_logits;
          if (logits) {
            // Get last token logits
            const seqLen = beam.tokens.length;
            const vocabSize = logits.dims[logits.dims.length - 1];
            const startIdx = (seqLen - 1) * vocabSize;
            logitsData = new Float32Array(logits.data.slice(startIdx, startIdx + vocabSize));
          }
        }

        if (!logitsData) {
          // Fallback: greedy generation (no repetition penalty easily applied here without customizing generate)
          // For now, assume forward pass works or fallback ignores penalty/signal for this single step
          const result = await model.generate({
            pixel_values: pixelValues,
            max_new_tokens: 1,
            do_sample: false,
            pad_token_id: padTokenId,
            eos_token_id: eosTokenId,
            bos_token_id: bosTokenId,
            decoder_start_token_id: bosTokenId,
          } as any);
          const seqs = (result as any).sequences || result;
          const nextToken = Number(seqs.data[seqs.data.length - 1]);
          allCandidates.push({
            tokens: [...beam.tokens, nextToken],
            score: beam.score,
            done: nextToken === eosTokenId
          });

          if (result && typeof (result as any).dispose === 'function') {
            (result as any).dispose();
          }
          continue;
        }

        // Apply Repetition Penalty
        if (repetitionPenalty !== 1.0) {
          const counts = new Map<number, number>();
          for (const token of beam.tokens) {
            counts.set(token, (counts.get(token) || 0) + 1);
          }
          for (const [token, count] of counts) {
            if (token < logitsData.length) {
              // Standard repetition penalty: 
              // if score < 0, score = score * penalty
              // if score > 0, score = score / penalty
              // (Logits are log-odds, so positive means likely, negative means unlikely)
              // Wait, standard paper (Keskar et al) formulation:
              // logit' = logit / (penalty if token in previously_generated else 1) ... NO that's temperature
              // Actually: if logit < 0: logit * penalty, else logit / penalty.
              // This pushes "good" tokens (positive) down, and "bad" tokens (negative) further down.
              const val = logitsData[token];
              logitsData[token] = val < 0 ? val * repetitionPenalty : val / repetitionPenalty;
            }
          }
        }

        // Efficiently calculate LogSoftmax and Top-K without full array allocations
        let maxLogit = -Infinity;
        for (let i = 0; i < logitsData.length; i++) {
          if (logitsData[i] > maxLogit) maxLogit = logitsData[i];
        }

        let expSum = 0;
        for (let i = 0; i < logitsData.length; i++) {
          expSum += Math.exp(logitsData[i] - maxLogit);
        }

        const logSumExp = maxLogit + Math.log(expSum);

        // Find top-k indices and values safely
        // Since K is small (numBeams), we can maintain a sorted list
        const topCandidates: { idx: number; val: number }[] = [];

        for (let i = 0; i < logitsData.length; i++) {
          const val = logitsData[i];

          if (topCandidates.length < numBeams) {
            topCandidates.push({ idx: i, val });
            topCandidates.sort((a, b) => b.val - a.val); // Sort descending
          } else if (val > topCandidates[topCandidates.length - 1].val) {
            topCandidates[topCandidates.length - 1] = { idx: i, val };
            topCandidates.sort((a, b) => b.val - a.val);
          }
        }

        for (const { idx, val } of topCandidates) {
          const prob = val - logSumExp;
          allCandidates.push({
            tokens: [...beam.tokens, idx],
            score: beam.score + prob,
            done: idx === eosTokenId
          });
        }

      } catch (error) {
        console.error('[DEBUG] Beam step error:', error);
        allCandidates.push({ ...beam, done: true });
      } finally {
        if (decoderInputIds) decoderInputIds.dispose();
        if (outputs) {
          for (const key in outputs) {
            const val = outputs[key];
            if (val && typeof val.dispose === 'function') {
              val.dispose();
            }
          }
        }
      }
    }

    if (allCandidates.length === 0) break;

    // Keep top beams
    allCandidates.sort((a, b) => b.score - a.score);
    beams = allCandidates.slice(0, numBeams);

    // Check if all done
    if (beams.every(b => b.done)) break;
  }

  // Decode beams to candidates
  const candidates: string[] = [];
  beams.sort((a, b) => b.score - a.score);

  for (const beam of beams) {
    try {
      const text = tokenizer.decode(beam.tokens, { skip_special_tokens: true });
      if (text && !candidates.includes(text)) {
        candidates.push(text);
      }
    } catch (e) {
      console.error('[DEBUG] Decode error:', e);
    }
  }

  // Dispose encoder outputs at the very end
  if (encoderOutputs) {
    for (const key in encoderOutputs) {
      const val = encoderOutputs[key];
      if (val && typeof val.dispose === 'function') {
        val.dispose();
      }
    }
  }

  return candidates;
}

