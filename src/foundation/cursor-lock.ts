/**
 * While dragging, the pointer often leaves the handle. Without help, the
 * cursor would flicker to whatever it's over, and the drag would select text.
 * A lock forces one cursor everywhere (unless it's `null`, which leaves
 * cursors be) and turns off text selection until it's released.
 */

let styleElement: HTMLStyleElement | null = null;
// Stacked so that overlapping drags (e.g. two touches) restore correctly.
const activeCursors: (string | null)[] = [];

/**
 * Shows `cursor` everywhere (`null`: leaves cursors be) and blocks text
 * selection until the returned function is called.
 */
export function lockCursor(cursor: string | null): () => void {
  activeCursors.push(cursor);
  render();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCursors.splice(activeCursors.lastIndexOf(cursor), 1);
    render();
  };
}

function render() {
  if (activeCursors.length === 0) {
    styleElement?.remove();
    styleElement = null;
    return;
  }

  styleElement ??= document.head.appendChild(document.createElement("style"));
  const cursor = activeCursors.at(-1);
  // `*` beats inherited cursors from elements that set their own.
  styleElement.textContent = `*, *::before, *::after { ${cursor === null ? "" : `cursor: ${cursor} !important; `}user-select: none !important; }`;
}
