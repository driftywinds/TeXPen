import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelConfig, ModelStatus, Candidate } from '../types';
import { DEFAULT_CONFIG, initModel, runInference, generateVariations, clearModelCache } from '../services/inferenceService';
import { areModelsCached } from '../services/cacheService';

export const useInkModel = (theme: 'dark' | 'light') => {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ModelStatus>('loading');
  const [latex, setLatex] = useState<string>('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [progress, setProgress] = useState<number>(0);
  const [loadingPhase, setLoadingPhase] = useState<string>('Initializing');
  const [isLoadedFromCache, setIsLoadedFromCache] = useState<boolean>(false);

  const [userConfirmed, setUserConfirmedState] = useState<boolean>(
    () => localStorage.getItem('userConfirmed') === 'true'
  );

  const isInitializing = useRef(false);
  const isInitialized = useRef(false);

  // Staging canvas to prepare the image (fix colors/transparency) before inference
  const stagingCanvas = useRef<HTMLCanvasElement | null>(null);
  const stagingCtx = useRef<CanvasRenderingContext2D | null>(null);

  // 1. Check Cache
  useEffect(() => {
    const checkCache = async () => {
      try {
        const cached = await areModelsCached([
          DEFAULT_CONFIG.encoderModelUrl,
          DEFAULT_CONFIG.decoderModelUrl,
        ]);
        setIsLoadedFromCache(cached);
        if (cached && !userConfirmed) {
          setUserConfirmedState(true);
          localStorage.setItem('userConfirmed', 'true');
        }
      } catch (e) {
        console.warn("Cache check failed:", e);
      }
    };
    checkCache();
  }, [userConfirmed]);

  const setUserConfirmed = (value: boolean) => {
    setUserConfirmedState(value);
    if (value) localStorage.setItem('userConfirmed', 'true');
  };

  // 2. Initialize Model
  useEffect(() => {
    if (!userConfirmed) return;
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
        console.error("Initialization Error:", e);
        setStatus('error');
      } finally {
        isInitializing.current = false;
      }
    };
    load();
  }, [config, userConfirmed]);

  // 3. Setup Staging Canvas
  useEffect(() => {
    const canvas = document.createElement('canvas');
    stagingCanvas.current = canvas;
    stagingCtx.current = canvas.getContext('2d', { willReadFrequently: true });
  }, []);

  // --- URL INFERENCE (For testing/uploaded images) ---
  const inferFromUrl = useCallback(async (imageUrl: string) => {
    if ((status !== 'ready' && status !== 'inferencing')) {
      console.warn("Model not ready for test");
      return;
    }

    setStatus('inferencing');

    try {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = imageUrl;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
      });

      // Draw loaded image to a temporary canvas to get ImageData
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("No context");

      // Force white background (handles transparent PNGs)
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const resultLatex = await runInference(imageData, config);

      const vars = generateVariations(resultLatex);
      const newCandidates = vars.map((l, i) => ({ id: i, latex: l }));
      setCandidates(newCandidates);
      setLatex(vars[0]);
      setStatus('ready');

      return vars[0];
    } catch (e) {
      console.error("Reference Test Failed:", e);
      setStatus('error');
    }
  }, [status, config]);

  // --- DRAWING INFERENCE (Handwritten input) ---
  const infer = useCallback(async (sourceCanvas: HTMLCanvasElement) => {
    if ((status !== 'ready' && status !== 'inferencing') || !stagingCtx.current || !stagingCanvas.current) return null;

    setStatus('inferencing');
    try {
      const width = sourceCanvas.width;
      const height = sourceCanvas.height;

      // 1. Prepare Staging Canvas
      stagingCanvas.current.width = width;
      stagingCanvas.current.height = height;
      const ctx = stagingCtx.current;

      // 2. Fill Background White
      // The model expects ink on paper (not transparent).
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);

      // 3. Draw the User's Drawing (Preserves original colors for now)
      ctx.drawImage(sourceCanvas, 0, 0);

      // 4. Handle Theme Inversion (Dark Mode Fix)
      // If user drew in Dark Mode (White Ink), we must convert it to Black Ink.
      // If user drew in Light Mode (Black Ink), it's already correct.

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // Get source data to check alpha channel
      const sourceData = sourceCanvas.getContext('2d')?.getImageData(0, 0, width, height).data;

      if (sourceData) {
        for (let i = 0; i < data.length; i += 4) {
          const srcA = sourceData[i + 3]; // Alpha of the original drawing

          // If pixel has ink...
          if (srcA > 10) {
            if (theme === 'dark') {
              // Dark Mode: User drew White ink. Force it BLACK.
              data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
            } else {
              // Light Mode: User drew Dark ink. Ensure it's BLACK.
              // (Optional safety check, usually not needed if ink is already black)
              const avg = (sourceData[i] + sourceData[i + 1] + sourceData[i + 2]) / 3;
              if (avg < 200) {
                data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
              }
            }
          }
          // Pixels with alpha=0 remain White (from step 2)
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // 5. Run Inference
      // Passing "Black Ink on White Paper" to the model
      const resultLatex = await runInference(imageData, config);

      const vars = generateVariations(resultLatex);
      const newCandidates = vars.map((l, i) => ({ id: i, latex: l }));
      setCandidates(newCandidates);
      setLatex(vars[0]);
      setStatus('ready');

      return { latex: vars[0], candidates: newCandidates };
    } catch (e) {
      console.error("Inference Error:", e);
      setStatus('error');
      return null;
    }
  }, [status, theme, config]);

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
    inferFromUrl,
    clear,
    progress,
    loadingPhase,
    userConfirmed,
    setUserConfirmed,
    resetCache: clearModelCache,
    isLoadedFromCache
  };
};