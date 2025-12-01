import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ModelConfig, ModelStatus, Candidate } from '../types';
import { DEFAULT_CONFIG, initModel, runInference, generateVariations } from '../services/onnxService';
import { areModelsCached } from '../services/cacheService';

export const useInkModel = (theme: 'dark' | 'light') => {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [latex, setLatex] = useState<string>('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [loadingPhase, setLoadingPhase] = useState<string>('Initializing');
  const [userConfirmed, setUserConfirmedState] = useState<boolean>(
    () => localStorage.getItem('userConfirmed') === 'true'
  );
  const isInitializing = useRef(false);
  const isInitialized = useRef(false);

  useEffect(() => {
    // If user has not confirmed, check if models are already cached
    if (!userConfirmed) {
      const checkCache = async () => {
        const cached = await areModelsCached([
          DEFAULT_CONFIG.encoderModelUrl,
          DEFAULT_CONFIG.decoderModelUrl,
        ]);
        if (cached) {
          // If models are in cache, we can skip the user confirmation prompt
          setUserConfirmedState(true);
          localStorage.setItem('userConfirmed', 'true');
        }
      };
      checkCache();
    }
  }, [userConfirmed]);

  const setUserConfirmed = (value: boolean) => {
    setUserConfirmedState(value);
    if (value) {
      localStorage.setItem('userConfirmed', 'true');
    }
  };

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
  }, [config, userConfirmed]); // Dependencies for re-initialization

  const offscreenCanvas = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtx = useRef<CanvasRenderingContext2D | null>(null);

  // Initialize offscreen canvas
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = config.imageSize;
    canvas.height = config.imageSize;
    offscreenCanvas.current = canvas;
    offscreenCtx.current = canvas.getContext('2d');
  }, [config.imageSize]);

  const runConfig = useMemo(() => ({ ...config, invert: theme === 'dark' }), [config, theme]);

  const infer = useCallback(async (canvas: HTMLCanvasElement) => {
    if (status !== 'ready' && status !== 'inferencing' || !offscreenCtx.current) return null;

    setStatus('inferencing');
    try {
      const ctx = offscreenCtx.current;
      
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
  }, [status, theme, config.imageSize, runConfig]);

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
