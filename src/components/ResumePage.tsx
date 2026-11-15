import { memo, type CSSProperties, type ReactNode } from "react";
import type { Design, Item, ListSection, Resume, Section } from "../lib/types";
import { subtitleId, titleId } from "../lib/nodes";
import { basicsLine } from "../lib/basics";
import { MARGINS, fontStack, getTemplate, normalizeDesign, onAccent, templateSections } from "../lib/design";
import { RichText } from "./RichText";

const DENSITY = { compact: 0.72, normal: 1, relaxed: 1.3 };

function Contact({ resume, language, stacked }: { resume: Resume; language: Design["language"]; stacked?: boolean }) {
  return <>{(["contact", "info"] as const).map((line) => {
    const parts = basicsLine(resume.basics, line, language);
    if (!parts.length) return null;
    if (stacked) return <ul key={line} className={`contact-list ${line}`}>{parts.map((p, i) => <li key={i}><RichText text={p} /></li>)}</ul>;
    return <p key={line} className={`contact ${line}`}>{parts.map((p, i) => <span key={i}>{i > 0 && <i>·</i>}<RichText text={p} /></span>)}</p>;
  })}</>;
}

type Styles = Resume["nodeStyles"];

/** Props for a component's own formatting. */
function look(styles: Styles, id: string, base = "") {
  const s = styles?.[id];
  const className = [base, s?.align && `nd-${s.align}`, s?.bold && "nd-bold", s?.color && "nd-color"].filter(Boolean).join(" ") || undefined;
  const style = s?.italic || s?.color
    ? { fontStyle: s.italic ? "italic" : undefined, "--nd-color": s.color || undefined } as CSSProperties
    : undefined;
  return { className, style };
}

function ItemBlock({ item, kind, styles }: { item: Item; kind: ListSection["kind"]; styles: Styles }) {
  if (kind === "skill") {
    // Its bullets are inline, so their alignment has to be carried by the row.
    const align = styles?.[item.id]?.align ?? item.bullets.map((b) => styles?.[b.id]?.align).find(Boolean);
    const row = look(styles, item.id, `skill${align ? ` nd-${align}` : ""}`);
    return (
      <div {...row} data-node={item.id}>
        {item.title && <b data-node={titleId(item.id)} {...look(styles, titleId(item.id))}><RichText text={item.title} /></b>}
        {item.bullets.map((b) => <span key={b.id} data-node={b.id} {...look(styles, b.id)}><RichText text={b.text} /></span>)}
      </div>
    );
  }
  const subId = subtitleId(item.id);
  const subAlign = styles?.[subId]?.align;
  const head = look(styles, item.id, `item-head${subAlign && subAlign !== "left" ? ` sub-${subAlign}` : ""}`);
  return (
    <div className="item" data-node={item.id}>
      <div {...head}>
        <strong data-node={titleId(item.id)} {...look(styles, titleId(item.id))}><RichText text={item.title} /></strong>
        {item.subtitle && <span data-node={subId} {...look(styles, subId, "sub")}><RichText text={item.subtitle} /></span>}
        <time><RichText text={item.period} /></time>
      </div>
      {item.bullets.length > 0 && (
        <ul>{item.bullets.map((b) => <li key={b.id} data-node={b.id} {...look(styles, b.id)}><RichText text={b.text} /></li>)}</ul>
      )}
    </div>
  );
}

function SectionBlock({ section, styles }: { section: Section; styles: Styles }) {
  let offset = 0;
  return (
    <section className="sec" data-node={section.id} data-kind={section.kind}>
      <h2 {...look(styles, section.id)}><RichText text={section.title} /></h2>
      {section.kind === "text"
        ? section.body.text && (
          <div data-node={section.body.id} {...look(styles, section.body.id, "passage")}>
            {section.body.text.split("\n").map((line, i) => { const start = offset; offset += line.length + 1; return <p key={i}><RichText text={line} offset={start} /></p>; })}
          </div>
        )
        : section.items.map((it) => <ItemBlock key={it.id} item={it} kind={section.kind} styles={styles} />)}
    </section>
  );
}

function Photo({ resume }: { resume: Resume }) {
  return resume.photo ? <img className="photo" src={resume.photo} alt="" /> : null;
}

function Summary({ resume }: { resume: Resume }) {
  if (!resume.summary.text) return null;
  return <p data-node={resume.summary.id} {...look(resume.nodeStyles, resume.summary.id, "summary")}><RichText text={resume.summary.text} /></p>;
}

function Body({ resume, design }: { resume: Resume; design: Design }): ReactNode {
  const { name, title } = resume.basics;
  const { layout } = getTemplate(design.template);
  const sections = templateSections(resume.sections, design.template);
  if (layout === "sidebar-left" || layout === "sidebar-right") {
    const isSide = (s: Section) => (resume.sectionPlacement?.[s.id] ?? (s.kind === "skill" || s.kind === "education" ? "side" : "main")) === "side";
    const side = resume.sections.filter(isSide);
    const main = resume.sections.filter((s) => !isSide(s));
    const sidebar = <aside>
          <div data-node="basics" {...look(resume.nodeStyles, "basics", "side-basics")}>
            <Photo resume={resume} />
            <h1><RichText text={name} /></h1>
            <p className="role"><RichText text={title} /></p>
            <Contact resume={resume} language={design.language} stacked />
          </div>
          {side.map((s) => <SectionBlock key={s.id} section={s} styles={resume.nodeStyles} />)}
        </aside>;
    const content = <main>
          <Summary resume={resume} />
          {main.map((s) => <SectionBlock key={s.id} section={s} styles={resume.nodeStyles} />)}
        </main>;
    return <div className="split">{layout === "sidebar-right" ? <>{content}{sidebar}</> : <>{sidebar}{content}</>}</div>;
  }
  return (
    <>
      <header data-node="basics" {...look(resume.nodeStyles, "basics")}>
        <Photo resume={resume} />
        <h1><RichText text={name} /></h1>
        <p className="role"><RichText text={title} /></p>
        <Contact resume={resume} language={design.language} />
      </header>
      <Summary resume={resume} />
      {layout === "columns"
        ? <div className="section-grid">{sections.map((s) => <SectionBlock key={s.id} section={s} styles={resume.nodeStyles} />)}</div>
        : sections.map((s) => <SectionBlock key={s.id} section={s} styles={resume.nodeStyles} />)}
    </>
  );
}

export const ResumePage = memo(function ResumePage({ resume, design: raw }: { resume: Resume; design: Design }) {
  const design = normalizeDesign(raw);
  const template = getTemplate(design.template);
  const vars = {
    "--accent": design.accent,
    "--on-accent": onAccent(design.accent),
    "--fs": `${10 * design.fontScale}pt`,
    "--gap": DENSITY[design.density] * (design.template === "compact" ? .8 : 1),
    "--mx": `${MARGINS.find((m) => m.id === design.margin)?.mm ?? 16}mm`,
    fontFamily: fontStack(design),
  } as CSSProperties;
  return (
    <article lang={design.language === "en" ? "en" : "zh-CN"} className={`resume t-${design.template} h-${design.heading} photo-${design.photoShape}${design.pageLimit !== 1 ? " multipage" : ""}${template.layout?.startsWith("sidebar") ? " layout-sidebar" : ""}${design.font === "fang" || design.font === "auto" && template.font === "fang" ? " font-fang" : ""}`} style={vars}>
      <Body resume={resume} design={design} />
    </article>
  );
});
