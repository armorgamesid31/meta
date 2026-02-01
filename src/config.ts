// For client-side config, use import.meta.env
// For server-side, this will be empty and should be handled by environment variables
export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';
