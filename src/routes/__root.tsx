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

function NotFoundComponent() {
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="bg-(--scrim-banner) shadow-pop flex max-w-full flex-col items-center gap-3 rounded-3xl border border-white/15 px-8 py-6 text-white backdrop-blur-md">
        <h1 className="font-title text-stroke text-7xl">404</h1>
        <h2 className="text-2xl font-bold">Seite nicht gefunden</h2>
        <p className="text-base text-white/90">
          Diese Seite gibt es nicht oder sie wurde verschoben.
        </p>
        <Button
          asChild
          size="lg"
          className="btn-pill mt-2 h-14 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold"
        >
          <Link to="/">Zur Startseite</Link>
        </Button>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="bg-party safe-pad flex h-dvh items-center justify-center">
      <div className="max-w-md text-center">
        <h1 className="font-title text-stroke text-2xl">Die Seite konnte nicht geladen werden</h1>
        <p className="mt-2 text-sm text-white/90">
          Etwas ist schiefgelaufen. Lade die Seite neu oder geh zurück zur Startseite.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-pill inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-base text-primary-foreground focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
          >
            Nochmal versuchen
          </button>
          <a
            href="/"
            className="btn-pill inline-flex h-12 items-center justify-center rounded-full bg-secondary px-6 text-base text-secondary-foreground focus-visible:ring-4 focus-visible:ring-gold focus-visible:outline-none"
          >
            Zur Startseite
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

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AppShell>
        <Outlet />
      </AppShell>
    </QueryClientProvider>
  );
}
