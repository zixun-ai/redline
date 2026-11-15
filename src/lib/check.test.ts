import { describe, expect, it } from "vitest";
import { unsupportedClaims } from "./check";
import { sampleDoc } from "./sample";
import { safeJobProposals } from "./threads";
import type { ListSection, Thread } from "./types";

describe("organization claims", () => {
  it.each([
    "跨部门推动公司级项目落地",
    "服务头部银行客户",
    "对接多家大型商业银行",
    "参与公司内部流程优化",
    "负责集团级平台建设",
    "为所在公司提供支持",
    "与合作银行沟通",
    "服务银行客户",
    "支持大学和学院的教学工作",
    "对接国内研究所",
    "与某研究院合作",
    "加入一家互联网公司",
    "为分公司提供技术支持",
  ])("does not label a generic organization as a new named institution: %s", (next) => {
    expect(unsupportedClaims(next, "参与项目工作并与相关人员沟通")).toEqual([]);
  });

  it.each([
    ["毕业于清华大学", "清华大学"],
    ["服务中国工商银行客户", "中国工商银行"],
    ["对接星河科技有限公司", "星河科技有限公司"],
    ["入职星河科技有限责任公司", "星河科技有限责任公司"],
    ["参与北京银行项目", "北京银行"],
    ["服务中国银行客户", "中国银行"],
    ["服务建设银行客户", "建设银行"],
    ["入职中国银行股份有限公司", "中国银行股份有限公司"],
    ["毕业于中国科学院大学", "中国科学院大学"],
    ["与星河研究院合作", "星河研究院"],
    ["与某具体公司合作", "某具体公司"],
  ])("still flags a previously absent institution: %s", (next, organization) => {
    expect(unsupportedClaims(next, "参与项目工作")).toEqual([organization]);
  });

  it.each([
    ["曾就读于清华大学", "毕业于清华大学"],
    ["服务中国工商银行客户", "曾为中国工商银行提供技术支持"],
    ["对接星河科技有限公司", "任职于星河科技有限公司"],
    ["跨部门推动星河科技有限公司项目落地", "供职于星河科技有限公司"],
    ["在星河研究院参与项目", "与星河研究院合作"],
  ])("recognizes an existing name despite a changed verb prefix: %s", (next, source) => {
    expect(unsupportedClaims(next, source)).toEqual([]);
  });

  it("checks each specific name independently when a sentence also has generic organizations", () => {
    expect(unsupportedClaims("服务头部银行，与清华大学和中国工商银行合作", "与清华大学合作"))
      .toEqual(["中国工商银行"]);
  });

  it("does not use a shorter parent organization as evidence for a different full name", () => {
    expect(unsupportedClaims("毕业于中国科学院大学", "曾在中国科学院参与项目"))
      .toEqual(["中国科学院大学"]);
  });

  it("does not relax number, role or placeholder checks for generic organizations", () => {
    expect(unsupportedClaims("主导公司级项目，服务头部银行，提升5%", "参与公司级项目，5年工作经验"))
      .toEqual(["5%", "主导"]);
    expect(unsupportedClaims("毕业于清华大学", "[待填写：是否毕业于清华大学]"))
      .toEqual(["清华大学"]);
  });

  it("does not block an otherwise eligible job suggestion solely for the word 公司级", () => {
    const doc = sampleDoc();
    const target = (doc.resume.sections[0] as ListSection).items[0].bullets[0];
    target.text = "和多个部门沟通，推进项目落地。";
    const after = { text: "跨部门推动公司级项目落地" };
    const unsupported = unsupportedClaims(after.text, target.text);
    const thread: Thread = {
      id: "thread", jobId: "job", targetId: target.id, label: "工作经历", resolved: false,
      messages: [{ id: "message", role: "ai", fromJd: true, text: "建议修改", at: 1, proposal: {
        id: "proposal", kind: "content", status: "pending", targetId: target.id, type: "bullet", why: "精简表述",
        before: JSON.stringify({ text: target.text }), after, unsupported,
      } }],
    };
    expect(safeJobProposals(doc, [thread], { id: "job", summary: "当前岗位", missing: [] }).map((p) => p.messageId))
      .toEqual(["message"]);
  });
});
