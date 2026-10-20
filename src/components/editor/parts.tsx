import type { ReactNode } from "react";

/** Shared classes of the editor cards (same look as the sync test). */
export const CARD =
  "bg-(--scrim-banner) shadow-pop flex flex-col gap-4 rounded-3xl border border-white/15 p-5 text-white backdrop-blur-md";
export const BTN =
  "btn-pill h-12 gap-2 rounded-full px-6 text-base focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5";
export const HINT = "text-sm text-white/85";
export const ERROR =
  "rounded-xl bg-destructive px-3 py-2 text-base font-medium text-destructive-foreground";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD} aria-label={title}>
      <h2 className="font-title text-stroke text-2xl">{title}</h2>
      {children}
    </section>
  );
}
