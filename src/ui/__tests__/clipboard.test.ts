/**
 * Copying the report off the phone (`src/ui/clipboard.ts`).
 *
 * The fallback is the whole point of the file: inside the Capacitor app the
 * page is served from an origin WKWebView does not treat as secure, so
 * `navigator.clipboard` is simply absent and the only thing that works is a
 * hidden textarea and the deprecated `document.execCommand('copy')`. That path
 * cannot be exercised in a browser here — the Vitest environment is `node` and
 * the repo adds no jsdom — so the surface is handed in instead, which is why
 * `copyText` takes one rather than reading the globals.
 */

import { describe, expect, it, vi } from 'vitest';

import { browserSurface, copyText } from '../clipboard';
import type { CopySurface } from '../clipboard';

/** The parts of a `<textarea>` the fallback touches, and nothing else. */
interface FakeArea {
  value: string;
  style: Record<string, string>;
  removed: boolean;
}

interface FakeDoc {
  surface: CopySurface;
  areas: FakeArea[];
  /** Live children of `body`, so a leaked textarea is visible to the test. */
  attached: number;
}

function fakeDocument(exec: (command: string) => boolean): FakeDoc {
  const doc: FakeDoc = { surface: { clipboard: null, document: null }, areas: [], attached: 0 };
  const document = {
    createElement: (): unknown => {
      const area: FakeArea = { value: '', style: {}, removed: false };
      doc.areas.push(area);
      return {
        get value(): string {
          return area.value;
        },
        set value(next: string) {
          area.value = next;
        },
        style: area.style,
        setAttribute: () => undefined,
        focus: () => undefined,
        select: () => undefined,
        setSelectionRange: () => undefined,
        remove: () => {
          area.removed = true;
          doc.attached--;
        },
      };
    },
    body: {
      appendChild: () => {
        doc.attached++;
      },
    },
    execCommand: exec,
  };
  // The fallback needs four members of `Document`; a fake with those four is
  // the honest way to test it without a DOM.
  doc.surface = { clipboard: null, document: document as unknown as Document };
  return doc;
}

describe('copyText', () => {
  it('uses the clipboard API when there is one', async () => {
    const writeText = vi.fn(async () => undefined);
    const doc = fakeDocument(() => true);
    const surface: CopySurface = { ...doc.surface, clipboard: { writeText } };

    expect(await copyText('the report', surface)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('the report');
    // The deprecated path is not touched when the supported one worked.
    expect(doc.areas).toHaveLength(0);
  });

  it('falls back to a textarea when there is no clipboard API', async () => {
    const doc = fakeDocument(() => true);

    expect(await copyText('the report', doc.surface)).toBe(true);
    expect(doc.areas).toHaveLength(1);
    expect(doc.areas[0]?.value).toBe('the report');
    // Off-screen rather than hidden: a `display: none` textarea holds no
    // selection, and `execCommand` copies the selection.
    expect(doc.areas[0]?.style.position).toBe('fixed');
  });

  it('falls back to the textarea when the clipboard API refuses', async () => {
    const doc = fakeDocument(() => true);
    const surface: CopySurface = {
      ...doc.surface,
      clipboard: {
        writeText: async () => {
          await Promise.resolve();
          throw new Error('NotAllowedError');
        },
      },
    };

    expect(await copyText('the report', surface)).toBe(true);
    expect(doc.areas).toHaveLength(1);
  });

  it('takes the textarea back out again, copied or not', async () => {
    const ok = fakeDocument(() => true);
    await copyText('x', ok.surface);
    expect(ok.areas[0]?.removed).toBe(true);
    expect(ok.attached).toBe(0);

    const thrown = fakeDocument(() => {
      throw new Error('execCommand is gone');
    });
    expect(await copyText('x', thrown.surface)).toBe(false);
    expect(thrown.areas[0]?.removed).toBe(true);
    expect(thrown.attached).toBe(0);
  });

  it('is false rather than a throw when nothing at all can copy', async () => {
    expect(await copyText('x', { clipboard: null, document: null })).toBe(false);
    expect(await copyText('x', fakeDocument(() => false).surface)).toBe(false);
  });
});

describe('browserSurface', () => {
  it('is two nulls where there is no browser, which is what the node tests are', () => {
    expect(browserSurface()).toEqual({ clipboard: null, document: null });
  });
});
