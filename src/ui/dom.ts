/**
 * The one lookup every screen module binds to `index.html` with.
 *
 * Split out of `./overlay.ts` when the pause menu arrived (docs/27) and the
 * overlay passed the file-size rule: each screen now finds its own elements
 * beside the code that paints them, and they all fail the same way when the
 * markup and the code disagree.
 */

export function requireElement<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Overlay is missing required element "${selector}" (see index.html)`);
  }
  return element;
}
