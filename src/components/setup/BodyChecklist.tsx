import { Circle, CircleCheck, TriangleAlert } from "lucide-react";

import type { StatusRow } from "@/lib/bodyTracker";
import { useT, type MessageKey } from "@/lib/i18n";

const ICON = {
  ok: { Icon: CircleCheck, text: "settings.body.state.ok", className: "text-emerald-300" },
  warn: { Icon: TriangleAlert, text: "settings.body.state.warn", className: "text-amber-300" },
  pending: { Icon: Circle, text: "settings.body.state.pending", className: "text-white/70" },
} as const satisfies Record<string, { Icon: unknown; text: MessageKey; className: string }>;

/** Status lines with icon and text, so state never depends on color alone. */
export function BodyChecklist({ rows }: { rows: StatusRow[] }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const { Icon, text, className } = ICON[row.state];
        return (
          <li key={row.id} className="flex items-center gap-2 text-base font-medium text-white">
            <Icon aria-hidden className={`size-5 shrink-0 ${className}`} />
            <span>{row.label}</span>
            <span className="sr-only">: {t(text)}</span>
          </li>
        );
      })}
    </ul>
  );
}
