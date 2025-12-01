import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelConfig, ModelStatus, Candidate } from '../types';
import { DEFAULT_CONFIG, initModel, runInference, generateVariations } from '../services/onnxService';

export const useInkModel = (theme: 'dark' | 'light') => {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [latex, setLatex] = useState<string>('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [loadingPhase, setLoadingPhase] = useState<string>('Initializing');
  const [userConfirmed, setUserConfirmed] = useState<boolean>(false);
  const isInitializing = useRef(false);
  const isInitialized = useRef(false);

  // Initialize model on mount or when provider changes
  useEffect(() => {
    // Wait for user confirmation before downloading
    if (!userConfirmed) return;

    // Prevent duplicate initialization
    if (isInitializing.current || isInitialized.current) return;

    isInitializing.current = true;
    const load = async () => {
      try {
        await initModel(config, (phase, pct) => {
          setLoadingPhase(phase);
          setProgress(pct);
        });
        setStatus('ready');
        isInitialized.current = true;
      } catch (e) {
        setStatus('error');
        console.error(e);
      } finally {
        isInitializing.current = false;
      }
    };
    load();
  }, [config.preferredProvider, userConfirmed]); // Dependencies for re-initialization

  const infer = useCallback(async (canvas: HTMLCanvasElement) => {
    if (status !== 'ready' && status !== 'inferencing') return null;

    setStatus('inferencing');
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = config.imageSize;
      offscreen.height = config.imageSize;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Context creation failed');

      // Preprocess based on theme (Dark theme = White ink -> needs normalization)
      if (theme === 'dark') {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, config.imageSize, config.imageSize);
        ctx.drawImage(canvas, 0, 0, config.imageSize, config.imageSize);
      } else {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, config.imageSize, config.imageSize);
        ctx.drawImage(canvas, 0, 0, config.imageSize, config.imageSize);
      }

      const runConfig = { ...config, invert: theme === 'dark' };
      const imageData = ctx.getImageData(0, 0, config.imageSize, config.imageSize);

      const resultLatex = await runInference(imageData, runConfig);
      const vars = generateVariations(resultLatex);

      const newCandidates = vars.map((l, i) => ({ id: i, latex: l }));
      setCandidates(newCandidates);
      setLatex(vars[0]);
      setStatus('ready');

      return { latex: vars[0], candidates: newCandidates };
    } catch (e) {
      console.error(e);
      setStatus('error');
      return null;
    }
  }, [config, status, theme]);

  const clear = useCallback(() => {
    setLatex('');
    setCandidates([]);
  }, []);

  return {
    config,
    setConfig,
    status,
    latex,
    setLatex,
    candidates,
    setCandidates,
    infer,
    clear,
    progress,
    loadingPhase,
    userConfirmed,
    setUserConfirmed
  };
};