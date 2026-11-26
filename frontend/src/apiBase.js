// Where the backend lives. Kept on its own so tests (node --test, no Vite) can import the API client.
export const API_BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
