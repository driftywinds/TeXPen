/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NavRail from '../components/NavRail';
import { ThemeContext } from '../components/contexts/ThemeContext';
import { AppContext } from '../components/contexts/AppContext';

// Mock contexts
const mockToggleTheme = vi.fn();
const mockToggleSidebar = vi.fn();
const mockOnModeChange = vi.fn();

const renderNavRail = (
    activeMode: 'draw' | 'upload' = 'draw',
    theme: 'light' | 'dark' = 'light',
    isSidebarOpen = false
) => {
    return render(
        <ThemeContext.Provider value={{ theme, toggleTheme: mockToggleTheme }}>
            <AppContext.Provider value={{ isSidebarOpen, toggleSidebar: mockToggleSidebar }}>
                <NavRail activeMode={activeMode} onModeChange={mockOnModeChange} />
            </AppContext.Provider>
        </ThemeContext.Provider>
    );
};

describe('NavRail Component', () => {
    it('renders correctly', () => {
        renderNavRail();
        // Check for logo presence (text)
        // Note: TeXPenLogo renders an SVG, we might check for the container or similar
        // For now, let's check buttons exist
        expect(screen.getByTitle('Draw')).toBeInTheDocument();
        expect(screen.getByTitle('Upload Image')).toBeInTheDocument();
    });

    it('navigates to Upload mode when clicked', () => {
        renderNavRail('draw');
        const uploadBtn = screen.getByTitle('Upload Image');
        fireEvent.click(uploadBtn);
        expect(mockOnModeChange).toHaveBeenCalledWith('upload');
    });

    it('navigates to Draw mode when clicked', () => {
        renderNavRail('upload');
        const drawBtn = screen.getByTitle('Draw');
        fireEvent.click(drawBtn);
        expect(mockOnModeChange).toHaveBeenCalledWith('draw');
    });

    it('toggles theme when theme button is clicked', () => {
        renderNavRail();
        const themeBtn = screen.getByTitle('Toggle Theme');
        fireEvent.click(themeBtn);
        expect(mockToggleTheme).toHaveBeenCalled();
    });

    it('toggles sidebar when history button is clicked', () => {
        renderNavRail();
        const historyBtn = screen.getByTitle('History');
        fireEvent.click(historyBtn);
        expect(mockToggleSidebar).toHaveBeenCalled();
    });
});
