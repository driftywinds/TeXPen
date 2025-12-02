import { ModelConfig } from '../types';

interface Tokenizer {
  model: {
    vocab: { [token: string]: number };
    unk_token: string;
  };
}

let tokenizer: Tokenizer | null = null;
let reverseTokenizer: { [id: number]: string } = {};

export const loadTokenizer = async (
  config: ModelConfig,
  onProgress?: (phase: string, progress: number) => void
): Promise<void> => {
  if (onProgress) onProgress('Loading Tokenizer', 0);

  try {
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

    if (tokenizer && Object.keys(reverseTokenizer).length === 0) {
      reverseTokenizer = Object.fromEntries(
        Object.entries(tokenizer.model.vocab).map(([key, value]) => [value, key])
      );
    }

    if (onProgress) onProgress('Loading Tokenizer', 100);
  } catch (e) {
    console.error('Failed to load tokenizer:', e);
    throw e;
  }
};

export const getVocabId = (token: string): number => {
  if (!tokenizer) return 0;
  return tokenizer.model.vocab[token] || tokenizer.model.vocab[tokenizer.model.unk_token] || 0;
};

export const getTokenFromId = (id: number): string => {
  return reverseTokenizer[id] || '';
};

export const cleanOutput = (text: string): string => {
  return text
    .replace(/ |Ġ/g, ' ')
    .replace(/<\/s>/g, '')
    .replace(/<s>/g, '')
    .trim();
};

export const isTokenizerReady = (): boolean => {
  return tokenizer !== null;
};
