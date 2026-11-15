import { domToCanvas } from "modern-screenshot";

export type Shots = { look: HTMLCanvasElement; lines: HTMLCanvasElement; zoom: number };

// Rules are scoped to the cloned page: a bare `svg` would also match the <svg> the snapshot is drawn into and hide it all.
const SCOPE = "[data-shot]";

/** Selection and hover rings are the live page's, drawn over it; the snapshot is only the page itself. */
const PLAIN = `${SCOPE}, ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after { outline: none !important; }`;

/** Only lines: every border and rule in white at its own width, on black. No text, icons, pictures, fills or shadows. */
const LINES = `${SCOPE}, ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after {
  outline: none !important; color: transparent !important; -webkit-text-stroke: 0 !important; text-shadow: none !important;
  background: transparent !important; box-shadow: none !important; border-color: #fff !important;
  text-decoration-color: transparent !important; caret-color: transparent !important;
}
${SCOPE} img, ${SCOPE} svg, ${SCOPE} canvas, ${SCOPE} video { visibility: hidden !important; }`;

function withStyle(css: string) {
  return (clone: Node) => {
    if (!(clone instanceof HTMLElement)) return;
    clone.setAttribute("data-shot", "");
    const style = document.createElement("style");
    style.textContent = css;
    clone.prepend(style);
  };
}

/**
 * Pictures of the page for the glow to bend: how it looks, and where its lines are. Taken while the user is idle,
 * so the sweep never waits on them.
 */
export async function shootPage(page: HTMLElement, zoom: number): Promise<Shots> {
  const scale = Math.min(2, window.devicePixelRatio || 1) * zoom;
  const common = {
    // The page is laid out at its own size and only scaled for the screen; picture it at that size, scaled the same.
    width: page.offsetWidth,
    height: page.offsetHeight,
    scale,
    style: { transform: "none" },
    font: false as const,
    // Workers can't start from a file:// page.
    workerNumber: 0,
  };
  const look = await domToCanvas(page, { ...common, backgroundColor: "#fff", onCloneNode: withStyle(PLAIN) });
  const lines = await domToCanvas(page, { ...common, backgroundColor: "#000", onCloneNode: withStyle(LINES) });
  return { look, lines, zoom };
}
