/**
 * Canvas Performance Comparison Benchmark
 * Compares OLD (pre-optimization) vs NEW (optimized) CanvasBoard
 * 
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

// We'll test the NEW implementation only, since we can't easily import the old one
// without build conflicts. Instead, we'll run this test before and after git checkout.
import CanvasBoard from '../../components/canvas/CanvasBoard';

describe('Canvas Performance Comparison', () => {
    const NUM_DRAW_EVENTS = 1000; // More events for better measurement
    const NUM_RUNS = 3; // Multiple runs for average

    let mockCtx: any;
    let originalCreateElement: typeof document.createElement;

    beforeAll(() => {
        originalCreateElement = document.createElement.bind(document);
        global.ResizeObserver = class ResizeObserver {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        cleanup();
    });

    beforeEach(() => {
        vi.useFakeTimers();

        mockCtx = {
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            closePath: vi.fn(),
            stroke: vi.fn(),
            strokeRect: vi.fn(),
            fill: vi.fn(),
            fillRect: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            scale: vi.fn(),
            resetTransform: vi.fn(),
            setLineDash: vi.fn(),
            drawImage: vi.fn(),
            globalCompositeOperation: 'source-over',
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            strokeStyle: '#000000',
        };

        vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
            if (tagName === 'canvas') {
                const canvas = document.implementation.createHTMLDocument().createElement('canvas');
                canvas.getContext = vi.fn((type) => {
                    if (type === '2d') return mockCtx;
                    return null;
                }) as any;
                canvas.getBoundingClientRect = () => ({
                    left: 0, top: 0, width: 500, height: 500,
                    right: 500, bottom: 500, x: 0, y: 0, toJSON: () => { }
                });
                return canvas;
            }
            return originalCreateElement(tagName, options);
        });
    });

    it(`benchmark: ${NUM_DRAW_EVENTS} draw events x ${NUM_RUNS} runs`, () => {
        const durations: number[] = [];

        for (let run = 0; run < NUM_RUNS; run++) {
            const { container, unmount } = render(
                <CanvasBoard
                    theme="dark"
                    activeTool="pen"
                    onStrokeEnd={vi.fn()}
                    refCallback={vi.fn()}
                    contentRefCallback={vi.fn()}
                />
            );

            const canvas = container.querySelector('canvas');
            if (!canvas) throw new Error('Canvas not found');

            fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });

            vi.useRealTimers();
            const startTime = performance.now();

            for (let i = 0; i < NUM_DRAW_EVENTS; i++) {
                fireEvent.mouseMove(canvas, {
                    clientX: 100 + (i % 300),
                    clientY: 100 + Math.sin(i / 10) * 50
                });
            }

            const endTime = performance.now();
            durations.push(endTime - startTime);

            fireEvent.mouseUp(canvas);
            unmount();
            vi.useFakeTimers();
        }

        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const eventsPerSecond = (NUM_DRAW_EVENTS / avgDuration) * 1000;

        console.log('\n╔══════════════════════════════════════════════════════╗');
        console.log('║        CANVAS PERFORMANCE BENCHMARK RESULTS          ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║ Events per run:     ${NUM_DRAW_EVENTS.toString().padStart(6)}                          ║`);
        console.log(`║ Number of runs:     ${NUM_RUNS.toString().padStart(6)}                          ║`);
        console.log('╠══════════════════════════════════════════════════════╣');
        durations.forEach((d, i) => {
            console.log(`║ Run ${i + 1}:              ${d.toFixed(2).padStart(8)}ms                    ║`);
        });
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║ AVERAGE:            ${avgDuration.toFixed(2).padStart(8)}ms                    ║`);
        console.log(`║ Events/second:      ${eventsPerSecond.toFixed(0).padStart(8)}                    ║`);
        console.log(`║ Avg per event:      ${(avgDuration / NUM_DRAW_EVENTS).toFixed(4).padStart(8)}ms                    ║`);
        console.log('╚══════════════════════════════════════════════════════╝\n');

        expect(avgDuration / NUM_DRAW_EVENTS).toBeLessThan(5); // Less than 5ms per event
    });
});
