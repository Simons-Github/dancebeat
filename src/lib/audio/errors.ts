/**
 * `play()` was refused because no user gesture allowed the start (autoplay policy). The caller
 * should offer "tap to start"; every other `play()` rejection is a real error to show.
 * Re-exported by `sources.ts`; kept separate so the game controller does not pull in the library.
 */
export class PlayRefusedError extends Error {
  constructor(message = "Der Start wurde blockiert. Tippe zum Starten.") {
    super(message);
    this.name = "PlayRefusedError";
  }
}
