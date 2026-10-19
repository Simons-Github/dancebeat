import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameController, type GameDeps, type GameState } from "@/lib/game/controller";
import { MotionMeter, motionScoring } from "@/lib/motion";
import { Scorer } from "@/lib/scorer";
import { makeChoreo } from "./fixtures";

/** Audio fake: time only advances while playing, driven by `advance`. */
function fakeAudio() {
  const a = {
    pos: 0,
    playing: false,
    refuse: false,
    play: vi.fn(async () => {
      if (a.refuse) throw new DOMException("no gesture", "NotAllowedError");
      a.playing = true;
    }),
    pause: vi.fn(() => {
      a.playing = false;
    }),
    seek: vi.fn((ms: number) => {
      a.pos = ms;
    }),
  };
  return a;
}

function setup(over: Partial<GameDeps> = {}) {
  const audio = fakeAudio();
  const states: GameState[] = [];
  const scoring = {
    sample: vi.fn(),
    seekTo: vi.fn(),
    reset: vi.fn(),
    done: vi.fn(() => false),
  };
  const onEnd = vi.fn();
  const onBeep = vi.fn();
  const offset = { ms: 0 };
  const ctl = new GameController({
    audio,
    timeMs: () => audio.pos - offset.ms,
    scoring,
    startOffsetMs: 0,
    endMs: 10_000,
    onState: (s) => states.push(s),
    onEnd,
    onBeep,
    ...over,
  });
  /** Advances fake timers and the audio position (if playing), ticking like rAF every 16 ms. */
  const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      const step = Math.min(16, ms - t);
      await vi.advanceTimersByTimeAsync(step);
      if (audio.playing) audio.pos += step;
      ctl.tick();
    }
  };
  return { ctl, audio, scoring, states, onEnd, onBeep, advance, offset };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Countdown und Start", () => {
  it("Vorlauf, dann 3-2-1 im Sekundentakt, dann läuft die Musik", async () => {
    const { ctl, audio, onBeep, advance } = setup();
    ctl.start();
    expect(ctl.state).toMatchObject({ phase: "countdown", count: 0 });
    await advance(1990);
    expect(ctl.state.count).toBe(0);
    await advance(20);
    expect(ctl.state.count).toBe(3);
    await advance(1000);
    expect(ctl.state.count).toBe(2);
    await advance(1000);
    expect(ctl.state.count).toBe(1);
    expect(audio.play).not.toHaveBeenCalled();
    await advance(1000);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(ctl.state.phase).toBe("playing");
    expect(onBeep.mock.calls.map((c) => c[0])).toEqual([3, 2, 1, 0]);
  });

  it("Start setzt auf startOffsetMs, setzt die Wertung zurück und überspringt das Intro", () => {
    const { ctl, audio, scoring } = setup({ startOffsetMs: 4200 });
    ctl.start();
    expect(audio.seek).toHaveBeenCalledWith(4200);
    expect(scoring.reset).toHaveBeenCalled();
    expect(scoring.seekTo).toHaveBeenCalledWith(4200);
  });

  it("Abbrechen im Countdown: kein Start, keine Musik", async () => {
    const { ctl, audio, advance } = setup();
    ctl.start();
    await advance(2500);
    ctl.cancel();
    expect(ctl.state.phase).toBe("preparing");
    await advance(5000);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("verweigertes play(): „blocked“, der Tipp startet die Musik", async () => {
    const { ctl, audio, advance } = setup();
    audio.refuse = true;
    ctl.start();
    await advance(5100);
    expect(ctl.state.phase).toBe("blocked");
    audio.refuse = false;
    ctl.tap();
    await advance(16);
    expect(ctl.state.phase).toBe("playing");
  });
});

describe("Pause und Wiederaufnahme", () => {
  async function playing() {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    expect(env.ctl.state.phase).toBe("playing");
    return env;
  }

  it("Pause hält Musik und Wertung an, Weiter zählt 3-2-1 und spielt an derselben Stelle weiter", async () => {
    const { ctl, audio, scoring, advance } = await playing();
    await advance(1000);
    ctl.pause("user");
    expect(ctl.state).toMatchObject({ phase: "paused", pauseReason: "user" });
    expect(audio.pause).toHaveBeenCalled();
    const pos = audio.pos;
    const samples = scoring.sample.mock.calls.length;
    await advance(3000);
    expect(audio.pos).toBe(pos);
    expect(scoring.sample.mock.calls.length).toBe(samples);
    ctl.resume();
    expect(ctl.state.count).toBe(3); // no lead-in on resume
    await advance(3000);
    expect(ctl.state.phase).toBe("playing");
    expect(audio.seek).toHaveBeenCalledTimes(1); // only the start, no jump on resume
  });

  it("Pause im Countdown stoppt ihn sauber; Weiter zählt neu", async () => {
    const { ctl, audio, advance } = setup();
    ctl.start();
    await advance(2500);
    ctl.pause("hidden");
    expect(ctl.state).toMatchObject({ phase: "paused", count: null });
    await advance(10_000);
    expect(audio.play).not.toHaveBeenCalled();
    ctl.resume();
    await advance(3000);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("Pause während play() noch läuft: die Musik bleibt aus", async () => {
    const env = setup();
    let release = () => {};
    env.audio.play.mockImplementationOnce(
      () => new Promise<void>((r) => (release = () => ((env.audio.playing = true), r()))),
    );
    env.ctl.start();
    await env.advance(5000);
    env.ctl.pause("user");
    release();
    await env.advance(16);
    expect(env.ctl.state.phase).toBe("paused");
    expect(env.audio.playing).toBe(false);
  });

  it("Neustart: zurück an den Anfang, Wertung zurückgesetzt, Countdown mit Vorlauf", async () => {
    const { ctl, audio, scoring, advance } = await playing();
    await advance(2000);
    ctl.pause("user");
    ctl.restart();
    expect(audio.seek).toHaveBeenLastCalledWith(0);
    expect(scoring.reset).toHaveBeenCalledTimes(2);
    expect(ctl.state).toMatchObject({ phase: "countdown", count: 0 });
  });
});

describe("Bewertungsschleife", () => {
  it("ordnet Winkel dem Aufnahmezeitpunkt zu (Bildalter abgezogen)", async () => {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    env.audio.pos = 3000;
    env.ctl.pushFrame({ leftShoulder: 90 }, 80);
    env.ctl.tick();
    expect(env.scoring.sample).toHaveBeenLastCalledWith(2920, { leftShoulder: 90 });
  });

  it("Bildalter wird mit der Wiedergabegeschwindigkeit in Songzeit umgerechnet", async () => {
    const env = setup({ rate: 1.25 });
    env.ctl.start();
    await env.advance(5100);
    env.audio.pos = 3000;
    env.ctl.pushFrame(null, 80);
    env.ctl.tick();
    expect(env.scoring.sample).toHaveBeenLastCalledWith(2900, null);
  });

  it("wertet höchstens alle 100 ms Spielzeit", async () => {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    env.scoring.sample.mockClear();
    for (let i = 0; i < 30; i++) {
      env.ctl.pushFrame({ leftShoulder: 10 }, 0);
      await env.advance(33);
    }
    const n = env.scoring.sample.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(11);
  });

  it("Körper dauerhaft nicht sichtbar: Hinweis statt stiller X", async () => {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    for (let i = 0; i < 60; i++) {
      env.ctl.pushFrame(null, 0);
      await env.advance(50);
    }
    expect(env.ctl.state.bodyMissing).toBe(true);
    env.ctl.pushFrame({ leftShoulder: 20, rightShoulder: 20 }, 0);
    await env.advance(16);
    expect(env.ctl.state.bodyMissing).toBe(false);
  });

  it("ohne Kamerabilder schließt die Uhr die Fenster weiter (keine hängende Wertung)", async () => {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    await env.advance(1000);
    expect(env.scoring.sample).toHaveBeenCalledWith(expect.any(Number), null);
  });

  it("Ende: nach dem letzten Move und dem Nachlauf, Wertung abgeschlossen", async () => {
    const env = setup({ endMs: 3000 });
    env.scoring.done.mockReturnValue(true);
    env.ctl.start();
    await env.advance(5100);
    await env.advance(3100);
    expect(env.ctl.state.phase).toBe("ended");
    expect(env.onEnd).toHaveBeenCalledTimes(1);
    expect(env.audio.playing).toBe(false);
  });

  it("finish() bei Audio-Ende wertet offene Moves und meldet das Ende nur einmal", async () => {
    const env = setup();
    env.ctl.start();
    await env.advance(5100);
    env.ctl.finish();
    env.ctl.finish();
    expect(env.scoring.sample).toHaveBeenLastCalledWith(10_000, null);
    expect(env.onEnd).toHaveBeenCalledTimes(1);
  });

  it("mit echtem Scorer: Fake-Spieler perfekt, alle Moves PERFECT", async () => {
    const c = makeChoreo([
      { la: 90, ra: 90 },
      { la: 170, ra: 170 },
      { la: 20, ra: 160 },
    ]);
    const choreo = { ...c, moves: c.moves.map((m, i) => ({ ...m, timeMs: 1000 + i * 1000 })) };
    choreo.frames = choreo.frames.map((f, i) => ({ ...f, timeMs: 1000 + i * 1000 }));
    const scorer = new Scorer(choreo);
    const env = setup({ scoring: scorer, endMs: 4000 });
    env.ctl.start();
    await env.advance(5000); // lead + countdown, audio starts at 0
    for (let t = 0; t < 4200; t += 33) {
      const target = choreo.frames.find((f) => Math.abs(f.timeMs - env.audio.pos) < 250);
      env.ctl.pushFrame(target ? target.angles : null, 0);
      await env.advance(33);
    }
    expect(scorer.snapshot().counts.PERFECT).toBe(3);
    expect(env.onEnd).toHaveBeenCalled();
  });

  it("dispose räumt Timer auf", async () => {
    const env = setup();
    env.ctl.start();
    env.ctl.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await env.advance(6000);
    expect(env.audio.play).not.toHaveBeenCalled();
  });
});

describe("Blocked: doppelter Tipp und Start von außen", () => {
  /** Start refused once ("blocked"); later play() calls wait until `release()`. */
  async function blocked() {
    const env = setup();
    env.audio.refuse = true;
    env.ctl.start();
    await env.advance(5100);
    expect(env.ctl.state.phase).toBe("blocked");
    env.audio.refuse = false;
    const releases: (() => void)[] = [];
    env.audio.play.mockImplementation(
      () =>
        new Promise<void>((r) =>
          releases.push(() => {
            env.audio.playing = true;
            r();
          }),
        ),
    );
    env.audio.play.mockClear();
    env.audio.pause.mockClear();
    const release = () => releases.forEach((f) => f());
    return { ...env, release };
  }

  it("zwei tap() auf ein langsames play() → ein Aufruf, kein pause(), Phase playing", async () => {
    const { ctl, audio, advance, release } = await blocked();
    ctl.tap();
    ctl.tap();
    await advance(500);
    ctl.tap();
    expect(audio.play).toHaveBeenCalledTimes(1);
    release();
    await advance(16);
    expect(ctl.state.phase).toBe("playing");
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.playing).toBe(true);
  });

  it("nach einem abgelehnten tap()-play() darf der nächste Tipp wieder starten", async () => {
    const { ctl, audio, advance } = await blocked();
    audio.play.mockImplementationOnce(async () => {
      throw new DOMException("no gesture", "NotAllowedError");
    });
    ctl.tap();
    await advance(16);
    expect(ctl.state.phase).toBe("blocked");
    audio.play.mockImplementationOnce(async () => {
      audio.playing = true;
    });
    ctl.tap();
    await advance(16);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(ctl.state.phase).toBe("playing");
  });

  it("Pause während ausstehendem play() → paused, späte Auflösung verworfen", async () => {
    const { ctl, audio, advance, release } = await blocked();
    ctl.tap();
    ctl.pause("user");
    expect(ctl.state.phase).toBe("paused");
    release();
    await advance(16);
    expect(ctl.state.phase).toBe("paused");
    expect(audio.playing).toBe(false);
  });

  it("externalStart in blocked → playing, ohne play() und pause()", async () => {
    const { ctl, audio, advance } = await blocked();
    audio.playing = true; // YouTube started by itself
    ctl.externalStart();
    expect(ctl.state).toMatchObject({ phase: "playing", count: null, bodyMissing: false });
    await advance(100);
    expect(ctl.state.phase).toBe("playing");
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it("externalStart in anderen Phasen wird ignoriert", async () => {
    const env = setup();
    env.ctl.externalStart();
    expect(env.ctl.state.phase).toBe("preparing");
    env.ctl.start();
    env.ctl.externalStart();
    expect(env.ctl.state.phase).toBe("countdown");
    await env.advance(5100);
    expect(env.ctl.state.phase).toBe("playing");
    env.ctl.pause("user");
    env.ctl.externalStart();
    expect(env.ctl.state.phase).toBe("paused");
    env.ctl.restart();
    await env.advance(5100);
    env.ctl.finish();
    env.ctl.externalStart();
    expect(env.ctl.state.phase).toBe("ended");
    expect(env.audio.play).toHaveBeenCalledTimes(2);
  });

  it("externalStart während ein tap()-play() aussteht, das danach auflöst → bleibt playing, kein pause()", async () => {
    const { ctl, audio, advance, release } = await blocked();
    ctl.tap();
    audio.playing = true;
    ctl.externalStart();
    expect(ctl.state.phase).toBe("playing");
    release();
    await advance(16);
    expect(ctl.state.phase).toBe("playing");
    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.playing).toBe(true);
    // The superseded play() no longer blocks a later tap (not that one is needed now).
    ctl.tap();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("externalStart, dann ein später abgelehntes tap()-play() → bleibt playing", async () => {
    const { ctl, audio, advance } = await blocked();
    let fail = (_e: Error) => {};
    audio.play.mockImplementationOnce(() => new Promise<void>((_, rej) => (fail = rej)));
    ctl.tap();
    ctl.externalStart();
    fail(new Error("Wiedergabe angehalten."));
    await advance(16);
    expect(ctl.state.phase).toBe("playing");
    expect(audio.pause).not.toHaveBeenCalled();
  });
});

describe("Bewegungsmodus", () => {
  function motionDeps() {
    const motion = { rating: vi.fn(() => "SUPER" as const), lastSampleMs: vi.fn(() => -Infinity) };
    return motion;
  }

  it("wertet nur über die Uhr, höchstens alle 100 ms, mit motion.rating", async () => {
    const motion = motionDeps();
    const env = setup({ motion });
    env.ctl.start();
    await env.advance(5100);
    env.scoring.sample.mockClear();
    await env.advance(1000);
    const calls = env.scoring.sample.mock.calls as unknown[][];
    expect(calls.length).toBeGreaterThanOrEqual(9);
    expect(calls.length).toBeLessThanOrEqual(11);
    for (const c of calls) {
      expect(c[1]).toBeNull();
      expect(typeof c[2]).toBe("function");
    }
    // No stall path: every sample is at the current game time, not now - stallMs.
    expect(calls.at(-1)?.[0]).toBeGreaterThan(env.audio.pos - 100);
  });

  it("Kamerabilder werden ignoriert", async () => {
    const env = setup({ motion: motionDeps() });
    env.ctl.start();
    await env.advance(5100);
    env.audio.pos = 3000;
    env.ctl.pushFrame({ leftShoulder: 90 }, 80);
    env.scoring.sample.mockClear();
    env.ctl.tick();
    expect(env.scoring.sample).not.toHaveBeenCalledWith(2920, { leftShoulder: 90 });
  });

  it("Hinweis ohne Sensormessung, weg sobald Messungen kommen", async () => {
    const motion = motionDeps();
    const env = setup({ motion });
    env.ctl.start();
    await env.advance(5100);
    await env.advance(2000);
    expect(env.ctl.state.bodyMissing).toBe(false); // grace period after the start
    await env.advance(1000);
    expect(env.ctl.state.bodyMissing).toBe(true);
    motion.lastSampleMs.mockImplementation(() => env.audio.pos);
    await env.advance(16);
    expect(env.ctl.state.bodyMissing).toBe(false);
  });

  it("finish() bewertet offene Moves über motion.rating", async () => {
    const env = setup({ motion: motionDeps() });
    env.ctl.start();
    await env.advance(5100);
    env.ctl.finish();
    expect(env.scoring.sample).toHaveBeenLastCalledWith(10_000, null, expect.any(Function));
  });

  it("mit echtem Scorer und MotionMeter: Bewegung um die Moves ergibt Urteile, Ruhe ergibt X", async () => {
    const c = makeChoreo([
      { la: 90, ra: 90 },
      { la: 170, ra: 170 },
      { la: 20, ra: 160 },
    ]);
    const choreo = { ...c, moves: c.moves.map((m, i) => ({ ...m, timeMs: 1000 + i * 1000 })) };
    const scorer = new Scorer(choreo);
    const meter = new MotionMeter();
    const env = setup({
      scoring: scorer,
      endMs: 4000,
      motion: motionScoring(meter, () => "normal"),
    });
    env.ctl.start();
    await env.advance(5000);
    for (let t = 0; t < 4200; t += 16) {
      const pos = env.audio.pos;
      // Strong movement around the first two moves, nothing around the third.
      if (pos < 2400) meter.push(pos, { linear: { x: 8, y: 0, z: 0 }, withGravity: null });
      await env.advance(16);
    }
    const snap = scorer.snapshot();
    expect(snap.counts.PERFECT).toBe(2);
    expect(snap.counts.X).toBe(1);
    expect(env.onEnd).toHaveBeenCalled();
  });
});
