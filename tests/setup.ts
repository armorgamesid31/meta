import { vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({}),
  } as unknown as Response));
  // Ensure window.fetch is the same as the stubbed global fetch
  if (typeof window !== 'undefined') {
    window.fetch = globalThis.fetch;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
