import { useMemo, useSyncExternalStore } from "react";

import { getSettings, subscribeSettings } from "../settings";
import { de } from "./de";
import { en } from "./en";

export type Language = "de" | "en";
export const LANGUAGES: readonly Language[] = ["de", "en"];
export type MessageKey = keyof typeof de;
export type Vars = Record<string, string | number>;

const DICTS: Record<Language, Record<MessageKey, string>> = { de, en };

/** Keys that come in `<base>_one` / `<base>_other` pairs, addressed by `tn(base, count)`. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer B}_one` ? B : never;
}[MessageKey];

const LOCALES: Record<Language, string> = { de: "de-DE", en: "en-US" };

/** Anything but "en" is German (matches the settings fallback). */
export function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "de";
}

/** Current UI language (reads the saved settings at call time; call inside functions only). */
export function getLanguage(): Language {
  return normalizeLanguage(getSettings().language);
}

/** BCP 47 locale for `toLocaleString` / `Intl` in the given (or current) language. */
export function localeOf(lang: Language = getLanguage()): string {
  return LOCALES[lang];
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined ? m : String(v);
  });
}

/** Translates `key` into `lang`; `{name}` placeholders are filled from `vars`. */
export function translate(lang: Language, key: MessageKey, vars?: Vars): string {
  const dict = DICTS[normalizeLanguage(lang)];
  return interpolate(dict[key] ?? de[key], vars);
}

/** Plural by count: picks `<base>_one` for 1, else `<base>_other`; `{count}` is filled in. */
export function translatePlural(lang: Language, base: PluralKey, count: number, vars?: Vars) {
  const key = `${base}_${count === 1 ? "one" : "other"}` as MessageKey;
  return translate(lang, key, { count, ...vars });
}

/** Plain translation in the current language. Use inside functions/handlers, not at module level. */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(getLanguage(), key, vars);
}

/** Plural variant of `t` (see `translatePlural`). */
export function tn(base: PluralKey, count: number, vars?: Vars): string {
  return translatePlural(getLanguage(), base, count, vars);
}

/** Current language, re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeSettings, getLanguage, () => "de" as const);
}

export interface Translator {
  (key: MessageKey, vars?: Vars): string;
  /** Plural variant: `tn("x.items", 3)` uses `x.items_other`. */
  tn: (base: PluralKey, count: number, vars?: Vars) => string;
  lang: Language;
  locale: string;
}

/** Hook: translator bound to the current language; components re-render on a language switch. */
export function useT(): Translator {
  const lang = useLanguage();
  return useMemo(() => {
    const fn = ((key: MessageKey, vars?: Vars) => translate(lang, key, vars)) as Translator;
    fn.tn = (base, count, vars) => translatePlural(lang, base, count, vars);
    fn.lang = lang;
    fn.locale = localeOf(lang);
    return fn;
  }, [lang]);
}
