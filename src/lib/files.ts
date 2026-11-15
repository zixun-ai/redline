import { AiError, checkInputText, MAX_INPUT_CHARS } from "./deepseek";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
const MAX_IMAGE_PIXELS = 40_000_000;

function checkFileSize(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new AiError("文件超过 10 MB，请压缩或拆分后重试。");
}

type Run = { str: string; x: number; y: number; width: number };

const SAME_LINE = 3;
const COLUMN_GAP = 12;
const WORD_GAP = 2;
const MIN_GUTTER = 8;

function joinLines(runs: Run[]): string {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Run[][] = [];
  for (const run of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - run.y) <= SAME_LINE) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    return line.reduce((text, run, i) => {
      const prev = line[i - 1];
      const gap = prev ? run.x - (prev.x + prev.width) : 0;
      return text + (gap > COLUMN_GAP ? "    " : gap > WORD_GAP ? " " : "") + run.str;
    }, "");
  }).join("\n");
}

/** A sidebar layout leaves a vertical gutter that no text crosses, somewhere left of the middle. */
function findGutter(runs: Run[]): number | null {
  const right = runs.reduce((value, run) => Math.max(value, run.x + run.width), -Infinity);
  const left = runs.reduce((value, run) => Math.min(value, run.x), Infinity);
  const spans = runs.map((r) => [r.x, r.x + r.width]).sort((a, b) => a[0] - b[0]);
  let reach = left;
  for (const [start, end] of spans) {
    const middle = (reach + start) / 2;
    const inRange = middle > left + (right - left) * 0.15 && middle < left + (right - left) * 0.6;
    if (start - reach >= MIN_GUTTER && inRange) {
      const share = runs.filter((r) => r.x < middle).length / runs.length;
      if (share > 0.15 && share < 0.85) return middle;
    }
    reach = Math.max(reach, end);
  }
  return null;
}

/** PDFs store text in paint order, which for browser-made ones isn't reading order. */
function readingOrder(runs: Run[]): string {
  if (!runs.length) return "";
  const gutter = findGutter(runs);
  if (gutter === null) return joinLines(runs);
  return [joinLines(runs.filter((r) => r.x < gutter)), joinLines(runs.filter((r) => r.x >= gutter))].join("\n");
}

/** Some fonts map common characters to Kangxi radicals, which look the same but don't compare equal. */
const RADICALS: Record<string, string> = {
  "⻘": "青", "⻓": "长", "⻔": "门", "⻛": "风", "⻜": "飞", "⻢": "马", "⻋": "车", "⻅": "见", "⻉": "贝",
  "⻚": "页", "⻥": "鱼", "⻬": "齐", "⻩": "黄", "⻄": "西", "⻝": "食", "⻮": "齿", "⻰": "龙",
};
const standardHan = (text: string) =>
  text.replace(/[\u2E80-\u2EFF\u2F00-\u2FDF]/g, (c) => RADICALS[c] ?? c.normalize("NFKC"));

async function pdfText(file: File, signal?: AbortSignal): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?raw"),
  ]);
  // A blob worker is what lets this run from a single local file.
  const data = await file.arrayBuffer();
  signal?.throwIfAborted();
  const workerUrl = URL.createObjectURL(new Blob([worker.default], { type: "text/javascript" }));
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let task: ReturnType<typeof pdfjs.getDocument> | undefined;
  let cancel = () => {};
  const aborted = new Promise<never>((_, reject) => { cancel = () => reject(signal?.reason); });
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    task = pdfjs.getDocument({ data });
    const readingTask = task;
    return await Promise.race([aborted, (async () => {
      const pdf = await readingTask.promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new AiError("PDF 超过 20 页，请只保留简历相关页面后重试。");
      const pages: string[] = [];
      let characters = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        signal?.throwIfAborted();
        const { items } = await (await pdf.getPage(n)).getTextContent();
        for (const item of items) {
          if ("str" in item) characters += item.str.length;
          if (characters > MAX_INPUT_CHARS) throw new AiError("文字超过 50000 字，请精简后重试。");
        }
        pages.push(readingOrder(items.flatMap((it) =>
          "str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }] : [])));
      }
      return pages.join("\n");
    })()]);
  } finally {
    signal?.removeEventListener("abort", cancel);
    try { await task?.destroy(); } finally { URL.revokeObjectURL(workerUrl); }
  }
}

async function docxText(file: File, signal?: AbortSignal): Promise<string> {
  const mammoth = (await import("mammoth/mammoth.browser")).default;
  const arrayBuffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  return (await mammoth.extractRawText({ arrayBuffer })).value;
}

export async function fileToText(file: File, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  checkFileSize(file);
  const name = file.name.toLowerCase();
  let text: string;
  try {
    if (name.endsWith(".pdf")) text = await pdfText(file, signal);
    else if (name.endsWith(".docx")) text = await docxText(file, signal);
    else if (name.endsWith(".txt") || name.endsWith(".md")) text = await file.text();
    else throw new AiError("目前支持 PDF、Word（.docx）和纯文本文件。");
  } catch (e) {
    signal?.throwIfAborted();
    if (e instanceof AiError) throw e;
    if (name.endsWith(".pdf")) {
      if (e instanceof Error && e.name === "PasswordException") throw new AiError("这是加密 PDF，请先解除密码保护后重试。");
      throw new AiError("PDF 损坏或格式不受支持，请重新导出 PDF，或复制全文粘贴。");
    }
    if (name.endsWith(".docx")) throw new AiError("Word 文件损坏、加密或格式不受支持，请另存为未加密的 .docx，或复制全文粘贴。");
    throw new AiError("这个文件读不出来，请重新保存为 UTF-8 文本，或复制全文粘贴。");
  }
  signal?.throwIfAborted();
  checkInputText(text);
  if (!text.trim()) throw new AiError(name.endsWith(".pdf")
    ? "PDF 没有可提取的文字，可能是扫描版。请先用文字识别工具转为可复制文字，再导入或粘贴。"
    : "文件中没有可用文字，请检查内容后重试。");
  return standardHan(text).trim();
}

export type PhotoCrop = { x: number; y: number; zoom: number };
export const DEFAULT_PHOTO_CROP: PhotoCrop = { x: 0.5, y: 0.5, zoom: 1 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Crop coordinates stay inside the source image at every zoom, without stretching its 5:7 ratio. */
export function photoCropRect(width: number, height: number, crop: PhotoCrop = DEFAULT_PHOTO_CROP) {
  const zoom = clamp(Number.isFinite(crop.zoom) ? crop.zoom : 1, 1, 3);
  const w = Math.min(width, height * 5 / 7) / zoom;
  const h = w * 7 / 5;
  return {
    x: clamp((Number.isFinite(crop.x) ? crop.x : 0.5) * width - w / 2, 0, width - w),
    y: clamp((Number.isFinite(crop.y) ? crop.y : 0.5) * height - h / 2, 0, height - h),
    width: w, height: h,
  };
}

/** The caller owns the bitmap and must close it when its preview is discarded. */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  checkFileSize(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AiError("这张图片打不开，请换一张。");
  });
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close();
    throw new AiError("图片超过 4000 万像素或尺寸无效，请缩小后重试。");
  }
  return bitmap;
}

/** Keep a small portrait for storage and export; changing its display shape never re-encodes it. */
export function cropPhoto(bitmap: ImageBitmap, crop: PhotoCrop = DEFAULT_PHOTO_CROP): string {
  try {
    const rect = photoCropRect(bitmap.width, bitmap.height, crop);
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 420;
    const context = canvas.getContext("2d");
    if (!context) throw new AiError("浏览器无法处理这张图片，请重试或换一张。");
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, 300, 420);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("这张图片处理失败，请换一张。");
  }
}

export async function photoDataUrl(file: File, crop: PhotoCrop = DEFAULT_PHOTO_CROP): Promise<string> {
  const bitmap = await decodePhoto(file);
  try { return cropPhoto(bitmap, crop); } finally { bitmap.close(); }
}

export function download(name: string, content: string, mime = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
