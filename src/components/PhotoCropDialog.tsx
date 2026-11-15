import { useLanguage } from "@/lib/language";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { IconButton } from "./IconButton";
import { localizeError } from "@/lib/errorLocale";
import { cropPhoto, decodePhoto, DEFAULT_PHOTO_CROP, photoCropRect, type PhotoCrop } from "../lib/files";

export function PhotoCropDialog({ file, onSave, onClose }: { file: File; onSave: (photo: string) => void; onClose: () => void }) {
  const { english, t } = useLanguage();
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState(DEFAULT_PHOTO_CROP);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const invoker = useRef(document.activeElement as HTMLElement | null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const descriptionId = useId();
  const zoomId = useId();
  useEffect(() => {
    let disposed = false;
    let decoded: ImageBitmap | undefined;
    void decodePhoto(file).then((image) => {
      if (disposed) image.close();
      else { decoded = image; setBitmap(image); }
    }).catch((e: Error) => { if (!disposed) setError(e.message); });
    return () => { disposed = true; decoded?.close(); };
  }, [file]);
  useEffect(() => {
    if (!bitmap || !canvas.current) return;
    try {
      const ctx = canvas.current.getContext("2d");
      if (!ctx) throw new Error("浏览器无法预览这张图片，请重试或换一张。");
      const r = photoCropRect(bitmap.width, bitmap.height, crop);
      ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, 300, 420);
    } catch (e) { setError((e as Error).message); }
  }, [bitmap, crop]);
  const update = (change: (previous: PhotoCrop) => PhotoCrop) => {
    if (!bitmap) return;
    setCrop((previous) => {
      const next = change(previous);
      const r = photoCropRect(bitmap.width, bitmap.height, next);
      return { ...next, x: (r.x + r.width / 2) / bitmap.width, y: (r.y + r.height / 2) / bitmap.height };
    });
  };
  const pan = (dx: number, dy: number) => update((previous) => {
    const r = photoCropRect(bitmap!.width, bitmap!.height, previous);
    return { ...previous, x: previous.x - dx * r.width / bitmap!.width, y: previous.y - dy * r.height / bitmap!.height };
  });
  const save = () => {
    if (!bitmap) return;
    try { onSave(cropPhoto(bitmap, crop)); } catch (e) { setError((e as Error).message); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dialog chrome photo-crop-dialog" aria-describedby={descriptionId}
      onCloseAutoFocus={(e) => { e.preventDefault(); if (invoker.current?.isConnected) invoker.current.focus(); }}>
      <DialogHeader><DialogTitle>{t("调整证件照", "Crop portrait")}</DialogTitle></DialogHeader>
      <p id={descriptionId} className="hint">{t("拖动照片调整位置，也可用下方方向按钮。保存区域比例为 5:7。", "Drag the photo or use the arrow buttons below to position it. The crop uses a 5:7 aspect ratio.")}</p>
      {error ? <p className="photo-error" role="alert">{localizeError(error, english)}</p> : !bitmap && <p className="hint">{t("正在读取照片…", "Loading photo…")}</p>}
      <canvas ref={canvas} width={300} height={420} className="photo-crop-preview" role="img" aria-label={t("证件照裁切预览", "Portrait crop preview")} hidden={!bitmap || !!error}
        onPointerDown={(e) => {
          if (e.button !== 0 || pointer.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.dataset.dragging = "true";
        }}
        onPointerMove={(e) => {
          const previous = pointer.current;
          if (!previous || previous.id !== e.pointerId) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          pan((e.clientX - previous.x) / bounds.width, (e.clientY - previous.y) / bounds.height);
          pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onLostPointerCapture={(e) => { if (pointer.current?.id === e.pointerId) { pointer.current = null; delete e.currentTarget.dataset.dragging; } }} />
      <div className="photo-crop-controls">
        <label htmlFor={zoomId}>{t("缩放", "Zoom")} <output>{Math.round(crop.zoom * 100)}%</output></label>
        <input id={zoomId} type="range" min={1} max={3} step={0.01} value={crop.zoom} disabled={!bitmap || !!error}
          onChange={(e) => update((previous) => ({ ...previous, zoom: Number(e.target.value) }))} />
        <div className="photo-pan" role="group" aria-label={t("移动照片", "Move photo")}>
          {([
            [t("向左移动照片", "Move photo left"), ArrowLeft, -0.05, 0], [t("向上移动照片", "Move photo up"), ArrowUp, 0, -0.05],
            [t("向下移动照片", "Move photo down"), ArrowDown, 0, 0.05], [t("向右移动照片", "Move photo right"), ArrowRight, 0.05, 0],
          ] as const).map(([label, Icon, x, y]) => <IconButton key={label} label={label} disabled={!bitmap || !!error} onClick={() => pan(x, y)}><Icon size={16} /></IconButton>)}
          <Button variant="ghost" size="sm" disabled={!bitmap || !!error} onClick={() => setCrop(DEFAULT_PHOTO_CROP)}>{t("复位", "Reset")}</Button>
        </div>
      </div>
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose}>{t("取消", "Cancel")}</Button>
        <Button disabled={!bitmap || !!error} onClick={save}>{t("保存照片", "Save photo")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
