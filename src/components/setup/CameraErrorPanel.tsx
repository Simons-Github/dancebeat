import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CameraError } from "@/lib/cameraErrors";
import { useT } from "@/lib/i18n";

export function CameraErrorPanel({ error, onRetry }: { error: CameraError; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-xl font-bold text-white">
        <TriangleAlert aria-hidden className="size-6 shrink-0 text-amber-300" />
        {error.title}
      </h2>
      <p className="text-base text-white/90">{error.hint}</p>
      <Button
        size="lg"
        onClick={onRetry}
        className="btn-pill h-14 gap-2 self-start rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold [&_svg]:size-5"
      >
        <RefreshCw aria-hidden />
        {error.kind === "interrupted"
          ? t("settings.camera.retryRestart")
          : t("settings.camera.retry")}
      </Button>
    </div>
  );
}
