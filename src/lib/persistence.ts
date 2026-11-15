import type { Doc, JobTarget, Thread, Version } from "./types";
import { isDoc, isJob, isThread, isThreads, isVersions } from "./storage";
import { normalizeDoc } from "./design";
import { sampleDoc } from "./sample";

export type EditorState = { doc: Doc; threads: Thread[]; versions: Version[]; job: JobTarget | null };
const keys = ["doc", "threads", "versions", "job"] as const;
const validators = { doc: isDoc, threads: isThreads, versions: isVersions, job: isJob };
type Recovery = Record<string, unknown>;

export function recoverState(raw: Partial<Record<keyof EditorState, unknown>>) {
  const state: EditorState = { doc: sampleDoc(), threads: [], versions: [], job: null };
  const invalid: Recovery = {};
  for (const key of keys) {
    const value = raw[key];
    if (value === undefined) continue;
    if (validators[key](value)) Object.assign(state, { [key]: value });
    else {
      invalid[key] = value;
      if (key === "threads" && Array.isArray(value)) state.threads = value.filter(isThread);
    }
  }
  state.doc = normalizeDoc(state.doc);
  return { state, invalid };
}

/** The browser commits all changed records together, or keeps the last complete save. */
export async function openEditorStore({ temporary = false } = {}) {
  let sourceUnavailable = false;
  const unavailable = (error: unknown) => {
    if (!temporary) throw error;
    sourceUnavailable = true;
    return null;
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("redline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("editor");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他 Redline 页面后重试。"));
  }).catch(unavailable);
  try {
    const records = (db && await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction("editor", "readonly");
      const result: Record<string, unknown> = {};
      for (const key of [...keys, "recovery"]) {
        const request = tx.objectStore("editor").get(key);
        request.onsuccess = () => { result[key] = request.result; };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
    }).catch(unavailable)) ?? {};
    const migrated = records.doc === undefined;
    const legacy: Record<string, string> = {};
    if (migrated) for (const key of keys) {
      const name = `redline.${key}.v1`;
      try {
        const raw = localStorage.getItem(name);
        if (raw !== null) {
          legacy[name] = raw;
          try { records[key] = JSON.parse(raw); } catch { records[key] = raw; }
        }
        const invalid = localStorage.getItem(`${name}.invalid`);
        if (invalid !== null) legacy[`${name}.invalid`] = invalid;
      } catch (error) {
        unavailable(error);
      }
    }
    const { state, invalid } = recoverState(records);
    const recovery: Recovery = { ...(records.recovery as Recovery ?? {}), ...invalid };
    for (const [key, value] of Object.entries(legacy)) if (key.endsWith(".invalid")) recovery[key] = value;
    let persisted: Partial<EditorState> = !migrated && keys.every(key => validators[key](records[key])) ? state : {};
    let queue = Promise.resolve();
    const save = (next: EditorState) => {
      // Without an exclusive lock, this page can only keep its own editable copy.
      if (temporary) return Promise.resolve();
      queue = queue.catch(() => {}).then(() => new Promise<void>((resolve, reject) => {
        const changed = keys.filter(key => persisted[key] !== next[key]);
        if (!changed.length) { resolve(); return; }
        const tx = db!.transaction("editor", "readwrite", { durability: "strict" });
        tx.oncomplete = () => {
          persisted = next;
          // Remove old copies only after a successful transaction, including a retried migration.
          for (const [key, value] of Object.entries(legacy)) {
            try {
              if (localStorage.getItem(key) === value) localStorage.removeItem(key);
              delete legacy[key];
            } catch { /* Keep the original if browser storage is unavailable. */ }
          }
          resolve();
        };
        tx.onabort = () => reject(tx.error ?? new Error("保存事务已取消"));
        try {
          const store = tx.objectStore("editor");
          for (const key of changed) store.put(next[key], key);
          if (!persisted.doc && Object.keys(recovery).length) store.put(recovery, "recovery");
        } catch (error) { tx.abort(); reject(error); }
      }));
      return queue;
    };
    let failed = false;
    try { await save(state); } catch { failed = true; }
    return { state, recovery, failed, temporary, sourceUnavailable, save, close: () => db?.close() };
  } catch (error) { db?.close(); throw error; }
}

export type EditorStore = Awaited<ReturnType<typeof openEditorStore>>;
