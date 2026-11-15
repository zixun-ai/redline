import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "redline.interfaceLanguage";

const Language = createContext({
  english: false,
  t: (zh: string, _en: string) => zh,
  toggle: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [english, setEnglish] = useState(() => {
    try { return localStorage.getItem(KEY) === "en"; }
    catch { return false; }
  });

  useEffect(() => {
    document.documentElement.lang = english ? "en" : "zh-CN";
    try { localStorage.setItem(KEY, english ? "en" : "zh-CN"); }
    catch { /* The switch still works when browser storage is unavailable. */ }
  }, [english]);

  return <Language.Provider value={{
    english,
    t: (zh, en) => english ? en : zh,
    toggle: () => setEnglish(value => !value),
  }}>{children}</Language.Provider>;
}

export function useLanguage() {
  return useContext(Language);
}
