import type { Design, Doc, Item, ListSection } from "./types";
import { uid } from "./nodes";
import { DESIGN_DEFAULTS } from "./design";
import { emptyBasics } from "./basics";

const item = (title: string, subtitle: string, period: string, bullets: string[]): Item => ({
  id: uid("it"), title, subtitle, period,
  bullets: bullets.map((text) => ({ id: uid("b"), text })),
});

const section = (kind: ListSection["kind"], title: string, items: Item[]): ListSection => ({ id: uid("s"), kind, title, items });

/** A fictional person. The bullets are deliberately weak, so there is something to circle. */
export const sampleDoc = (): Doc => ({
  design: DESIGN_DEFAULTS,
  resume: {
    basics: {
      ...emptyBasics(),
      name: "林知远", title: "产品经理", phone: "138-0000-0000",
      email: "zhiyuan@example.com", location: "上海",
      gender: "男", birth: "1995.08", ethnicity: "汉族", hometown: "浙江杭州", years: "5 年", availability: "一个月内",
    },
    summary: {
      id: uid("sum"),
      text: "五年 B 端产品经验，做过协同办公和客户管理产品，比较擅长需求分析和跨团队沟通，工作认真负责，学习能力强。",
    },
    sections: [
      section("experience", "工作经历", [
        item("青禾科技", "高级产品经理", "2022.03 — 至今", [
          "负责客户管理系统的产品工作，参与了很多需求的讨论和上线。",
          "和销售团队沟通，优化了线索分配流程，大家反馈不错。",
          "带着两位产品同事一起做权限系统重构，解决了客户投诉比较多的问题。",
        ]),
        item("远帆软件", "产品经理", "2019.07 — 2022.02", [
          "负责协同文档的评论和通知功能，日活有了比较明显的提升。",
          "做了用户访谈和数据分析，整理需求文档并推动研发排期。",
        ]),
      ]),
      section("project", "项目经历", [
        item("销售线索自动分配", "项目负责人", "2023.06 — 2023.12", [
          "根据地区和行业规则自动分配线索，把销售主管从手工分配中解放出来。",
          "协调销售、研发和数据团队，按时完成上线。",
        ]),
      ]),
      section("education", "教育经历", [
        item("华东师范大学", "信息管理与信息系统 · 本科", "2015.09 — 2019.06", []),
      ]),
      section("skill", "专业技能", [
        item("产品工具", "", "", ["Figma、Axure、SQL、Tableau"]),
        item("语言", "", "", ["英语 CET-6，可阅读英文技术文档"]),
      ]),
    ],
  },
});

const emptyItem = (): Item => item("", "", "", [""]);

export const blankDoc = (design: Design): Doc => ({
  design,
  resume: {
    basics: emptyBasics(),
    summary: { id: uid("sum"), text: "" },
    sections: [
      section("experience", "工作经历", [emptyItem()]),
      section("education", "教育经历", [item("", "", "", [])]),
      section("skill", "专业技能", [item("", "", "", [""])]),
    ],
  },
});
