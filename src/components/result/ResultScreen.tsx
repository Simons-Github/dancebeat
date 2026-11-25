import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Home, RotateCcw, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChromeStar } from "@/components/Y2KIcons";
import { localeOf, useT, type MessageKey } from "@/lib/i18n";
import { rankTitle } from "@/lib/scoring";
import type { GameResult, Rating } from "@/lib/types";
import { CONFETTI, GOLD, RATING_COLORS, RESULT, SCRIM, SPRING } from "@/theme";

const RATINGS: Rating[] = ["PERFECT", "SUPER", "GOOD", "OK", "X"];
/** Spoken names where the short label would be unclear. */
const SPOKEN: Partial<Record<Rating, MessageKey>> = { X: "shell.result.missed" };
const BTN =
  "btn-pill h-14 gap-2 rounded-full px-8 text-lg focus-visible:ring-4 focus-visible:ring-gold landscape:h-12 landscape:px-6 [&_svg]:size-5";

const fmt = (n: number) => Math.round(n).toLocaleString(localeOf());

/**
 * Final result: rank, score counting up, stars popping in one by one, ratings, longest combo and
 * a "new highscore" badge. 5 stars or megastar add one burst of confetti. With reduced motion
 * everything is shown at once and there is no confetti.
 */
export function ResultScreen({ result: r }: { result: GameResult }) {
  const t = useT();
  const reduce = useReducedMotion() ?? false;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Cue for screen readers (and keyboard users) after the route change from the game.
  useEffect(() => headingRef.current?.focus(), []);
  const party = !reduce && (r.stars >= 5 || r.mega);
  const starsLabel = r.mega ? t("shell.result.mega") : t("shell.stars.label", { count: r.stars });
  return (
    <main className="safe-pad flex min-h-0 flex-1 flex-col items-center justify-center">
      {party && <Confetti />}
      <div className="glass flex max-h-full w-full max-w-md flex-col items-center gap-4 overflow-y-auto rounded-3xl px-6 py-5 text-center text-white landscape:grid landscape:max-w-3xl landscape:grid-cols-2 landscape:items-center landscape:gap-x-8 landscape:gap-y-3">
        <section className="flex flex-col items-center gap-3" aria-label={t("shell.result.score")}>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="font-title text-4xl outline-none landscape:text-3xl"
          >
            {rankTitle(r.stars, r.mega)}
          </h1>
          <p className="font-title chrome-text chrome-glow pb-[0.1em] text-7xl leading-none tabular-nums landscape:text-6xl">
            <span className="sr-only" data-testid="result-score">
              {t("shell.result.points", { score: fmt(r.score) })}
            </span>
            <ScoreCounter score={r.score} reduce={reduce} />
          </p>
          <div role="img" aria-label={starsLabel} className="flex items-center gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <PopStar key={i} index={i} on={i < r.stars} reduce={reduce} />
            ))}
            <PopStar index={5} on={r.mega} reduce={reduce} mega />
          </div>
          {r.newHighscore && (
            <motion.p
              data-testid="new-highscore"
              className="flex items-center gap-2 rounded-full px-4 py-1 text-lg font-bold"
              style={{ background: GOLD, color: SCRIM.ink }}
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...SPRING, delay: reduce ? 0 : RESULT.countUpSeconds }}
            >
              <Trophy aria-hidden className="size-5" />
              {t("shell.result.newHighscore")}
            </motion.p>
          )}
        </section>
        <section
          className="flex flex-col items-center gap-4"
          aria-label={t("shell.result.details")}
        >
          <dl className="grid w-full grid-cols-5 gap-2 text-base">
            {RATINGS.map((k) => {
              const spoken = SPOKEN[k];
              return (
                <div key={k} className="flex min-w-0 flex-col">
                  <dt className="flex flex-col items-center gap-1 text-xs font-bold">
                    <span
                      aria-hidden
                      className="h-1.5 w-full max-w-10 rounded-full"
                      style={{ background: RATING_COLORS[k] }}
                    />
                    {spoken ? (
                      <>
                        <span aria-hidden>{k}</span>
                        <span className="sr-only">{t(spoken)}</span>
                      </>
                    ) : (
                      k
                    )}
                  </dt>
                  <dd className="text-xl font-bold tabular-nums">{r.counts[k]}</dd>
                </div>
              );
            })}
          </dl>
          <p className="text-lg">
            {t("shell.result.maxCombo")}{" "}
            <span className="font-bold tabular-nums">{r.maxCombo}</span>
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className={BTN}>
              <Link to="/setup/$songId" params={{ songId: r.songId }}>
                <RotateCcw aria-hidden />
                {t("shell.result.again")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary" className={BTN}>
              <Link to="/">
                <Home aria-hidden />
                {t("shell.result.other")}
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Counts from 0 to the score on a motion value (no React render per frame). */
function ScoreCounter({ score, reduce }: { score: number; reduce: boolean }) {
  const value = useMotionValue(reduce ? score : 0);
  const text = useTransform(value, fmt);
  useEffect(() => {
    if (reduce) {
      value.set(score);
      return;
    }
    const controls = animate(value, score, {
      duration: RESULT.countUpSeconds,
      ease: RESULT.countUpEase,
    });
    return () => controls.stop();
  }, [value, score, reduce]);
  return (
    <motion.span aria-hidden data-testid="result-score-visual">
      {text}
    </motion.span>
  );
}

function PopStar({
  index,
  on,
  reduce,
  mega = false,
}: {
  index: number;
  on: boolean;
  reduce: boolean;
  mega?: boolean;
}) {
  return (
    <motion.span
      aria-hidden
      className={mega ? "ml-2" : undefined}
      initial={reduce ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        ...SPRING,
        delay: reduce ? 0 : RESULT.starDelaySeconds + index * RESULT.starStaggerSeconds,
      }}
    >
      <span data-on={on} className="block">
        <ChromeStar
          variant={on ? (mega ? "gold" : "chrome") : "off"}
          className={mega ? "size-12 landscape:size-10" : "size-9 landscape:size-8"}
        />
      </span>
    </motion.span>
  );
}

/** Deterministic pseudo-random number in [0, 1) per piece (keeps render pure). */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** One burst of falling DOM pieces; decorative only. */
function Confetti() {
  return (
    <div
      aria-hidden
      data-testid="confetti"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {Array.from({ length: CONFETTI.count }, (_, i) => {
        const color = CONFETTI.colors[i % CONFETTI.colors.length];
        const drift = (rand(i, 3) - 0.5) * CONFETTI.driftVw;
        return (
          <motion.span
            key={i}
            className="absolute top-0 block rounded-sm"
            style={{
              left: `${rand(i, 1) * 100}%`,
              width: CONFETTI.sizePx,
              height: CONFETTI.sizePx * (CONFETTI.minAspect + rand(i, 2)),
              background: color,
            }}
            initial={{ y: `${CONFETTI.startVh}vh`, x: 0, rotate: 0 }}
            animate={{
              y: `${CONFETTI.endVh}vh`,
              x: `${drift}vw`,
              rotate: 360 * (1 + rand(i, 4) * (CONFETTI.maxTurns - 1)),
            }}
            transition={{
              duration: CONFETTI.fallSeconds * (1 + (rand(i, 5) - 0.5) * CONFETTI.durationJitter),
              delay: rand(i, 6) * CONFETTI.delaySpreadSeconds,
              ease: CONFETTI.ease,
            }}
          />
        );
      })}
    </div>
  );
}
