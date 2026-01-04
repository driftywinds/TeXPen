import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactNode;
    width?: string;
    side?: 'top' | 'bottom';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, width = 'w-48', side = 'top' }) => {
    const triggerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ top: number; left: number; side: 'top' | 'bottom' } | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    useLayoutEffect(() => {
        if (!isVisible || !triggerRef.current) return;

        const updatePosition = () => {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const scrollY = window.scrollY;
                const scrollX = window.scrollX;

                let effectiveSide = side;

                // Simple collision detection
                // If preferred is top but we are too close to top edge (e.g. < 40px space), flip to bottom
                if (side === 'top' && rect.top < 40) {
                    effectiveSide = 'bottom';
                }
                // If preferred is bottom but close to bottom edge, flip to top
                // (Assuming 40px buffer)
                else if (side === 'bottom' && rect.bottom > viewportHeight - 40) {
                    effectiveSide = 'top';
                }

                // Calculate absolute position
                // For 'top': position above the element
                // For 'bottom': position below the element
                const top = effectiveSide === 'top'
                    ? rect.top + scrollY - 8 // 8px Offset
                    : rect.bottom + scrollY + 8;

                // Center horizontally
                // We need to know the tooltip width, but it's dynamic. 
                // A common trick is to center on the trigger, and then CSS transform translate-x-1/2
                // left: rect.left + rect.width / 2 + scrollX

                setPosition({
                    top,
                    left: rect.left + (rect.width / 2) + scrollX,
                    side: effectiveSide
                });
            }
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [side, isVisible]);

    // Close on click outside
    useEffect(() => {
        if (!isVisible) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (triggerRef.current && !triggerRef.current.contains(event.target as Node)) {
                setIsVisible(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isVisible]);

    const handleMouseEnter = () => setIsVisible(true);
    const handleMouseLeave = () => setIsVisible(false);

    // Portal content
    const tooltipContent = isVisible && position ? (
        <div
            className={`absolute z-[9999] ${width} p-2 bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg shadow-xl text-left pointer-events-auto transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
            style={{
                top: position.top,
                left: position.left,
                transform: `translateX(-50%) ${position.side === 'top' ? 'translateY(-100%)' : ''}`
            }}
            onMouseDown={(e) => e.stopPropagation()} // Stop document listener from seeing clicks inside tooltip
        >
            <div className="text-[10px] text-slate-500 dark:text-white/60 leading-tight">
                {content}
            </div>
        </div>
    ) : null;

    // Use a portal
    const { createPortal } = ReactDOM; // Assuming React imports. Actually we need to import ReactDOM.

    return (
        <>
            <div
                ref={triggerRef}
                className="relative inline-block"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => { e.stopPropagation(); setIsVisible(!isVisible); }}
            >
                {children}
            </div>
            {isVisible && createPortal(tooltipContent, document.body)}
        </>
    );
};

import ReactDOM from 'react-dom';
