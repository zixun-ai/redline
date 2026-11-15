import type { Align, Density, Design, Doc, FontId, HeadingStyle, LatinFontId, MarginSize, Section, SectionKind, TemplateId } from "./types";
import { normalizeBasics } from "./basics";

/** Ink blue rather than the interface's red, so on a new resume red only ever means a correction. */
export const DEFAULT_ACCENT = "#1F4E8C";

export const DESIGN_DEFAULTS: Design = {
  template: "qingjun", accent: DEFAULT_ACCENT, density: "normal", fontScale: 1,
  font: "auto", latin: "auto", heading: "line", margin: "normal",
  pageLimit: 1, language: "zh", photoShape: "square",
};

/** Documents saved before a setting existed get its default. */
export const normalizeDesign = (d: Partial<Design>): Design => ({ ...DESIGN_DEFAULTS, ...d });
export const normalizeDoc = (d: Doc): Doc => ({
  resume: { ...d.resume, basics: normalizeBasics(d.resume.basics) },
  design: normalizeDesign(d.design),
});

/** Every value a setting can take, with the name the interface shows. Storage and the model's replies are checked against these. */
type Template = {
  id: TemplateId; name: string; note: string; category: "简洁" | "正式" | "双栏" | "创意" | "侧重点";
  layout?: "sidebar-left" | "sidebar-right" | "columns" | "labels";
  font?: "serif" | "fang";
  priority?: SectionKind;
};
export const TEMPLATES: Template[] = [
  { id: "qingjun", name: "清隽", note: "黑体单栏，通用", category: "简洁" },
  { id: "shujuan", name: "书卷", note: "宋体居中，稳重", category: "正式", font: "serif" },
  { id: "fenlan", name: "分栏", note: "左栏放技能教育", category: "双栏", layout: "sidebar-left" },
  { id: "ats", name: "简素", note: "纯文字单栏，清晰易读", category: "简洁" },
  { id: "compact", name: "紧凑", note: "缩短段距，适合内容较多", category: "简洁" },
  { id: "classic", name: "经典", note: "衬线字体，居中双线", category: "正式", font: "serif" },
  { id: "executive", name: "商务", note: "宽标题，醒目的履历层次", category: "正式" },
  { id: "formal", name: "公文", note: "宋体正文，端正疏朗", category: "正式", font: "serif" },
  { id: "ledger", name: "左题", note: "模块名在左，履历在右", category: "正式", layout: "labels" },
  { id: "timeline", name: "时间线", note: "竖线串联每段经历", category: "正式" },
  { id: "sidebar-right", name: "右栏", note: "主履历在左，技能教育在右", category: "双栏", layout: "sidebar-right" },
  { id: "sidebar-clean", name: "简栏", note: "白底侧栏，细线分隔", category: "双栏", layout: "sidebar-left" },
  { id: "columns", name: "双列", note: "通栏页眉，下方两列模块", category: "双栏", layout: "columns" },
  { id: "banner", name: "横幅", note: "强调色页眉，鲜明开场", category: "创意" },
  { id: "rail", name: "侧线", note: "左侧色线，简明模块", category: "创意" },
  { id: "editorial", name: "刊物", note: "大字姓名，杂志式层次", category: "创意", font: "serif" },
  { id: "card", name: "卡片", note: "淡底模块，分组易读", category: "创意" },
  { id: "monogram", name: "印记", note: "姓名边框，居中留白", category: "创意" },
  { id: "campus", name: "校园", note: "教育优先，适合初次求职", category: "侧重点", priority: "education" },
  { id: "skills", name: "能力", note: "技能优先，突出能力组合", category: "侧重点", priority: "skill" },
  { id: "portfolio", name: "项目", note: "项目优先，展示实践成果", category: "侧重点", priority: "project" },
];

export const getTemplate = (id: TemplateId) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
export const templateSections = (sections: Section[], id: TemplateId): Section[] => {
  const priority = getTemplate(id).priority;
  return priority ? [...sections.filter((s) => s.kind === priority), ...sections.filter((s) => s.kind !== priority)] : sections;
};

export const DENSITIES: { id: Density; name: string }[] = [
  { id: "compact", name: "紧凑" }, { id: "normal", name: "标准" }, { id: "relaxed", name: "宽松" },
];

export const ALIGN_NAMES: Record<Align, string> = { left: "左对齐", center: "居中", right: "右对齐" };

export const ACCENTS: { name: string; hex: string }[] = [
  { name: "朱红", hex: "#B4351F" }, { name: "绯红", hex: "#A61E4D" }, { name: "赭石", hex: "#A8551C" }, { name: "土金", hex: "#8A6A12" },
  { name: "橄榄", hex: "#5F6B1E" }, { name: "松绿", hex: "#1F6B45" }, { name: "青碧", hex: "#1F6B5C" }, { name: "湖蓝", hex: "#0E6E8C" },
  { name: "藏蓝", hex: "#1F4E8C" }, { name: "靛青", hex: "#2F3E9E" }, { name: "紫藤", hex: "#5B3A9B" }, { name: "梅紫", hex: "#7D2A7A" },
  { name: "咖啡", hex: "#6B4A1F" }, { name: "岩灰", hex: "#4A5560" }, { name: "炭灰", hex: "#3A3A3A" }, { name: "墨黑", hex: "#222222" },
];

/** Only installed fonts, so the single file works offline and the PDF embeds what the page shows. */
export const FONTS: { id: FontId; name: string; note: string; families: string[] }[] = [
  { id: "auto", name: "跟随模板", note: "模板默认", families: [] },
  { id: "hei", name: "黑体", note: "清晰现代", families: ["PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC"] },
  { id: "song", name: "宋体", note: "正式稳重", families: ["Songti SC", "STSong", "SimSun", "Noto Serif SC", "Source Han Serif SC"] },
  { id: "kai", name: "楷体", note: "温和书卷", families: ["Kaiti SC", "STKaiti", "KaiTi"] },
  { id: "fang", name: "仿宋", note: "公文气质", families: ["STFangsong", "FangSong", "FangSong_GB2312"] },
  { id: "yuan", name: "圆体", note: "亲和轻松", families: ["Yuanti SC", "YouYuan"] },
];

export const LATIN_FONTS: { id: LatinFontId; name: string; families: string[] }[] = [
  { id: "auto", name: "跟随中文", families: [] },
  { id: "sans", name: "无衬线", families: ["Helvetica Neue", "Arial"] },
  { id: "serif", name: "衬线", families: ["Georgia", "Times New Roman"] },
  { id: "mono", name: "等宽", families: ["Menlo", "Consolas"] },
];

export const HEADINGS: { id: HeadingStyle; name: string }[] = [
  { id: "line", name: "下划线" }, { id: "block", name: "色块" }, { id: "bar", name: "竖条" }, { id: "plain", name: "纯文字" },
];

export const MARGINS: { id: MarginSize; name: string; mm: number }[] = [
  { id: "narrow", name: "窄", mm: 11 }, { id: "normal", name: "标准", mm: 16 }, { id: "wide", name: "宽", mm: 21 },
];

/** The ids each listed setting accepts. */
export const DESIGN_IDS = {
  template: TEMPLATES.map((t) => t.id), density: DENSITIES.map((d) => d.id), font: FONTS.map((f) => f.id),
  latin: LATIN_FONTS.map((f) => f.id), heading: HEADINGS.map((h) => h.id), margin: MARGINS.map((m) => m.id),
  pageLimit: [1, 2, 0], language: ["zh", "en"], photoShape: ["square", "rounded", "circle"],
} satisfies { [K in keyof Design]?: Design[K][] };
export const ALIGNS = Object.keys(ALIGN_NAMES) as Align[];
export const FONT_SCALE = { min: 0.9, max: 1.1 };

/** Spend excess spacing before reducing readable type size. */
export function nextCompactDesign(d: Design): Design | null {
  if (d.margin === "wide") return { ...d, margin: "normal" };
  if (d.density === "relaxed") return { ...d, density: "normal" };
  if (d.density === "normal") return { ...d, density: "compact" };
  if (d.margin === "normal") return { ...d, margin: "narrow" };
  return d.fontScale > FONT_SCALE.min ? { ...d, fontScale: Math.max(FONT_SCALE.min, +(d.fontScale - .01).toFixed(2)) } : null;
}

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

export function fontStack(d: Design): string | undefined {
  const font = FONTS.find((f) => f.id === d.font);
  const latin = LATIN_FONTS.find((f) => f.id === d.latin);
  const templateFont = getTemplate(d.template).font;
  const cjk = font?.families.length ? quoted(font.families) : templateFont === "fang" ? quoted(FONTS.find((f) => f.id === "fang")!.families) : templateFont === "serif" ? "var(--serif)" : "var(--sans)";
  if (latin?.families.length) return `${quoted(latin.families)}, ${cjk}`;
  return cjk;
}

const SAMPLE = "永简历Aa";

const installed = new Map<string, boolean>();

/** A browser falls back silently, so this compares widths against both generic families. The answer can't change
 * while the page is open, and the panel asks on every render, so each list is measured once. */
export function fontInstalled(families: string[]): boolean {
  if (!families.length) return true;
  const key = families.join(",");
  const known = installed.get(key);
  if (known !== undefined) return known;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const width = (family: string) => {
    ctx.font = `40px ${family}`;
    return ctx.measureText(SAMPLE).width;
  };
  const found = families.some((f) => ["monospace", "serif"].some((base) => width(`"${f}", ${base}`) !== width(base)));
  installed.set(key, found);
  return found;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast against white paper, per WCAG. */
export const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/** Text color for a filled heading. */
export const onAccent = (hex: string) => (contrastOnWhite(hex) >= 4.5 ? "#fff" : "#000");
