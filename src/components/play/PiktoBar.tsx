import type { Ref } from "react";

import { PIKTO } from "@/lib/game/pikto";
import { GAME } from "@/theme";

/**
 * Rounded, translucent bar with a triangle as target marker. Bar and marker are static DOM; the
 * pictograms are drawn on the canvas by the game loop.
 */
export function PiktoBar({
  canvasRef,
  goldSoon,
}: {
  canvasRef: Ref<HTMLCanvasElement>;
  goldSoon: boolean;
}) {
  return (
    <div className="relative">
      <div
        className="relative h-20 overflow-hidden rounded-full border border-white/30 backdrop-blur-sm landscape:h-16"
        style={{ background: GAME.piktoBar }}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
      </div>
      {/* Target marker: a small triangle under the bar. */}
      <div
        aria-hidden
        className="absolute -bottom-2.5 size-0 -translate-x-1/2 border-x-[10px] border-b-[12px] border-x-transparent border-b-white drop-shadow"
        style={{ left: `${PIKTO.markerX * 100}%` }}
      />
      {goldSoon && (
        <p className="font-title text-stroke absolute -bottom-9 right-4 text-xl text-gold">
          Gold Move
        </p>
      )}
    </div>
  );
}
