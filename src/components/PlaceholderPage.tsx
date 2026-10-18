import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Centered "coming soon" screen with a back button to the library. */
export function PlaceholderPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="bg-(--scrim-banner) shadow-pop flex max-w-full flex-col items-center gap-4 rounded-3xl border border-white/15 px-8 py-6 text-white backdrop-blur-md">
        <h1 className="font-title text-stroke text-4xl">{title}</h1>
        {children && <p className="text-lg text-white/90">{children}</p>}
        <Button
          asChild
          size="lg"
          className="btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
        >
          <Link to="/">
            <ArrowLeft aria-hidden />
            Zurück
          </Link>
        </Button>
      </div>
    </main>
  );
}
