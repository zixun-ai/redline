import { useLanguage } from "@/lib/language";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  /** Which panel it sits on; the handle is on that panel's inner edge. */
  side: "left" | "right";
  label: string;
  width: number;
  min: number;
  max: number;
  /** null puts the panel back to its default width. */
  onWidth: (w: number | null) => void;
};

/** A panel's draggable edge. Arrow keys move it 16px (48 with Shift), and a double-click resets it. */
export function ResizeHandle({ side, label, width, min, max, onWidth }: Props) {
  const { t } = useLanguage();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    document.documentElement.classList.remove("resizing");
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t("拖动调整宽度，双击恢复", "Drag to resize. Double-click to reset.")}
      className={cn("resize", side, dragging && "dragging")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width };
        setDragging(true);
        document.documentElement.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        onWidth(clamp(d.w + (side === "left" ? dx : -dx)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const step = e.shiftKey ? 48 : 16;
        const wider = (e.key === "ArrowRight") === (side === "left");
        onWidth(clamp(width + (wider ? step : -step)));
      }}
    />
  );
}
