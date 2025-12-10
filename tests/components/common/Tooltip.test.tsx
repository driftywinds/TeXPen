// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tooltip } from '../../../components/common/Tooltip';

describe('Tooltip', () => {
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

    beforeEach(() => {
        // Mock window dimensions
        Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });

        // Default mock implementation - element in middle of screen
        Element.prototype.getBoundingClientRect = vi.fn(() => ({
            top: 400,
            bottom: 420,
            left: 100,
            right: 200,
            width: 100,
            height: 20,
            x: 100,
            y: 400,
            toJSON: () => { }
        })) as unknown as () => DOMRect;
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    });

    it('renders children', () => {
        render(
            <Tooltip content="Tooltip Content">
                <button>Trigger</button>
            </Tooltip>
        );
        expect(screen.getByText('Trigger')).toBeInTheDocument();
        // Content should be present but invisible
        const content = screen.queryByText('Tooltip Content');
        expect(content).toBeInTheDocument();
        // Check invisibility (opacity-0 invisible)
        const container = content?.closest('.absolute');
        expect(container?.className).toContain('invisible');
    });

    it('shows content on mouse enter and hides on mouse leave', () => {
        render(
            <Tooltip content="Content">
                <button>Trigger</button>
            </Tooltip>
        );

        fireEvent.mouseEnter(screen.getByText('Trigger').closest('.relative')!);

        const content = screen.getByText('Content');
        const container = content.closest('.absolute');
        expect(container?.className).toContain('visible');
        expect(container?.className).not.toContain('invisible');

        fireEvent.mouseLeave(screen.getByText('Trigger').closest('.relative')!);
        expect(container?.className).toContain('invisible');
    });

    it('toggles content on click (mobile support)', () => {
        render(
            <Tooltip content="Content">
                <button>Trigger</button>
            </Tooltip>
        );

        const trigger = screen.getByText('Trigger').closest('.relative')!;
        const content = screen.getByText('Content');
        const container = content.closest('.absolute');

        // Click to show
        fireEvent.click(trigger);
        expect(container?.className).toContain('visible');

        // Click to hide
        fireEvent.click(trigger);
        expect(container?.className).toContain('invisible');
    });

    it('positions content at bottom when requested', () => {
        render(
            <Tooltip content="Content" side="bottom">
                <button>Trigger</button>
            </Tooltip>
        );

        // Trigger visibility to check position classes
        fireEvent.mouseEnter(screen.getByText('Trigger').closest('.relative')!);

        const tooltipContainer = screen.getByText('Content').closest('.absolute');
        expect(tooltipContainer?.className).toContain('top-full');
    });

    it('flips to bottom if top placement goes off-screen', () => {
        // Simulate element at the very top of screen (top: 0)
        Element.prototype.getBoundingClientRect = vi.fn(function (this: Element) {
            // If checking the parent/trigger
            // Note: In refined implementation, we check the triggerRef directly.
            // We need to ensure the mock returns correct rect for the element that ref is attached to.
            // Since we can't easily distinguish *which* element is calling getBoundingClientRect in the mock
            // without checking 'this', and 'this' might be generic div in tests.

            // Simplification: We assume the first call or the call inside the effect is for the trigger.
            // But Wait, the test environment calls it multiple times.

            // Strategy: The trigger (parent) is at top.
            return { top: 0, bottom: 20, left: 0, right: 100, height: 20, width: 100, x: 0, y: 0 } as DOMRect;
        }) as unknown as () => DOMRect;

        render(
            <Tooltip content="Flipping Content" side="top">
                <button>Trigger</button>
            </Tooltip>
        );

        // Make it visible to trigger the layout effect check
        const trigger = screen.getByText('Trigger').closest('.relative')!;
        fireEvent.mouseEnter(trigger);

        const tooltipContainer = screen.getByText('Flipping Content').closest('.absolute');

        expect(tooltipContainer?.className).toContain('top-full');
    });
});
