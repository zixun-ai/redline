import { useLanguage } from "@/lib/language";
import { inlineParts } from "../lib/inline";

export function RichText({ text, offset = 0 }: { text: string; offset?: number }) {
  const { t } = useLanguage();
  return <>{inlineParts(text, offset).map((part) => {
    const props = { "data-source-start": part.start, "data-source-end": part.end, className: part.bold ? "inline-bold" : undefined };
    if (part.placeholder) return <mark key={part.start} {...props} data-placeholder role="button" tabIndex={0} aria-label={t(`填写 ${part.text}`, `Fill in ${part.text}`)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>{part.text}</mark>;
    if (part.href) return <a key={part.start} {...props} href={part.href} target="_blank" rel="noopener noreferrer" title={t("按住 ⌘ 或 Ctrl 点击打开链接", "Hold ⌘ or Ctrl and click to open the link")}
      onClick={(event) => { if (event.detail !== 0 && !event.metaKey && !event.ctrlKey) event.preventDefault(); }}>{part.text}</a>;
    return <span key={part.start} {...props}>{part.text}</span>;
  })}</>;
}
