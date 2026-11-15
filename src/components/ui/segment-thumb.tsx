import type { ReactNode } from "react";

/**
 * The raised thumb of a segmented control. It slides to the chosen segment, and the labels are drawn
 * again on top of it, clipped to its box, so the chosen label darkens exactly where the thumb is
 * instead of before it arrives. Place it inside a positioned grid of equal segments, with `labels`
 * in the same order as the segments.
 */
export function SegmentThumb({ index, labels }: { index: number; labels: ReactNode[] }) {
  const n = labels.length;
  const at = Math.max(0, index);
  const share = (k: number) => `${(k / n) * 100}%`;
  return (
    <>
      <span aria-hidden className="seg-plate" style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${at * 100}%)` }} />
      <span aria-hidden className="seg-face"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, clipPath: `inset(0 ${share(n - 1 - at)} 0 ${share(at)} round var(--r-s))` }}>
        {labels.map((label, i) => <span key={i}>{label}</span>)}
      </span>
    </>
  );
}
