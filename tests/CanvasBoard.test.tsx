// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import CanvasBoard from '../components/canvas/CanvasBoard';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { Stroke, ToolType } from '../types/canvas';

describe('CanvasBoard Selection & Move', () => {
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
    });

    beforeEach(() => {
        vi.useFakeTimers();
        // Mock Canvas Context
        mockCtx = {
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            strokeRect: vi.fn(), // Key for verifying selection highlight
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
                // Use JSDOM canvas which has full DOM API (setAttribute, etc.) needed by React
                const canvas = document.implementation.createHTMLDocument().createElement('canvas');

                canvas.getContext = vi.fn((type) => {
                    if (type === '2d') return mockCtx;
                    return null;
                }) as any;

                // Mock getBoundingClientRect for coordinate calculations
                canvas.getBoundingClientRect = () => ({
                    left: 0,
                    top: 0,
                    width: 500,
                    height: 500,
                    right: 500,
                    bottom: 500,
                    x: 0,
                    y: 0,
                    toJSON: () => { }
                });
                return canvas;
            }
            return originalCreateElement(tagName, options);
        });
    });

    it('selects a stroke when clicked', () => {
        const strokesRef = { current: [] as Stroke[] };
        const onStrokeEnd = vi.fn();

        // 1. Initial Render with Pen
        const { rerender, container } = render(
            <CanvasBoard
                activeTool="pen"
                theme="light"
                onStrokeEnd={onStrokeEnd}
                refCallback={() => { }}
                contentRefCallback={() => { }}
                strokesRef={strokesRef}
            />
        );

        const canvas = container.querySelector('canvas')!;

        // 2. Draw a horizontal line from (10,10) to (50,10)
        fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(canvas, { clientX: 50, clientY: 10 });
        fireEvent.mouseUp(canvas);

        // Wait for stroke to be saved (debounce 600ms in code)
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        // Verify stroke was recorded
        expect(strokesRef.current.length).toBe(1);

        // 3. Switch to Select Tool
        rerender(
            <CanvasBoard
                activeTool="select"
                theme="light"
                onStrokeEnd={onStrokeEnd}
                refCallback={() => { }}
                contentRefCallback={() => { }}
                strokesRef={strokesRef}
            />
        );

        // Clear previous mock calls
        mockCtx.strokeRect.mockClear();

        // 4. Click on the stroke (around 30, 10)
        fireEvent.mouseDown(canvas, { clientX: 30, clientY: 10 });
        fireEvent.mouseUp(canvas);

        // Verify selection highlight (bounding box) was drawn
        // strokeRect is called inside redrawStrokes when selection exists
        expect(mockCtx.strokeRect).toHaveBeenCalled();
    });

    it('moves a selected stroke', () => {
        const strokesRef = { current: [] as Stroke[] };
        const onStrokeEnd = vi.fn();

        // 1. Pre-exist a stroke
        strokesRef.current = [{
            points: [{ x: 10, y: 10 }, { x: 50, y: 10 }],
            tool: 'pen',
            color: '#000000',
            width: 3
        }];

        const { container } = render(
            <CanvasBoard
                activeTool="select"
                theme="light"
                onStrokeEnd={onStrokeEnd}
                refCallback={() => { }}
                contentRefCallback={() => { }}
                strokesRef={strokesRef}
            />
        );

        const canvas = container.querySelector('canvas')!;

        // 2. Click to select (around 30,10)
        fireEvent.mouseDown(canvas, { clientX: 30, clientY: 10 });
        fireEvent.mouseUp(canvas);

        // 3. Start dragging (Click on selected stroke)
        fireEvent.mouseDown(canvas, { clientX: 30, clientY: 10 });

        // 4. Move +10px in X and Y
        fireEvent.mouseMove(canvas, { clientX: 40, clientY: 20 });

        // 5. Release
        fireEvent.mouseUp(canvas);

        // Verify points moved
        // Original: (10,10) -> (50,10)
        // Delta: +10, +10
        // Expected: (20,20) -> (60,20)

        const newPoints = strokesRef.current[0].points;
        expect(newPoints[0].x).toBe(20);
        expect(newPoints[0].y).toBe(20);
        expect(newPoints[1].x).toBe(60);
        expect(newPoints[1].y).toBe(20);
    });

    it('clears selection when clicking empty space', () => {
        const strokesRef = { current: [] as Stroke[] };

        // Pre-measure selection logic... easier to just test visual/state effect
        // But we can check internal state via behavior

        // Mock a stroke
        strokesRef.current = [{
            points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
            tool: 'pen',
            color: '#000',
            width: 3
        }];

        const { container } = render(
            <CanvasBoard
                activeTool="select"
                theme="light"
                onStrokeEnd={vi.fn()}
                refCallback={() => { }}
                contentRefCallback={() => { }}
                strokesRef={strokesRef}
            />
        );
        const canvas = container.querySelector('canvas')!;

        // Select it
        fireEvent.mouseDown(canvas, { clientX: 15, clientY: 15 });
        fireEvent.mouseUp(canvas);
        mockCtx.strokeRect.mockClear();

        // Click empty space (100, 100)
        fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
        fireEvent.mouseUp(canvas);

        // Should NOT draw selection box anymore
        // Note: Canvas redraws everything. If selection is cleared, strokeRect won't be called.
        // But redrawStrokes is called.
        expect(mockCtx.strokeRect).not.toHaveBeenCalled();
    });
});
