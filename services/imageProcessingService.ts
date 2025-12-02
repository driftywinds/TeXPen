import * as ort from 'onnxruntime-web';
import { ModelConfig } from '../types';

/**
 * EXACT REPLICATION OF PYTHON `preprocess_for_texteller`
 * 
 * Logic:
 * 1. Convert to Grayscale (OpenCV style weights)
 * 2. Resize maintaining aspect ratio
 * 3. Pad to 448x448 with WHITE (255)
 * 4. Normalize: (x/255 - 0.5) / 0.5 -> [-1, 1] range
 */
export const preprocessImage = async (inputImageData: ImageData, config: ModelConfig): Promise<ort.Tensor> => {
  const targetSize = config.imageSize; // 448
  const srcWidth = inputImageData.width;
  const srcHeight = inputImageData.height;

  // --- Python Step 4: Resize with aspect ratio ---
  // scale = IMAGE_SIZE / max(h, w)
  const scale = targetSize / Math.max(srcHeight, srcWidth);
  const newWidth = Math.round(srcWidth * scale);
  const newHeight = Math.round(srcHeight * scale);

  // Center coordinates
  const offsetX = Math.floor((targetSize - newWidth) / 2);
  const offsetY = Math.floor((targetSize - newHeight) / 2);

  // --- Create Canvas for Resizing & Padding ---
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context failed');

  // Fill with WHITE (255) first (Padding)
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Draw image scaled and centered
  const bitmap = await createImageBitmap(inputImageData);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // approximates cv2.INTER_AREA
  ctx.drawImage(bitmap, 0, 0, srcWidth, srcHeight, offsetX, offsetY, newWidth, newHeight);

  // --- DEBUGGER (Optional: View what the model sees) ---
  const existing = document.getElementById('debug-onnx-canvas');
  if (existing) existing.remove();
  canvas.id = 'debug-onnx-canvas';
  canvas.style.position = 'fixed';
  canvas.style.bottom = '10px';
  canvas.style.left = '10px';
  canvas.style.zIndex = '9999';
  canvas.style.width = '150px';
  canvas.style.height = '150px';
  canvas.style.border = '2px solid red';
  document.body.appendChild(canvas);
  // ----------------------------------------------------

  // --- Python Steps 3 & 6: Grayscale + Normalize ---
  const { data } = ctx.getImageData(0, 0, targetSize, targetSize);
  const floatData = new Float32Array(targetSize * targetSize);

  for (let i = 0; i < targetSize * targetSize; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Python Step 3: cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    // OpenCV Standard Luminosity Formula: Y = 0.299R + 0.587G + 0.114B
    const gray = (0.299 * r) + (0.587 * g) + (0.114 * b);

    // Python Step 6: Normalize
    // tensor = tensor / 255.0          # 0..1
    // tensor = (tensor - 0.5) / 0.5    # -> approx [-1, 1]
    const norm = (gray / 255.0 - 0.5) / 0.5;

    floatData[i] = norm;
  }

  // Python Step 5: 1 x H x W (Channels First)
  return new ort.Tensor('float32', floatData, [1, 1, targetSize, targetSize]);
};
