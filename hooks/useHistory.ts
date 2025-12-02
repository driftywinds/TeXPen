import { useState } from 'react';
import { HistoryItem } from '../types';

export const useHistory = () => {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    const addToHistory = (item: HistoryItem) => {
        setHistory(prev => [item, ...prev].slice(0, 20));
    };

    const deleteHistoryItem = (id: string) => {
        setHistory(prev => prev.filter(item => item.id !== id));
    };

    return {
        history,
        addToHistory,
        deleteHistoryItem,
    };
};