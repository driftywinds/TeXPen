
import { pipeline, env } from '@huggingface/transformers';
import path from 'path';
import fs from 'fs';
import { JSDOM } from 'jsdom';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Mock Browser Environment for transformers.js
const dom = new JSDOM('<!DOCTYPE html>');
global.document = dom.window.document;
global.window = dom.window as any;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.ImageData = dom.window.ImageData;

// Mock Canvas API
const originalCreateElement = global.document.createElement.bind(global.document);
global.document.createElement = (tagName: string, options?: any) => {
  if (tagName.toLowerCase() === 'canvas') {
    const canvas = createCanvas(1, 1);
    return canvas as any;
  }
  return originalCreateElement(tagName, options);
};

// Mock Image
global.Image = dom.window.Image;

// Configure transformers.js to use local cache and node-compatible settings
env.allowLocalModels = false;
env.useBrowserCache = true;

async function runPipelineTest() {
  const imagePath = path.resolve(__dirname, '../public/test.png');
  console.log(`Testing pipeline with image: ${imagePath}`);

  if (!fs.existsSync(imagePath)) {
    console.error('Test image not found!');
    process.exit(1);
  }

  try {
    console.log('Initializing pipeline...');
    // Use the pipeline API which handles preprocessing and generation automatically
    const pipe = await pipeline('image-to-text', 'onnx-community/TexTeller3-ONNX', {
      device: 'cpu', // Use CPU for node test
      dtype: 'fp32',
    });

    console.log('Running inference...');
    // pipeline expects a URL or path for node, but let's try passing the path directly
    // transformers.js in node can handle file paths if using RawImage, but pipeline usually takes url/path
    // We can pass the file path directly in Node.js
    const result = await pipe(imagePath, {
      max_new_tokens: 1024,
      num_beams: 1,
    });

    console.log('\n--- Pipeline Result ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('-----------------------\n');

  } catch (error) {
    console.error('Pipeline failed:', error);
  }
}

runPipelineTest();
