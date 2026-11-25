import { deCommon } from "./de/common";
import { deEditor } from "./de/editor";
import { deSettings } from "./de/settings";
import { deShell } from "./de/shell";
import { deSongs } from "./de/songs";

/** German dictionary = source of truth for all UI strings (keys are namespaced per area). */
export const de = { ...deCommon, ...deShell, ...deSettings, ...deSongs, ...deEditor };
