import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useVideoAnalysis,
  type VideoAnalysisHookOptions,
  type VideoAnalysisState,
} from "@/hooks/useVideoAnalysis";
import type { PoseModel } from "@/lib/mediapipe";
import { fakeEstimator, FakeVideo, type FakeEstimator } from "./videoAnalysisFakes";

type Api = ReturnType<typeof useVideoAnalysis>;

let renders = 0;

function Probe(props: VideoAnalysisHookOptions & { onApi: (api: Api) => void }) {
  renders++;
  const { onApi, ...opts } = props;
  onApi(useVideoAnalysis(opts));
  return null;
}

function setup(estimators: FakeEstimator[]) {
  let api: Api | null = null;
  const models: PoseModel[] = [];
  const queue = [...estimators];
  const createEstimator = vi.fn((m: PoseModel) => {
    models.push(m);
    const e = queue.shift();
    if (!e) throw new Error("no estimator left");
    return e;
  });
  const states: VideoAnalysisState[] = [];
  renders = 0;
  const view = render(
    <StrictMode>
      <Probe
        createEstimator={createEstimator}
        onApi={(a) => {
          api = a;
          if (states.at(-1) !== a.state) states.push(a.state);
        }}
      />
    </StrictMode>,
  );
  const get = () => {
    if (!api) throw new Error("not rendered");
    return api;
  };
  return { get, states, models, view, createEstimator };
}

/** Lets the fake video's seek timers run. */
const settle = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("useVideoAnalysis", () => {
  it("läuft idle → loading → running → done und gibt das Modell frei", async () => {
    const est = fakeEstimator(() => [[0.5, 0.5, 1]], false);
    const { get, states, models } = setup([est]);
    expect(get().state).toEqual({ status: "idle" });
    const video = new FakeVideo({ durationMs: 200 });
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = get().start(video.asVideo());
    });
    expect(get().state).toEqual({ status: "loading" });
    expect(models).toEqual(["lite"]);
    await act(async () => {
      est.resolveInit();
      await Promise.resolve();
    });
    expect(get().state.status).toBe("running");
    await act(async () => {
      await run;
    });
    const s = get().state;
    expect(s.status).toBe("done");
    if (s.status === "done") expect(s.track.samples).toHaveLength(5);
    expect([...new Set(states.map((x) => x.status))]).toEqual([
      "idle",
      "loading",
      "running",
      "done",
    ]);
    expect(est.closed).toBeGreaterThan(0);
  });

  it("aktualisiert den Fortschritt nur gedrosselt, nicht pro Frame", async () => {
    const est = fakeEstimator();
    const { get, states } = setup([est]);
    const video = new FakeVideo({ durationMs: 2000 }); // 41 steps
    let clock = 0;
    let finished = false;
    act(() => {
      void get()
        .start(video.asVideo(), { now: () => (clock += 25) })
        .then(() => (finished = true));
    });
    // Small steps outside one big act so intermediate states are rendered, not batched away.
    for (let i = 0; i < 500 && !finished; i++) await settle(1);
    await settle(1);
    expect(get().state.status).toBe("done");
    const running = states.filter((s) => s.status === "running");
    // 41 steps * 25 ms / 250 ms ≈ 4 updates plus the initial 0 and the final 1.
    expect(running.length).toBeGreaterThan(1);
    expect(running.length).toBeLessThanOrEqual(8);
    expect(video.seeks.length).toBe(41);
  });

  it("cancel bricht ab, schließt das Modell und landet in aborted", async () => {
    const est = fakeEstimator();
    const { get } = setup([est]);
    const video = new FakeVideo({ durationMs: 10_000 });
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = get().start(video.asVideo());
    });
    await settle();
    expect(get().state.status).toBe("running");
    act(() => get().cancel());
    expect(get().state).toEqual({ status: "aborted" });
    expect(est.closed).toBeGreaterThan(0);
    await act(async () => {
      await run;
    });
    // The rejected run must not turn the state into an error afterwards.
    expect(get().state).toEqual({ status: "aborted" });
    const seeks = video.seeks.length;
    await settle();
    expect(video.seeks.length).toBe(seeks);
  });

  it("Unmount schließt das Modell und setzt keinen State mehr", async () => {
    const est = fakeEstimator();
    const { get, view } = setup([est]);
    const video = new FakeVideo({ durationMs: 10_000 });
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = get().start(video.asVideo());
    });
    await settle();
    const errors = vi.spyOn(console, "error");
    view.unmount();
    const after = renders;
    expect(est.closed).toBeGreaterThan(0);
    await run;
    await new Promise((r) => setTimeout(r, 30));
    expect(renders).toBe(after);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("Modell-Ladefehler führt zu einer deutschen Fehlermeldung", async () => {
    const est = fakeEstimator(() => null, false);
    const { get } = setup([est]);
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = get().start(new FakeVideo().asVideo());
    });
    await act(async () => {
      est.rejectInit();
      await run;
    });
    expect(get().state).toEqual({
      status: "error",
      message: "Das Pose-Modell konnte nicht geladen werden.",
    });
    expect(est.closed).toBeGreaterThan(0);
  });

  it("unlesbares Video führt zu einer deutschen Fehlermeldung", async () => {
    const est = fakeEstimator();
    const { get } = setup([est]);
    await act(async () => {
      await get().start(new FakeVideo({ width: 0 }).asVideo());
    });
    expect(get().state).toEqual({
      status: "error",
      message: "Das Video kann nicht gelesen werden.",
    });
    expect(est.closed).toBeGreaterThan(0);
  });

  it("ein zweiter Start löst den ersten ab, der alte Lauf überschreibt nichts", async () => {
    const first = fakeEstimator(() => null, false);
    const second = fakeEstimator(() => [[0.5, 0.5, 1]]);
    const { get } = setup([first, second]);
    let run1: Promise<void> = Promise.resolve();
    act(() => {
      run1 = get().start(new FakeVideo({ durationMs: 10_000 }).asVideo());
    });
    expect(get().state.status).toBe("loading");
    await act(async () => {
      await get().start(new FakeVideo({ durationMs: 100 }).asVideo());
    });
    expect(first.closed).toBeGreaterThan(0);
    expect(get().state.status).toBe("done");
    // The first model finishes loading late: it must neither analyze nor change the state.
    await act(async () => {
      first.resolveInit();
      await run1;
    });
    expect(first.detect).not.toHaveBeenCalled();
    const s = get().state;
    expect(s.status).toBe("done");
    if (s.status === "done") expect(s.track.samples).toHaveLength(3);
  });

  it("cancel während des Ladens schließt das Modell und bleibt bei aborted", async () => {
    const est = fakeEstimator(() => null, false);
    const { get } = setup([est]);
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = get().start(new FakeVideo().asVideo());
    });
    expect(get().state.status).toBe("loading");
    act(() => get().cancel());
    expect(get().state).toEqual({ status: "aborted" });
    expect(est.closed).toBeGreaterThan(0);
    await act(async () => {
      est.resolveInit();
      await run;
    });
    await settle();
    expect(get().state).toEqual({ status: "aborted" });
    expect(est.detect).not.toHaveBeenCalled();
  });

  it("start nach dem Unmount legt kein Modell an", async () => {
    const { get, view, createEstimator } = setup([fakeEstimator()]);
    const { start } = get();
    view.unmount();
    await start(new FakeVideo().asVideo());
    expect(createEstimator).not.toHaveBeenCalled();
  });

  it("reset kehrt nach idle zurück", async () => {
    const est = fakeEstimator();
    const { get } = setup([est]);
    await act(async () => {
      await get().start(new FakeVideo({ durationMs: 50 }).asVideo());
    });
    expect(get().state.status).toBe("done");
    act(() => get().reset());
    expect(get().state).toEqual({ status: "idle" });
  });
});
