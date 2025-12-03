// services/tex-teller/texteller.ts

const TEXTELLER_SERVER_URL = 'http://localhost:8000/predict';

/**
 * Converts an image to LaTeX by sending it to the TexTeller server.
 * @param imageBlob - The input image as a Blob.
 * @returns A promise that resolves to the generated LaTeX string.
 */
export async function img2latex(imageBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('img', imageBlob, 'image.png');

    try {
        const response = await fetch(TEXTELLER_SERVER_URL, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`TexTeller server request failed: ${response.statusText}`);
        }

        const latex = await response.text();
        return latex;
    } catch (error) {
        console.error('Error contacting TexTeller server:', error);
        throw new Error('Failed to get LaTeX from server. Is the TexTeller server running? See services/tex-teller/README.md');
    }
}
