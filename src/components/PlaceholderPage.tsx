import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/** Centered "coming soon" screen with a back button to the library. */
export function PlaceholderPage({ title, children }: { title: string; children?: ReactNode }) {
  const t = useT();
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="glass flex max-w-full flex-col items-center gap-4 rounded-3xl px-8 py-6 text-white">
        <h1 className="font-title text-4xl">{title}</h1>
        {children && <p className="text-lg text-white/90">{children}</p>}
        <Button
          asChild
          size="lg"
          className="btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
        >
          <Link to="/">
            <ArrowLeft aria-hidden />
            {t("common.back")}
          </Link>
        </Button>
      </div>
    </main>
  );
}
