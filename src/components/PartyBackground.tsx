import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { MosaicStar } from "@/components/MosaicStar";
import { Sparkle } from "@/components/Sparkle";
import { BG_SHAPES, DEFAULT_MOTION_LEVEL, MOTION_PRESETS } from "@/theme";

/**
 * Decorative mosaic star and sparkles. They stand still or, as one group, drift very slowly. There
 * is one animation in total and no opacity change, so the menu stays calm.
 */
export function PartyBackground() {
  const reduce = useReducedMotion();
  const preset = MOTION_PRESETS[reduce ? "off" : DEFAULT_MOTION_LEVEL];
  const shapes = BG_SHAPES.map((s, i) => {
    const box: CSSProperties = {
      left: `${s.x}vw`,
      top: `${s.y}%`,
      width: `${s.size}vmax`,
      height: `${s.size}vmax`,
      opacity: s.opacity,
      transform: `rotate(${s.rotate}deg)`,
    };
    if (s.kind === "sparkle") return <Sparkle key={i} className="absolute" style={box} />;
    return <MosaicStar key={i} className="absolute" style={box} />;
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {preset.drift ? (
        <motion.div
          className="absolute inset-0"
          animate={{ y: ["0dvh", `${preset.vh}dvh`, "0dvh"] }}
          transition={{ duration: preset.seconds, ease: "easeInOut", repeat: Infinity }}
        >
          {shapes}
        </motion.div>
      ) : (
        shapes
      )}
    </div>
  );
}
