/**
 * Copying a block of text out of the game, on a phone.
 *
 * Split out of `./debug.ts` in Milestone 9: the capture summary was already
 * copied and the device report is copied too, and the fallback below is long
 * enough to deserve its own file and its own test.
 *
 * Two paths, in order:
 *
 *   1. `navigator.clipboard.writeText`. What every current browser wants, and
 *      what the hosted playtest link gets.
 *   2. A hidden textarea and `document.execCommand('copy')`. Deprecated, and
 *      the only thing that works in a WKWebView served from `capacitor://` —
 *      an origin Safari does not treat as a secure context, where
 *      `navigator.clipboard` is simply absent. The whole point of the report is
 *      that the owner can paste it into a message from the phone, so the app
 *      build is exactly the build that needs the deprecated call.
 *
 * Never throws and never rejects: a failed copy is `false`, and the caller
 * shows the text on screen instead (`./debug.ts` renders the report for a
 * screenshot). Both surfaces are passed in rather than read from globals, so
 * the fallback is testable without a DOM.
 */

/** Just enough of `navigator.clipboard` to write text. */
export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>;
}

/** Where a copy is attempted. Either half may be missing. */
export interface CopySurface {
  clipboard: ClipboardWriter | null;
  document: Document | null;
}

/** The page's own surface: what the panel passes in real life. */
export function browserSurface(): CopySurface {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  return {
    clipboard: clipboard === undefined ? null : clipboard,
    document: typeof document === 'undefined' ? null : document,
  };
}

/** True when the text reached the clipboard by either path. */
export async function copyText(text: string, surface: CopySurface): Promise<boolean> {
  const clipboard = surface.clipboard;
  if (clipboard !== null) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Denied permission, or a call made outside a user gesture. The textarea
      // below is still worth a try: it is the one path a WKWebView allows.
    }
  }
  return copyByTextarea(text, surface.document);
}

/**
 * The `execCommand` path. The textarea has to be *in* the document and visible
 * enough to hold a selection — `display: none` and `visibility: hidden` both
 * make the selection empty — so it is parked off-screen at one pixel instead,
 * and taken out again in a `finally` so a throw cannot leave it there.
 */
function copyByTextarea(text: string, doc: Document | null): boolean {
  if (doc === null) return false;
  const body = doc.body;
  if (body === null) return false;

  let area: HTMLTextAreaElement | null = null;
  try {
    area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.width = '1px';
    area.style.height = '1px';
    area.style.padding = '0';
    area.style.border = 'none';
    area.style.opacity = '0';
    body.appendChild(area);
    area.focus();
    area.select();
    // iOS ignores `select()` on a readonly field unless the range is set too.
    area.setSelectionRange(0, text.length);
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area?.remove();
  }
}
