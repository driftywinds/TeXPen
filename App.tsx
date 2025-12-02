import React from 'react';
import { AppProvider } from './components/contexts/AppContext';
import { ThemeProvider } from './components/contexts/ThemeContext';
import { HistoryProvider } from './components/contexts/HistoryContext';
import Main from './components/Main';

const App: React.FC = () => {
    return (
        <ThemeProvider>
            <HistoryProvider>
                <AppProvider>
                    <Main />
                </AppProvider>
            </HistoryProvider>
        </ThemeProvider>
    );
};

export default App;