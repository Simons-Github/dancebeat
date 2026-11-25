import { AnimatePresence, motion } from "framer-motion";

import type { Judgement } from "@/hooks/useScoring";
import { popupContent } from "@/lib/game/popup";
import { POPUP } from "@/theme";

/**
 * Large rating lettering that rises and fades. Keyed by the judgement id, so every move gets a
 * fresh popup. With reduced motion only the opacity changes (MotionConfig in AppShell).
 */
export function RatingPopup({ judgement }: { judgement: Judgement | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-[28%] flex justify-center"
    >
      <AnimatePresence>
        {judgement && (
          <motion.div
            key={judgement.id}
            initial={{ opacity: 0, y: 0, scale: 0.85 }}
            animate={{ opacity: [0, 1, 1, 0], y: `-${POPUP.riseVh}vh`, scale: 1 }}
            transition={{ duration: POPUP.seconds, times: [0, 0.15, 0.7, 1], ease: "easeOut" }}
            className="font-title text-stroke absolute text-6xl drop-shadow-[0_4px_0_rgb(0_0_0/45%)] landscape:text-5xl"
            style={{ color: popupContent(judgement).color }}
          >
            {popupContent(judgement).text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
