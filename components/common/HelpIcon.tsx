import React from 'react';

interface HelpIconProps {
    className?: string;
}

export const HelpIcon: React.FC<HelpIconProps> = ({ className = "w-3.5 h-3.5 text-slate-400 dark:text-white/30 hover:text-cyan-600 dark:hover:text-cyan-400" }) => {
    return (
        <svg
            className={`cursor-help transition-colors ${className}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
    );
};
