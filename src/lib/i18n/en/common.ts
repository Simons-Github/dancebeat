import type { deCommon } from "../de/common";

/** English UI strings; must have exactly the keys of the German file. */
export const enCommon = {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.back": "Back",
  "common.delete": "Delete",
  "common.ok": "OK",
  "common.language": "Language",
  "common.language.de": "Deutsch",
  "common.language.en": "English",
} as const satisfies Record<keyof typeof deCommon, string>;
