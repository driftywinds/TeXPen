import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactNode;
    width?: string;
    side?: 'top' | 'bottom';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, width = 'w-48', side = 'top' }) => {
    const triggerRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<'top' | 'bottom'>(side);
    const [isVisible, setIsVisible] = useState(false);

    useLayoutEffect(() => {
        if (!isVisible) return;

        const checkPosition = () => {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const viewportHeight = window.innerHeight;

                // Simple collision detection
                // If preferred is top but we are too close to top edge (e.g. < 40px space), flip to bottom
                if (side === 'top' && rect.top < 40) {
                    setPosition('bottom');
                }
                // If preferred is bottom but close to bottom edge, flip to top
                // (Assuming 40px buffer)
                else if (side === 'bottom' && rect.bottom > viewportHeight - 40) {
                    setPosition('top');
                } else {
                    setPosition(side);
                }
            }
        };

        checkPosition();
        window.addEventListener('resize', checkPosition);
        window.addEventListener('scroll', checkPosition, true);

        return () => {
            window.removeEventListener('resize', checkPosition);
            window.removeEventListener('scroll', checkPosition, true);
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
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isVisible]);

    const handleMouseEnter = () => setIsVisible(true);
    const handleMouseLeave = () => setIsVisible(false);
    const handleClick = (e: React.MouseEvent) => {
        // Toggle on click, useful for mobile
        e.stopPropagation(); // Prevent immediate close by document listener? No, listener is on document.
        setIsVisible(!isVisible);
    };

    return (
        <div
            ref={triggerRef}
            className="relative inline-block" // Changed from group/tooltip to inline-block
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            {children}

            <div
                className={`absolute ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} ${width} p-2 bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-[60] transition-all duration-200 text-left -right-2 md:right-0 md:left-auto ${isVisible ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside tooltip
            >
                <div className="text-[10px] text-slate-500 dark:text-white/60 leading-tight">
                    {content}
                </div>
            </div>
        </div>
    );
};
