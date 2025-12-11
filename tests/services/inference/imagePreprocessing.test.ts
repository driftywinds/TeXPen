import { describe, it, expect } from 'vitest';
import { MODEL_CONFIG } from '../../../services/inference/config';
import { FIXED_IMG_SIZE, IMAGE_MEAN, IMAGE_STD } from '../../../services/inference/imagePreprocessing';

/**
 * Tests for image preprocessing utilities.
 * Note: The preprocess() function requires browser-specific APIs (canvas toBlob, createImageBitmap)
 * that don't work reliably in Node.js test environment. We test the constants and 
 * leave integration testing of preprocess() to browser-based tests.
 */
describe('Image Preprocessing', () => {
  describe('Constants', () => {
    it('has correct image size', () => {
      expect(FIXED_IMG_SIZE).toBe(MODEL_CONFIG.IMAGE_SIZE);
    });

    it('has correct normalization mean', () => {
      expect(IMAGE_MEAN).toBeCloseTo(MODEL_CONFIG.MEAN[0], 5);
    });

    it('has correct normalization standard deviation', () => {
      expect(IMAGE_STD).toBeCloseTo(MODEL_CONFIG.STD[0], 5);
    });

    it('produces expected white pixel normalization', () => {
      // White pixel: (255/255 - mean) / std
      const whiteNormalized = (1.0 - IMAGE_MEAN) / IMAGE_STD;
      // Should be around 0.295 (white is slightly positive after normalization)
      expect(whiteNormalized).toBeCloseTo(0.295, 1);
    });

    it('produces expected black pixel normalization', () => {
      // Black pixel: (0/255 - mean) / std
      const blackNormalized = (0.0 - IMAGE_MEAN) / IMAGE_STD;
      // Should be around -6.2 (black becomes very negative)
      expect(blackNormalized).toBeCloseTo(-6.2, 1);
    });

    it('maintains image size as square', () => {
      // Ensure image size is positive and reasonable
      expect(FIXED_IMG_SIZE).toBeGreaterThan(0);
      expect(FIXED_IMG_SIZE).toBeLessThanOrEqual(1024);
    });
  });
});
