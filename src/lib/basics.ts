/** Every personal-info field, in form and resume order. `line` is where it prints; `prefix` labels a value that is ambiguous on its own. */
export const BASICS = [
  { key: "name", label: "姓名", group: "身份" },
  { key: "title", label: "求职方向", group: "身份" },
  { key: "phone", label: "电话", group: "联系方式", line: "contact" },
  { key: "email", label: "邮箱", group: "联系方式", line: "contact" },
  { key: "wechat", label: "微信", group: "联系方式", line: "contact", prefix: "微信" },
  { key: "location", label: "现居城市", group: "联系方式", line: "contact" },
  { key: "website", label: "网站", group: "联系方式", line: "contact" },
  { key: "gender", label: "性别", group: "个人情况", line: "info", hint: "男 / 女" },
  { key: "birth", label: "出生年月", group: "个人情况", line: "info", prefix: "出生", hint: "1996.05" },
  { key: "ethnicity", label: "民族", group: "个人情况", line: "info", hint: "汉族" },
  { key: "hometown", label: "籍贯", group: "个人情况", line: "info", prefix: "籍贯", hint: "浙江杭州" },
  { key: "politics", label: "政治面貌", group: "个人情况", line: "info", hint: "中共党员 / 群众" },
  { key: "marital", label: "婚姻状况", group: "个人情况", line: "info", hint: "未婚 / 已婚" },
  { key: "years", label: "工作年限", group: "求职意向", line: "info", prefix: "工作年限", hint: "5 年" },
  { key: "salary", label: "期望薪资", group: "求职意向", line: "info", prefix: "期望薪资", hint: "25-30K" },
  { key: "availability", label: "到岗时间", group: "求职意向", line: "info", prefix: "到岗", hint: "一个月内" },
] as const satisfies readonly { key: string; label: string; group: string; line?: "contact" | "info"; prefix?: string; hint?: string }[];

export type BasicsKey = (typeof BASICS)[number]["key"];
export type Basics = Record<BasicsKey, string>;

export const ENGLISH_BASICS: Record<BasicsKey, string> = {
  name: "Name", title: "Role", phone: "Phone", email: "Email", wechat: "WeChat", location: "Location", website: "Website",
  gender: "Gender", birth: "Born", ethnicity: "Ethnicity", hometown: "Hometown", politics: "Affiliation", marital: "Marital status",
  years: "Experience", salary: "Expected salary", availability: "Availability",
};

export const BASICS_KEYS = BASICS.map((f) => f.key) as BasicsKey[];
/** Saves and model replies from before the other fields existed only carry these. */
export const FIRST_KEYS: BasicsKey[] = ["name", "title", "phone", "email", "location", "website"];

export const emptyBasics = (): Basics => Object.fromEntries(BASICS_KEYS.map((k) => [k, ""])) as Basics;
export const normalizeBasics = (b: Partial<Basics>): Basics => ({ ...emptyBasics(), ...b });

/** What one resume line shows, each value with its prefix. */
export const basicsLine = (b: Basics, line: "contact" | "info", language: "zh" | "en" = "zh"): string[] =>
  BASICS.filter((f) => "line" in f && f.line === line && b[f.key]?.trim())
    .map((f) => ("prefix" in f ? `${language === "en" ? ENGLISH_BASICS[f.key] : f.prefix} ${b[f.key].trim()}` : b[f.key].trim()));
