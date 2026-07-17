import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs synchronously before any static imports are evaluated.
// This lets us set process.env before api-canary.mjs captures GITHUB_TOKEN as a const.
vi.hoisted(() => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.CANARY_GH_RETRY_DELAY_MS = '0'; // no sleep during tests
});

// Mock the playwright probe so importing api-canary.mjs doesn't require a real browser.
vi.mock('./probe.mjs', () => ({
  probeFlightApi: vi.fn(),
  isChallengeHtml: vi.fn(() => false),
}));

import { findOpenIncident, ghApiRetry, GH_READ_FAILED } from './api-canary.mjs';

// fetch is set to vi.fn() globally by src/test/setup.js.
// Each test configures its own responses; vi.resetAllMocks() wipes them between tests.

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ghApiRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ number: 1 }] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([{ number: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and succeeds on the next attempt', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws after all retry attempts are exhausted', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    await expect(
      ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1', 2),
    ).rejects.toThrow('503');
    expect(fetch).toHaveBeenCalledTimes(2); // exactly maxAttempts
  });

  it('does not retry on 404 (non-retriable error)', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not Found' });
    await expect(
      ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1'),
    ).rejects.toThrow('404');
    expect(fetch).toHaveBeenCalledTimes(1); // no retry for 404
  });

  it('retries on 429 (rate limit)', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('findOpenIncident', () => {
  it('returns null when no open incidents', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncident();
    expect(result).toBeNull();
  });

  it('returns the open incident object when one exists', async () => {
    const issue = { number: 42, title: '🚨 API down (availability)', created_at: '2026-07-17T00:00:00Z' };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [issue] });
    const result = await findOpenIncident();
    expect(result).toEqual(issue);
  });

  it('returns GH_READ_FAILED when GitHub API returns 503 on every attempt (default 3 retries)', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    const result = await findOpenIncident();
    expect(result).toBe(GH_READ_FAILED);
    expect(fetch).toHaveBeenCalledTimes(3); // exhausted all 3 attempts
  });

  it('recovers and returns null when a retry succeeds after an initial 503', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncident();
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('GH_READ_FAILED is a Symbol distinct from null', () => {
    expect(typeof GH_READ_FAILED).toBe('symbol');
    expect(GH_READ_FAILED).not.toBeNull();
  });
});
