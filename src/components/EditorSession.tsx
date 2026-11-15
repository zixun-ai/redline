import { useLanguage } from "@/lib/language";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { openEditorStore, type EditorStore } from "../lib/persistence";

/** Only a page holding the browser's lock can write the saved document. */
export function EditorSession({ children }: { children: (store: EditorStore) => ReactNode }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"opening" | "editing" | "blocked" | "unavailable">("opening");
  const [store, setStore] = useState<EditorStore | null>(null);
  useEffect(() => {
    let disposed = false;
    let release = () => {};
    const edit = async (temporary = false) => {
      const opened = await openEditorStore({ temporary });
      if (disposed) { opened.close(); return; }
      setStore(opened);
      await new Promise<void>((resolve) => { release = resolve; setStatus("editing"); });
      opened.close();
    };
    const start = async () => {
      try {
        if (!navigator.locks) { await edit(true); return; }
        await navigator.locks.request("redline.editor", { ifAvailable: true }, async (lock) => {
          if (disposed) return;
          if (!lock) { setStatus("blocked"); return; }
          await edit();
        });
      } catch {
        if (disposed) return;
        try { await edit(true); } catch { if (!disposed) setStatus("unavailable"); }
      }
    };
    void start();
    return () => { disposed = true; release(); };
  }, []);

  if (status === "editing" && store) {
    if (!store.temporary) return children(store);
    return (
      <div className="flex h-full min-h-0 flex-col print:block print:h-auto">
        <div className="chrome shrink-0 border-b px-4 py-2 text-sm" role="status" data-editor-session="temporary"
          style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
          {t("临时会话：浏览器无法保护独占保存。可继续编辑，修改只留在本页；关闭前请到「版本」下载备份。", "Temporary session. Changes stay on this page because the browser cannot lock the saved résumé. Download a backup from Versions before you close this page.")}
          {store.sourceUnavailable && <p>{t("部分本机数据无法读取。请先核对内容，或导入已有备份。", "Some saved data could not be read. Check the résumé or restore a backup.")}</p>}
        </div>
        <div className="min-h-0 flex-1 print:block">{children(store)}</div>
      </div>
    );
  }
  return (
    <main data-editor-status={status} className="mx-auto mt-24 max-w-md space-y-4 p-6">
      <p role="status">{status === "opening" ? t("正在打开简历…", "Opening résumé…")
        : status === "blocked" ? t("简历已在另一个标签页打开。请先关闭原来的编辑页，再重新打开。", "The résumé is open in another tab. Close that editor tab, then reopen the résumé here.")
          : t("浏览器无法保护简历的保存。请使用 Chrome 打开，并允许本地存储。", "The browser cannot protect your saved résumé. Open Redline in Chrome and allow local storage.")}</p>
      {status !== "opening" && <Button onClick={() => location.reload()}>{t("重新打开", "Reopen")}</Button>}
    </main>
  );
}
