import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useLanguage, useT } from "@/lib/i18n";

function NotFoundComponent() {
  const t = useT();
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="glass flex max-w-full flex-col items-center gap-3 rounded-3xl px-8 py-6 text-white">
        <h1 className="font-title text-7xl">404</h1>
        <h2 className="text-2xl font-bold">{t("shell.notFound.title")}</h2>
        <p className="text-base text-white/90">{t("shell.notFound.body")}</p>
        <Button
          asChild
          size="lg"
          className="btn-pill mt-2 h-14 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold"
        >
          <Link to="/">{t("shell.home")}</Link>
        </Button>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const t = useT();

  return (
    <div className="bg-party safe-pad flex h-dvh items-center justify-center">
      <div className="max-w-md text-center">
        <h1 className="font-title text-3xl text-paper">{t("shell.error.title")}</h1>
        <p className="mt-2 text-xl font-bold text-paper">{t("shell.error.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-pill inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-base text-primary-foreground focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
          >
            {t("shell.error.retry")}
          </button>
          <a
            href="/"
            className="btn-pill inline-flex h-12 items-center justify-center rounded-full bg-secondary px-6 text-base text-secondary-foreground focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
          >
            {t("shell.home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const lang = useLanguage();
  // Keep <html lang> in step with the UI language (screen readers, hyphenation).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AppShell>
        <Outlet />
      </AppShell>
    </QueryClientProvider>
  );
}
