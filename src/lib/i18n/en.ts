import { enCommon } from "./en/common";
import { enEditor } from "./en/editor";
import { enSettings } from "./en/settings";
import { enShell } from "./en/shell";
import { enSongs } from "./en/songs";
import type { de } from "./de";

/** English dictionary; a missing or extra key fails the typecheck. */
export const en = {
  ...enCommon,
  ...enShell,
  ...enSettings,
  ...enSongs,
  ...enEditor,
} satisfies Record<keyof typeof de, string>;
