import React from 'react';
import { useAppContext } from './contexts/AppContext';

const LoadingOverlay: React.FC = () => {
    const {
        status,
    } = useAppContext();

    const error = status === 'error' ? 'Failed to get LaTeX from server. Please ensure the TexTeller server is running and accessible. Refer to services/tex-teller/README.md for instructions.' : undefined;

    // Only show overlay if loading or error
    if (status !== 'loading' && status !== 'error') {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-2xl max-w-md w-full mx-4">
                <div className="text-center">
                    {error ? (
                        <>
                            <div className="text-red-500 text-6xl mb-4">⚠️</div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                Loading Failed
                            </h2>
                            <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                                {error}
                            </p>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                            >
                                Retry
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="text-6xl mb-4 animate-pulse">🧠</div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                Loading AI Model
                            </h2>
                            <p className="text-gray-500 dark:text-gray-500 text-xs mt-2">
                                Loading models...
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;
