import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import es from "./es";
import en from "./en";
import ru from "./ru";
import type { Strings } from "./es";

export type Lang = "es" | "en" | "ru";

export const dictionaries: Record<Lang, Strings> = { es, en, ru };
export const languages: Lang[] = ["es", "en", "ru"];

const STORAGE_KEY = "litomask.lang";

function detectLang(): Lang {
    try {
        const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
        if (saved && languages.includes(saved)) return saved;
    } catch { /* storage unavailable */ }
    const nav = (typeof navigator !== "undefined" ? navigator.language : "es").toLowerCase();
    if (nav.startsWith("ru")) return "ru";
    if (nav.startsWith("en")) return "en";
    return "es";
}

interface I18nContextValue {
    lang: Lang;
    t: Strings;
    setLang: (l: Lang) => void;
}

const I18nContext = createContext<I18nContextValue>({ lang: "es", t: es, setLang: () => { } });

export function I18nProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>(detectLang);
    const setLang = (l: Lang) => {
        setLangState(l);
        try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    };
    useEffect(() => { document.documentElement.lang = lang; }, [lang]);
    const value = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    return useContext(I18nContext);
}

/** Map internal error codes thrown by the core to translated messages. */
export function translateError(e: unknown, t: Strings): string {
    const msg = String((e as Error)?.message ?? e);
    if (msg === "IMAGE_LOAD") return t.errImageLoad;
    return msg;
}
