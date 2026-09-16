/**
 * `assetBytes` against the answers the iOS shell really gives.
 *
 * Measured in the iOS Simulator (iOS 26.3, Capacitor 8.5): a `.wav` fetched
 * from the app bundle comes back with status 0, `ok` false, no headers and the
 * whole file, and the same request with `Range: bytes=0-` comes back 206.
 * Babylon refused the first, so every clip in the app was silent while the web
 * build, which gets a 200, was fine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assetBytes } from '@/render/characters/manifest';

/** What one request answers: a status and a body length, or a network failure. */
type Answer = { status: number; bytes?: number } | Error;

function stubFetch(...answers: Answer[]): ReturnType<typeof vi.fn> {
  const queue = [...answers];
  const fetchMock = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => {
    const answer = queue.shift();
    if (answer === undefined) return Promise.reject(new Error('no more requests expected'));
    if (answer instanceof Error) return Promise.reject(answer);
    // A plain object, not `new Response`: the platform refuses to build a
    // Response with status 0, which is exactly the answer under test.
    const response = {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(answer.bytes ?? 0)),
    };
    return Promise.resolve(response as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rangeOf = (init: unknown): unknown =>
  (init as { headers?: Record<string, string> } | undefined)?.headers?.Range;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assetBytes', () => {
  it('takes a status-0 answer with a body as the file (the iOS shell, for media)', async () => {
    const fetchMock = stubFetch({ status: 0, bytes: 4402 });

    const bytes = await assetBytes('/assets/audio/ui_tap.wav');

    expect(bytes.byteLength).toBe(4402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rangeOf(fetchMock.mock.calls[0]?.[1])).toBeUndefined();
  });

  it('takes an ordinary 200 (the web build)', async () => {
    stubFetch({ status: 200, bytes: 12 });

    expect((await assetBytes('/assets/vat/mage.bin')).byteLength).toBe(12);
  });

  it('asks again as a byte range when a status-0 answer is empty', async () => {
    const fetchMock = stubFetch({ status: 0 }, { status: 206, bytes: 4402 });

    const bytes = await assetBytes('/assets/audio/ui_tap.wav');

    expect(bytes.byteLength).toBe(4402);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rangeOf(fetchMock.mock.calls[1]?.[1])).toBe('bytes=0-');
  });

  it('asks again as a byte range when the request itself fails', async () => {
    stubFetch(new TypeError('Load failed'), { status: 206, bytes: 10 });

    expect((await assetBytes('/assets/audio/ui_tap.wav')).byteLength).toBe(10);
  });

  it('fails on an HTTP error without asking again', async () => {
    const fetchMock = stubFetch({ status: 404, bytes: 50 });

    await expect(assetBytes('/assets/audio/missing.wav')).rejects.toThrow(
      'HTTP 404 for /assets/audio/missing.wav',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives both reasons when neither request brings bytes', async () => {
    stubFetch(new TypeError('Load failed'), { status: 0 });

    await expect(assetBytes('/assets/audio/ui_tap.wav')).rejects.toThrow(
      /TypeError: Load failed.*as a range: status 0 and an empty body/,
    );
  });

  it('decodes a data URI without making a request (the single-file builds)', async () => {
    const fetchMock = stubFetch();

    const bytes = await assetBytes('data:audio/wav;base64,UklGRg==');

    expect(new TextDecoder().decode(bytes)).toBe('RIFF');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
