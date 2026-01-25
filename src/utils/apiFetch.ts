export interface ApiError extends Error {
  status?: number;
  statusText?: string;
}

export async function apiFetch<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ data: T; response: Response }> {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as ApiError;
      error.status = response.status;
      error.statusText = response.statusText;
      throw error;
    }

    const data = await response.json();
    return { data, response };
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      throw error; // Re-throw ApiError
    }

    // Network or parsing error
    const apiError = new Error(
      error instanceof Error ? error.message : 'Network request failed'
    ) as ApiError;
    apiError.status = undefined;
    apiError.statusText = undefined;
    throw apiError;
  }
}
