import { expect, it } from "vitest";
import { inlineParts, plainInline } from "./inline";

it("renders emphasis and safe links while preserving source offsets", () => {
  const raw = "负责**核心平台**，作品 https://example.com/a?q=b。联系 a+b@example.com";
  const parts = inlineParts(raw);
  expect(plainInline(raw)).toBe("负责核心平台，作品 https://example.com/a?q=b。联系 a+b@example.com");
  expect(parts.find((part) => part.bold)?.text).toBe("核心平台");
  expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual(["https://example.com/a?q=b", "mailto:a+b@example.com"]);
  for (const part of parts) expect(raw.slice(part.start, part.end)).toBe(part.text);
});

it("keeps placeholders intact, leaves unsafe URLs and HTML as plain text", () => {
  const parts = inlineParts("**[待填写：比例]** javascript:alert(1) <img src=x> https://user:pass@example.com");
  expect(parts.filter((part) => part.placeholder).map((part) => part.text)).toEqual(["[待填写：比例]"]);
  expect(parts.filter((part) => part.href)).toEqual([]);
  expect(plainInline("未闭合 **加粗\n以及*普通星号*")).toBe("未闭合 **加粗\n以及*普通星号*");
});

it("keeps punctuation outside links and handles astral characters in selections", () => {
  const raw = "😀 **工程师** https://example.com/end).";
  const parts = inlineParts(raw, 10);
  const bold = parts.find((part) => part.bold)!;
  expect(raw.slice(bold.start - 10, bold.end - 10)).toBe("工程师");
  expect(parts.find((part) => part.href)?.text).toBe("https://example.com/end");
  expect(plainInline(raw)).toBe("😀 工程师 https://example.com/end).");
});
