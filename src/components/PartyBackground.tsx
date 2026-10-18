import { motion, useReducedMotion } from "framer-motion";

import { BG_SHAPES, DEFAULT_MOTION_LEVEL, MOTION_PRESETS } from "@/theme";

/**
 * Decorative triangles and circles. They stand still or, as one group, drift very slowly. There is
 * one animation in total and no opacity change, so the menu stays calm.
 */
export function PartyBackground() {
  const reduce = useReducedMotion();
  const preset = MOTION_PRESETS[reduce ? "off" : DEFAULT_MOTION_LEVEL];
  const shapes = BG_SHAPES.map((s, i) => (
    <div
      key={i}
      className="absolute"
      style={{
        left: `${s.x}vw`,
        top: `${s.y}%`,
        width: `${s.size}vmax`,
        height: `${s.size}vmax`,
        opacity: s.opacity,
        backgroundColor: s.tint === "white" ? "white" : "var(--song-2)",
        clipPath: s.kind === "triangle" ? "polygon(50% 0, 100% 100%, 0 100%)" : undefined,
        borderRadius: s.kind === "circle" ? "9999px" : undefined,
      }}
    />
  ));
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
