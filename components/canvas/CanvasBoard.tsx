import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ToolType, Point, Stroke } from '../../types/canvas';
import { isPointNearStroke, splitStrokes, isPointInBounds, isStrokeInPolygon, isStrokeInRect } from '../../utils/geometry';
import {
    drawAllStrokes,
    drawSelectionHighlight,
    drawLassoPath,
    drawSelectionBox,
    copyToCanvas,
    getSelectionBounds
} from '../../utils/canvasRendering';

interface CanvasBoardProps {
    onStrokeEnd: () => void;
    refCallback: (ref: HTMLCanvasElement | null) => void;
    contentRefCallback: (ref: HTMLCanvasElement | null) => void;
    theme: 'dark' | 'light';
    activeTool: ToolType;
    strokesRef?: React.MutableRefObject<Stroke[]>;
}

const ERASER_SIZE = 20;

const CanvasBoard: React.FC<CanvasBoardProps> = ({ onStrokeEnd, refCallback, contentRefCallback, theme, activeTool, strokesRef: externalStrokesRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null); // Direct DOM Ref for cursor

    // State only for things that change UI structure/mode, NOT high-frequency draw data
    const [isDrawingState, setIsDrawingState] = useState(false);

    // Refs for high-frequency data
    const isDrawingRef = useRef(false);
    const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const currentPos = useRef<{ x: number; y: number } | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestRef = useRef<number | null>(null);

    // Track strokes for line eraser
    const localStrokesRef = useRef<Stroke[]>([]);
    const strokesRef = externalStrokesRef || localStrokesRef;
    const currentStrokeRef = useRef<Point[]>([]);

    // Selection State
    const [selectedStrokeIndices, setSelectedStrokeIndices] = useState<number[]>([]);
    const dragStartPos = useRef<{ x: number; y: number } | null>(null);
    const isDragging = useRef<boolean>(false);

    // Lasso Selection State
    const lassoPointsRef = useRef<Point[]>([]);
    const isLassoSelecting = useRef<boolean>(false);

    // Rect Selection State
    const rectStartPos = useRef<{ x: number; y: number } | null>(null);
    const isRectSelecting = useRef<boolean>(false);

    const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Setup canvas size and style
    const setupCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const { width, height } = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = width * dpr;
        const targetHeight = height * dpr;

        // Initialize content canvas if it doesn't exist
        if (!contentCanvasRef.current) {
            contentCanvasRef.current = document.createElement('canvas');
            contentCanvasRef.current.width = targetWidth;
            contentCanvasRef.current.height = targetHeight;
            const contentCtx = contentCanvasRef.current.getContext('2d', { willReadFrequently: true });
            if (contentCtx) {
                contentCtx.drawImage(canvas, 0, 0);
            }
        }

        const contentCanvas = contentCanvasRef.current;

        // Check if resize is needed
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {

            // If the container is larger than our backing canvas, we need to resize it
            if (contentCanvas.width < targetWidth || contentCanvas.height < targetHeight) {
                const newContentCanvas = document.createElement('canvas');
                newContentCanvas.width = Math.max(contentCanvas.width, targetWidth);
                newContentCanvas.height = Math.max(contentCanvas.height, targetHeight);
                const newContentCtx = newContentCanvas.getContext('2d', { willReadFrequently: true });

                if (newContentCtx) {
                    newContentCtx.drawImage(contentCanvas, 0, 0);
                }
                contentCanvasRef.current = newContentCanvas;
            }

            // Resize the visible canvas
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            canvas.style.width = '100%';
            canvas.style.height = '100%';
        }

        // Copy from backing canvas to visible canvas
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(contentCanvasRef.current, 0, 0);

            // Setup context properties for future drawing
            ctx.resetTransform();
            ctx.scale(dpr, dpr);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = 3;
            ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#000000';
        }

        refCallback(canvas);
        contentRefCallback(contentCanvasRef.current);
    }, [refCallback, contentRefCallback, theme]);

    // Redraw all strokes
    const redrawStrokes = useCallback(() => {
        const canvas = contentCanvasRef.current; // Draw on the backing canvas
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw all strokes using utility
        drawAllStrokes(ctx, strokesRef.current, theme);

        // Draw unified selection highlight
        if (selectedStrokeIndices.length > 0) {
            drawSelectionHighlight(ctx, strokesRef.current, selectedStrokeIndices);
        }

        // Draw lasso path (on top of everything)
        if (isLassoSelecting.current && lassoPointsRef.current.length > 1) {
            drawLassoPath(ctx, lassoPointsRef.current);
        }

        // Draw selection rect
        if (isRectSelecting.current && rectStartPos.current && currentPos.current) {
            // currentPos is screen coords, need scaled
            const dpr = window.devicePixelRatio || 1;
            // We can't use currentPos.current directly here if it's not scaled or if it's null
            // But processDraw updates lastPos. 
            // Let's use lastPos which is scaled.
            drawSelectionBox(ctx, rectStartPos.current, lastPos.current);
        }

        // Copy to visible canvas
        const visibleCanvas = canvasRef.current;
        if (visibleCanvas) {
            copyToCanvas(canvas, visibleCanvas);
        }
    }, [theme, selectedStrokeIndices]);

    useEffect(() => {
        redrawStrokes();
    }, [redrawStrokes]);

    // Clear selection when switching away from Select tool
    useEffect(() => {
        if (activeTool !== 'select-rect' && activeTool !== 'select-lasso') {
            setSelectedStrokeIndices([]);
        }
    }, [activeTool]);

    // Handle Theme Changes: Recolors existing strokes
    useEffect(() => {
        const canvas = contentCanvasRef.current; // Modify the backing canvas
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        // We use composition to replace the color of existing non-transparent pixels
        ctx.save();
        const dpr = window.devicePixelRatio || 1;
        ctx.scale(dpr, dpr);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = theme === 'dark' ? '#ffffff' : '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Update stroke style for future drawing
        ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#000000';

        // Copy to visible canvas
        const visibleCanvas = canvasRef.current;
        if (visibleCanvas) {
            const visibleCtx = visibleCanvas.getContext('2d', { willReadFrequently: true });
            if (visibleCtx) {
                visibleCtx.save();
                visibleCtx.resetTransform();
                visibleCtx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
                visibleCtx.drawImage(canvas, 0, 0);
                visibleCtx.restore();
            }
        }
    }, [theme]);

    useEffect(() => {
        setupCanvas();
        const handleResize = () => requestAnimationFrame(setupCanvas);
        window.addEventListener('resize', handleResize);

        const resizeObserver = new ResizeObserver(() => requestAnimationFrame(setupCanvas));
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [setupCanvas]);

    const getPos = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();

        let clientX, clientY;
        if ('touches' in e) {
            // Check if there are any touches
            if (e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if ((e as TouchEvent).changedTouches && (e as TouchEvent).changedTouches.length > 0) {
                // Fallback for touchend
                clientX = (e as TouchEvent).changedTouches[0].clientX;
                clientY = (e as TouchEvent).changedTouches[0].clientY;
            } else {
                return { x: 0, y: 0 };
            }
        } else {
            clientX = (e as MouseEvent).clientX;
            clientY = (e as MouseEvent).clientY;
        }

        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    // Update cursor DOM directly to avoid re-renders
    const updateCursor = (pos: { x: number, y: number } | null) => {
        if (!cursorRef.current || !containerRef.current) return;

        if (pos) {
            const containerRect = containerRef.current.getBoundingClientRect();
            // Position relative to the container, but we need screen coords for fixed pos
            // Actually, the previous implementation used fixed positioning.
            // Let's stick to that but update via transform.
            cursorRef.current.style.display = 'block';
            cursorRef.current.style.transform = `translate(${pos.x + containerRect.left}px, ${pos.y + containerRect.top}px) translate(-50%, -50%)`;
        } else {
            cursorRef.current.style.display = 'none';
        }
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        isDrawingRef.current = true;
        setIsDrawingState(true);

        const pos = getPos(e.nativeEvent);
        const dpr = window.devicePixelRatio || 1;
        const scaledPos = { x: pos.x * dpr, y: pos.y * dpr };
        lastPos.current = scaledPos;
        currentPos.current = pos;

        if (activeTool === 'pen') {
            currentStrokeRef.current = [scaledPos];
        } else if (activeTool === 'select-rect' || activeTool === 'select-lasso') {
            // First, check if clicking inside existing selection bounding box
            if (selectedStrokeIndices.length > 0) {
                const bounds = getSelectionBounds(strokesRef.current, selectedStrokeIndices);
                if (bounds && isPointInBounds(scaledPos, bounds, 5 * dpr)) {
                    // Clicking inside selection bounds -> start dragging
                    isDragging.current = true;
                    dragStartPos.current = scaledPos;
                    return; // Don't change selection
                }
            }

            const clickedStrokeIndex = strokesRef.current.findIndex(stroke =>
                isPointNearStroke(scaledPos, stroke, 10 * dpr)
            );

            if (clickedStrokeIndex !== -1) {
                if (selectedStrokeIndices.includes(clickedStrokeIndex)) {
                    // Clicking on already selected stroke -> prepare drag
                    isDragging.current = true;
                    dragStartPos.current = scaledPos;
                } else {
                    // New selection
                    setSelectedStrokeIndices([clickedStrokeIndex]);
                    isDragging.current = true;
                    dragStartPos.current = scaledPos;
                }
            } else {
                // Clicked on empty space

                // Clear previous selection
                setSelectedStrokeIndices([]);
                isDragging.current = false;
                dragStartPos.current = null;

                if (activeTool === 'select-lasso') {
                    isLassoSelecting.current = true;
                    lassoPointsRef.current = [scaledPos];
                } else {
                    // Rect Selection
                    isRectSelecting.current = true;
                    rectStartPos.current = scaledPos;
                }
            }
        }

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };

    const processDraw = (currentPosData: { x: number, y: number }) => {
        if (!isDrawingRef.current) return;

        const dpr = window.devicePixelRatio || 1;
        const scaledPos = { x: currentPosData.x * dpr, y: currentPosData.y * dpr };

        const canvas = contentCanvasRef.current; // Draw on the backing canvas
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (!canvas || !ctx) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (activeTool === 'pen') {
            // Draw stroke
            ctx.beginPath();
            ctx.moveTo(lastPos.current.x, lastPos.current.y);
            ctx.lineTo(scaledPos.x, scaledPos.y);
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = 3 * dpr;
            ctx.strokeStyle = theme === 'dark' ? '#ffffff' : '#000000';
            ctx.stroke();

            currentStrokeRef.current.push(scaledPos);

        } else if (activeTool === 'eraser-radial') {
            // Radial erase
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = ERASER_SIZE * dpr;
            ctx.beginPath();
            ctx.moveTo(lastPos.current.x, lastPos.current.y);
            ctx.lineTo(scaledPos.x, scaledPos.y);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';

            // Also remove from strokes data for consistency
            // Split strokes instead of deleting them entirely
            strokesRef.current = splitStrokes(strokesRef.current, scaledPos, (ERASER_SIZE / 2) * dpr);

        } else if (activeTool === 'eraser-line') {
            // Line erase - remove entire strokes
            const beforeCount = strokesRef.current.length;
            strokesRef.current = strokesRef.current.filter(stroke =>
                !isPointNearStroke(scaledPos, stroke, 10 * dpr)
            );

            if (strokesRef.current.length !== beforeCount) {
                redrawStrokes();
            }
        } else if ((activeTool === 'select-rect' || activeTool === 'select-lasso') && isDragging.current && dragStartPos.current) {
            // Move Logic
            const dx = scaledPos.x - lastPos.current.x;
            const dy = scaledPos.y - lastPos.current.y;

            selectedStrokeIndices.forEach(index => {
                const stroke = strokesRef.current[index];
                if (stroke) {
                    stroke.points = stroke.points.map(p => ({
                        x: p.x + dx,
                        y: p.y + dy,
                        pressure: p.pressure
                    }));
                }
            });
            redrawStrokes();
        } else if (activeTool === 'select-lasso' && isLassoSelecting.current) {
            // Lasso Selection Logic
            lassoPointsRef.current.push(scaledPos);

            // Real-time selection update using lasso polygon
            const newSelectedIndices: number[] = [];
            strokesRef.current.forEach((stroke, index) => {
                if (isStrokeInPolygon(stroke, lassoPointsRef.current)) {
                    newSelectedIndices.push(index);
                }
            });

            // Note: calling this state setter inside a draw loop is generally skipped if value hasn't changed,
            // but for high freq we should check equality first.
            // React state updates are batched, but might be too frequent.
            // For now, let's trust React optimization or we could throttle this specific update.
            setSelectedStrokeIndices((prev) => {
                if (prev.length === newSelectedIndices.length && prev.every((val, index) => val === newSelectedIndices[index])) {
                    return prev;
                }
                return newSelectedIndices;
            });

            redrawStrokes();
        } else if (activeTool === 'select-rect' && isRectSelecting.current && rectStartPos.current) {
            // Rect Selection Logic

            // Real-time selection update
            const newSelectedIndices: number[] = [];

            // Calculate normalized rect
            const x = Math.min(rectStartPos.current.x, scaledPos.x);
            const y = Math.min(rectStartPos.current.y, scaledPos.y);
            const w = Math.abs(scaledPos.x - rectStartPos.current.x);
            const h = Math.abs(scaledPos.y - rectStartPos.current.y);

            const rect = { x, y, w, h };

            strokesRef.current.forEach((stroke, index) => {
                if (isStrokeInRect(stroke, rect)) {
                    newSelectedIndices.push(index);
                }
            });

            // Optimize state updates
            setSelectedStrokeIndices((prev) => {
                if (prev.length === newSelectedIndices.length && prev.every((val, index) => val === newSelectedIndices[index])) {
                    return prev;
                }
                return newSelectedIndices;
            });

            redrawStrokes();
        }

        lastPos.current = scaledPos;

        // Copy to visible canvas
        const visibleCanvas = canvasRef.current;
        if (visibleCanvas) {
            const visibleCtx = visibleCanvas.getContext('2d', { willReadFrequently: true });
            if (visibleCtx) {
                visibleCtx.save();
                visibleCtx.resetTransform();
                visibleCtx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
                visibleCtx.drawImage(canvas, 0, 0);
                visibleCtx.restore();
            }
        }
    };

    const stopDrawing = () => {
        if (isDrawingRef.current) {
            isDrawingRef.current = false;
            setIsDrawingState(false);

            isDragging.current = false;
            dragStartPos.current = null;

            if (isLassoSelecting.current) {
                isLassoSelecting.current = false;
                lassoPointsRef.current = [];
                redrawStrokes();
            }

            if (isRectSelecting.current) {
                isRectSelecting.current = false;
                rectStartPos.current = null;
                redrawStrokes();
            }

            // Save stroke for line eraser
            if (activeTool === 'pen' && currentStrokeRef.current.length > 1) {
                strokesRef.current.push({
                    points: [...currentStrokeRef.current],
                    tool: 'pen',
                    color: theme === 'dark' ? '#ffffff' : '#000000',
                    width: 3
                });
            }
            currentStrokeRef.current = [];

            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
                onStrokeEnd();
            }, 600);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const pos = getPos(e.nativeEvent);
        currentPos.current = pos;
        updateCursor(pos);
        if (isDrawingRef.current) {
            // In a real rAF loop we would read currentPos.current inside loop.
            // But since we are simplifying without a full detached loop
            // we can still just call processDraw here but we gained the benefit
            // of NO React re-renders because isDrawing is a Ref and Cursor is direct DOM.
            // To properly use rAF, we should decouple completely, 
            // but eliminating the React Render cycle is the biggest win.
            // Let's optimize by just calling processDraw directly here which is fast
            // without the overhead of React Re-conciliation.
            processDraw(pos);
        }
    };

    const handleMouseLeave = () => {
        currentPos.current = null;
        updateCursor(null);
        stopDrawing();
    };

    const showEraserCursor = (activeTool === 'eraser-radial' || activeTool === 'eraser-line');

    return (
        <div
            ref={containerRef}
            className="w-full h-full touch-none overflow-hidden transition-all duration-500 relative"
            style={{
                cursor: 'none',
                backgroundImage: `radial-gradient(${theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'} 1px, transparent 1px)`,
                backgroundSize: '24px 24px',
                backgroundPosition: '0 0'
            }}
        >
            <canvas
                ref={canvasRef}
                className="block touch-none select-none"
                onMouseDown={startDrawing}
                onMouseMove={handleMouseMove}
                onMouseUp={stopDrawing}
                onMouseLeave={handleMouseLeave}
                onTouchStart={startDrawing}
                onTouchMove={(e) => {
                    const pos = getPos(e.nativeEvent);
                    currentPos.current = pos;
                    updateCursor(pos);
                    if (isDrawingRef.current) processDraw(pos);
                }}
                onTouchEnd={stopDrawing}
                onDragStart={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
            />

            {/* Custom cursor (Direct DOM Control) */}
            <div
                ref={cursorRef}
                className="pointer-events-none fixed z-50 rounded-full"
                style={{
                    display: 'none',
                    left: 0,
                    top: 0,
                    // Use marginLeft/Top to center the transform origin if needed, or just transform
                    // Default values, updated by ref
                    width: showEraserCursor && activeTool === 'eraser-radial' ? ERASER_SIZE :
                        showEraserCursor ? 20 : 6,
                    height: showEraserCursor && activeTool === 'eraser-radial' ? ERASER_SIZE :
                        showEraserCursor ? 20 : 6,
                    borderWidth: showEraserCursor ? '2px' : '0px',
                    borderColor: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
                    borderStyle: activeTool === 'eraser-line' ? 'dashed' : 'solid',
                    backgroundColor: !showEraserCursor ? (theme === 'dark' ? '#fff' : '#000') : 'transparent',
                    transform: 'translate(-9999px, -9999px)' // Initial off-screen
                }}
            />
        </div>
    );
};

export default CanvasBoard;