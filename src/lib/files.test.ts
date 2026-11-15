import { afterEach, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist";
import { fileToText, MAX_FILE_BYTES, MAX_PDF_PAGES, photoCropRect, photoDataUrl } from "./files";
import { MAX_INPUT_CHARS } from "./deepseek";

// The local single-file build can use PDF.js's main-thread fallback; control its task lifetime here.
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?raw", () => ({ default: "" }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function mockPdf(numPages: number, text = "简历正文") {
  const getPage = vi.fn(async () => ({ getTextContent: async () => ({ items: text ? [{ str: text, transform: [1, 0, 0, 1, 10, 10], width: 50 }] : [] }) }));
  const destroy = vi.fn(async () => {});
  vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ numPages, getPage }), destroy } as unknown as ReturnType<typeof getDocument>);
  return { getPage, destroy };
}

it("rejects oversized files before reading their contents", async () => {
  const file = new File(["简历"], "resume.txt");
  Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
  const read = vi.spyOn(file, "text");
  await expect(fileToText(file)).rejects.toThrow("文件超过 10 MB");
  expect(read).not.toHaveBeenCalled();
});

it("accepts the text limit and rejects text one character over it", async () => {
  await expect(fileToText(new File(["字".repeat(MAX_INPUT_CHARS)], "resume.txt"))).resolves.toHaveLength(MAX_INPUT_CHARS);
  await expect(fileToText(new File(["字".repeat(MAX_INPUT_CHARS + 1)], "resume.txt"))).rejects.toThrow("文字超过 50000 字");
});

it("rejects PDFs over the page limit before extracting any pages", async () => {
  const { getPage, destroy } = mockPdf(MAX_PDF_PAGES + 1);
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).rejects.toThrow("PDF 超过 20 页");
  expect(getPage).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
});

it("reads all pages at the page limit and normalizes font radicals", async () => {
  const { getPage } = mockPdf(MAX_PDF_PAGES, "⻓期项目");
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).resolves.toBe(Array(MAX_PDF_PAGES).fill("长期项目").join("\n"));
  expect(getPage).toHaveBeenCalledTimes(MAX_PDF_PAGES);
});

it("bounds text extraction before processing the next PDF page", async () => {
  const { getPage, destroy } = mockPdf(2, "字".repeat(MAX_INPUT_CHARS + 1));
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).rejects.toThrow("文字超过 50000 字");
  expect(getPage).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
});

it.each([
  ["PasswordException", "加密 PDF"],
  ["InvalidPDFException", "PDF 损坏"],
])("gives an actionable error for %s and frees the parser", async (name, message) => {
  const destroy = vi.fn(async () => {});
  vi.mocked(getDocument).mockImplementation(() => ({ promise: Promise.reject(Object.assign(new Error("Cannot open"), { name })), destroy }) as unknown as ReturnType<typeof getDocument>);
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).rejects.toThrow(message);
  expect(destroy).toHaveBeenCalledOnce();
});

it("releases the worker URL when parser creation itself fails", async () => {
  vi.mocked(getDocument).mockImplementation(() => { throw new Error("Invalid data"); });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).rejects.toThrow("PDF 损坏");
  expect(revoke).toHaveBeenCalledOnce();
});

it("distinguishes a PDF with no text layer from an empty text file", async () => {
  mockPdf(1, "");
  await expect(fileToText(new File(["pdf"], "resume.pdf"))).rejects.toThrow("可能是扫描版");
  await expect(fileToText(new File([" \n "], "resume.txt"))).rejects.toThrow("没有可用文字");
});

it("does not start reading an already cancelled file", async () => {
  const file = new File(["text"], "resume.txt");
  const read = vi.spyOn(file, "text");
  await expect(fileToText(file, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  expect(read).not.toHaveBeenCalled();
});

it.each([false, true])("cancelling a pending PDF destroys its task once and releases its URL (read settles: %s)", async (settles) => {
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_, no) => { reject = no; });
  const destroy = vi.fn(() => { if (settles) reject(new Error("Worker was destroyed")); return Promise.resolve(); });
  vi.mocked(getDocument).mockReturnValue({ promise, destroy } as unknown as ReturnType<typeof getDocument>);
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const controller = new AbortController();
  const pending = fileToText(new File(["pdf"], "resume.pdf"), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  expect(destroy).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledOnce();
});

it("rejects oversized photos before decoding", async () => {
  const decode = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  const file = new File(["image"], "photo.jpg");
  Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
  await expect(photoDataUrl(file)).rejects.toThrow("文件超过 10 MB");
  expect(decode).not.toHaveBeenCalled();
});

it.each(["success", "large", "no-canvas", "encode-error"])("closes the decoded photo after %s", async (outcome) => {
  const bitmap = { width: outcome === "large" ? 10_000 : 600, height: outcome === "large" ? 10_000 : 840, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  const canvas = {
    width: 0, height: 0,
    getContext: () => outcome === "no-canvas" ? null : { drawImage: vi.fn() },
    toDataURL: vi.fn(() => { if (outcome === "encode-error") throw new Error("Out of memory"); return "data:image/jpeg;base64,small"; }),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  const result = photoDataUrl(new File(["image"], "photo.jpg"));
  if (outcome === "success") {
    await expect(result).resolves.toBe("data:image/jpeg;base64,small");
    expect(canvas).toMatchObject({ width: 300, height: 420 });
  } else {
    await expect(result).rejects.toThrow(outcome === "large" ? "4000 万像素" : outcome === "no-canvas" ? "浏览器无法处理" : "图片处理失败");
  }
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it.each([[1200, 700], [500, 1400], [600, 840]])("keeps photo crop inside %s × %s at each zoom and edge", (width, height) => {
  for (const zoom of [1, 2, 3]) for (const x of [-10, 0, 0.5, 1, 10]) for (const y of [-10, 0, 0.5, 1, 10]) {
    const r = photoCropRect(width, height, { x, y, zoom });
    expect(r.width / r.height).toBeCloseTo(5 / 7);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width + 0.00001);
    expect(r.y + r.height).toBeLessThanOrEqual(height + 0.00001);
    expect(r.width).toBeCloseTo(Math.min(width, height * 5 / 7) / zoom);
  }
});

it("uses centered defaults and clamps unsupported zoom inputs", () => {
  expect(photoCropRect(1200, 700)).toEqual({ x: 350, y: 0, width: 500, height: 700 });
  expect(photoCropRect(1200, 700, { x: NaN, y: Infinity, zoom: NaN })).toEqual(photoCropRect(1200, 700));
  expect(photoCropRect(600, 840, { x: 0.5, y: 0.5, zoom: 100 })).toEqual(photoCropRect(600, 840, { x: 0.5, y: 0.5, zoom: 3 }));
});

it("encodes the selected source crop rather than recropping the center", async () => {
  const bitmap = { width: 1200, height: 700, close: vi.fn() };
  const drawImage = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage }), toDataURL: () => "data:image/jpeg;base64,cropped" }) });
  await photoDataUrl(new File(["image"], "photo.jpg"), { x: 1, y: 1, zoom: 2 });
  expect(drawImage).toHaveBeenCalledWith(bitmap, 950, 350, 250, 350, 0, 0, 300, 420);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
