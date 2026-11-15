import type { Resume } from "./types";
import { resumeText } from "./nodes";

const NUMBER = /\d+(?:[.,]\d+)*\s*(?:%|％|(?:万|亿|千)?(?:美元|欧元|港元|元|倍|人|个|次|名|家|项|款|年|月|天|小时|分钟|秒)|万|亿|千|ms\b|[kKwW]\b)?/g;
const TERM = /[A-Za-z][A-Za-z0-9+#._-]*/g;
const PLACEHOLDER = /\[待填写[^\]]*\]/g;
/** Words that raise someone's role. "参与" becoming "主导" adds no number, so it needs its own check. */
const ESCALATION = ["主导", "牵头", "带领", "领导", "带队", "独立完成", "独立负责", "全面负责", "一手", "创立", "创始", "负责人", "总监", "首席", "从0到1", "从零到一"];
/** Strip only common sentence prefixes, not arbitrary text up to a character inside a name. */
const LEAD_IN = /^(?:(?:曾经?|先后|目前|现|跨部门|跨团队|并|及|和|与|为|在|向)|(?:任职|就职|供职|毕业|就读|入职|加入|服务|对接|协助|支持|推动|推进|联系|面向|负责|参与|主导|牵头|带领)(?:于|了)?)+/;
// Stop at each name, retaining suffix chains such as 中国科学院大学 and 星河集团有限公司.
const ORGANIZATION = /[\u4e00-\u9fa5]{1,30}?(?:公司|集团|大学|学院|银行|研究院|研究所)(?:(?:股份有限|有限责任|有限)?公司|集团|大学|学院)*/g;
/** Whole generic descriptions, not a suffix allowlist: 中国银行 and 清华大学 remain specific names. */
const GENERIC_ORGANIZATION = /^(?:(?:本|该|某|所在|相关|其他|各类|多家|一家|某家|各家|多所|一所|某所|各所|国内外|国内|国外|海外|行业|业内|头部|大型|中型|小型|大中型|中小型|中小|国有|民营|公立|私立|商业|股份制|城市商业|农村商业|互联网|科技|金融|上市|母|子|分|总|合作|客户|集团|有限责任|股份有限|有限)(?:的)?)*(?:公司|集团|大学|学院|银行|研究院|研究所)$/;

// Units carry meaning: five years of experience cannot establish a five-percent improvement.
const quantity = (s: string) => s.replace(/[\s,]/g, "").replace(/％/g, "%").toLowerCase();

function factsOf(text: string) {
  return {
    numbers: new Set((text.match(NUMBER) ?? []).map(quantity)),
    terms: new Set((text.match(TERM) ?? []).map((t) => t.toLowerCase())),
  };
}

/**
 * Finds numbers, Latin terms, role-raising words and organizations in `next` that `source` doesn't
 * contain. It is a net, not proof: an invented claim in ordinary Chinese can still pass.
 */
export function unsupportedClaims(next: string, source: string): string[] {
  const clean = next.replace(PLACEHOLDER, "");
  const evidence = source.replace(PLACEHOLDER, "");
  const known = factsOf(evidence);
  const found = new Set<string>();
  for (const m of clean.match(NUMBER) ?? []) if (!known.numbers.has(quantity(m))) found.add(m.trim());
  for (const t of clean.match(TERM) ?? []) {
    if (t.length >= 2 && !known.terms.has(t.toLowerCase())) found.add(t);
  }
  for (const word of ESCALATION) if (clean.includes(word) && !evidence.includes(word)) found.add(word);
  for (const match of clean.match(ORGANIZATION) ?? []) {
    const org = match.replace(LEAD_IN, "");
    if (!GENERIC_ORGANIZATION.test(org) && !evidence.includes(org)) found.add(org);
  }
  return [...found];
}

/** Every `[待填写…]` left in the resume; export is blocked until they are gone. */
export const placeholders = (r: Resume): string[] => resumeText(r).match(PLACEHOLDER) ?? [];

export type ExportIssue = { targetId: string; text: string };
export function exportIssues(r: Resume, overflow: number, pageLimit = 1, t = (zh: string, _en: string) => zh): ExportIssue[] {
  const issues: ExportIssue[] = [];
  if (!r.basics.name.trim()) issues.push({ targetId: "basics", text: t("姓名为空，请填写姓名", "Enter your name.") });
  const check = (targetId: string, text: string) => {
    for (const token of text.match(PLACEHOLDER) ?? []) issues.push({ targetId, text: token });
  };
  check("basics", Object.values(r.basics).join("\n"));
  check(r.summary.id, r.summary.text);
  for (const section of r.sections) {
    check(section.id, section.title);
    if (section.kind === "text") {
      check(section.body.id, section.body.text);
      continue;
    }
    for (const item of section.items) {
      check(item.id, [item.title, item.subtitle, item.period].join("\n"));
      for (const bullet of item.bullets) check(bullet.id, bullet.text);
    }
  }
  if (overflow > 0 && pageLimit !== 0) issues.push({ targetId: r.sections.at(-1)?.id ?? r.summary.id, text: t(
    `内容超出${pageLimit === 1 ? "一" : pageLimit}页约 ${overflow} 行，请精简内容、压缩版式或在版式面板允许更多页`,
    `The resume is about ${overflow} ${overflow === 1 ? "line" : "lines"} over the page limit. Shorten the content, tighten the layout, or allow more pages in Layout.`,
  ) });
  return issues;
}
