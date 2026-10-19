# Plan Etappe 6: Bewegungsmodus

Ziel: Ohne Kamera spielen. Das Handy wird in der Hand gehalten, DeviceMotion misst die
Bewegungsintensität um jeden Move; daraus entsteht das Urteil statt aus Winkeln.

## Entscheidungen

- **Messgröße:** Betrag der linearen Beschleunigung (`event.acceleration`, m/s², ohne
  Schwerkraft). Fehlt sie (manche Android-Geräte), Ersatz aus `accelerationIncludingGravity`
  mit Hochpass (Schwerkraft per Tiefpass geschätzt, Faktor als Konstante).
- **Zeitstempel:** Jede Messung bekommt beim Eintreffen die Spielzeit aus dem Spieltakt
  (`useAudioClock`, also `AudioSource.getTimeMs()`), nie `event.timeStamp`/`performance.now()`.
- **Fenster:** wie im Winkelmodus `move.timeMs ± MOVE_WINDOW_MS` (250 ms).
- **Wert:** Mittelwert des Betrags im Fenster. Weniger als `MIN_SAMPLES` (3) Messungen im
  Fenster → kein Wert → X (wie die Mindestabdeckung im Winkelmodus; fehlende Daten werden nie als
  0 gewertet, das Urteil X entsteht nur aus „nicht genug Daten“).
- **Urteil:** Schwellen (m/s²) PERFECT ≥ 6, SUPER ≥ 4, GOOD ≥ 2,5, OK ≥ 1,2, sonst X; mal
  Faktor je Schwierigkeit (easy 0,7, normal 1, hard 1,4); Gold-Moves × 1,25. Startwerte, am
  Gerät abzustimmen.
- **Grenze:** Dauerhaftes Schütteln wird belohnt; der Takt wird nur über die Fenster um die Moves
  geprüft. Dokumentieren.
- **Highscore:** wird wie im Kameramodus gespeichert (kein Formatwechsel). Dokumentieren.
- **Kein Formatwechsel, keine neue Abhängigkeit, keine neue Einstellung.**

## Logikschicht (Subagent 1)

- `src/lib/motion.ts`:
  - `MOTION` Konstanten (Schwellen, Faktoren, `MIN_SAMPLES`, Hochpass-Faktor, Puffergröße).
  - `class MotionMeter`: `push(t, sample)` mit `sample = { linear: {x,y,z} | null, withGravity:
{x,y,z} | null }` (Nullwerte einzelner Achsen → Messung verwerfen), `intensity(fromMs, toMs):
number | null`, `lastSampleMs` (−Infinity am Anfang), `reset()`. Puffer begrenzt (alte Werte
    verwerfen), Zeiten können bei Seek/Restart zurückspringen → `reset()` durch den Aufrufer.
  - `judgeIntensity(value: number | null, difficulty, gold): Rating`.
  - `requestMotionPermission(): Promise<"granted" | "denied" | "unsupported">` (nur in
    Event-Handlern aufrufen; iOS `DeviceMotionEvent.requestPermission`, sonst „granted“, wenn
    `DeviceMotionEvent` existiert, sonst „unsupported“).
- `Scorer.sample(t, player, intensityRating?: (move: Move, fromMs: number, toMs: number) =>
Rating)`; `useScoring`/`ScoringPort` und `GameScoring` reichen den dritten Parameter durch.
- `GameController`: optionale Dep `motion?: { rating(move, fromMs, toMs): Rating; lastSampleMs():
number }`. Ist sie gesetzt: `tick()` ruft `sample(now, null, motion.rating)` höchstens alle
  `sampleMs`, kein Stall-Pfad; `bodyMissing` = keine Sensormessung seit `bodyMissingMs`;
  `finish()` bewertet offene Moves ebenfalls über `motion.rating`. Kameramodus unverändert.
- Tests: `src/test/motion.test.ts` (Mittelwert, Fenster, MIN_SAMPLES, Hochpass-Ersatz,
  Schwellen je Schwierigkeit und Gold, Berechtigung iOS/granted/denied/unsupported), Ergänzungen
  in `scorer.test.ts` und `gameController.test.ts`.

## UI-Integration (Subagent 2)

- `src/hooks/useDeviceMotion.ts`: `devicemotion`-Listener im Effekt, Messung per Callback-Ref,
  kein `setState` pro Event.
- Route `/play/$songId`: `mode=motion` aus der Query lesen (wie `parseSimParams`, auch im
  Produktions-Build). `GameScreen` mit `mode`:
  - keine Kamera (`usePoseTracking` aus), kein Video, kein Skelett, kein Kamera-Fehler-Overlay,
    keine Kamera-Pause; Auto-Start wie im Simulationsmodus.
  - `MotionMeter` in einem Ref, gefüttert vom Hook mit `clock.timeMs()`; `reset()` bei Start,
    Neustart und Weiter.
  - Hinweis statt „Wir sehen dich nicht“: „Keine Bewegung erkannt – Handy in der Hand halten“.
  - Badge „Bewegungsmodus“ (dezent). Im Pausenmenü kein Skelett-Schalter.
  - „Zum Starten tippen“ (blocked) fragt zusätzlich die Sensor-Berechtigung an (iOS nach
    Neuladen).
- `SetupScreen`: Knopf „Ohne Kamera spielen“ in der Startkarte (vor „Kamera starten“) und im
  Kamera-Fehlerpanel. Tipp: `unlockAudio()` und `requestMotionPermission()` synchron im Handler
  starten, bei „granted“ nach `/play/$songId?mode=motion`; bei „denied“/„unsupported“ eine
  Meldung („Bewegungssensor nicht erlaubt“ / „Dieses Gerät hat keinen Bewegungssensor“).
  Kurzer Hinweistext: Handy fest in der Hand halten, im Takt bewegen.
- Farben/Animation nur aus `src/theme.ts`.
- Tests: Spielscreen mit `?mode=motion` (keine Kamera angefragt, synthetische
  `devicemotion`-Events → Urteile, Hinweis ohne Events), Aufstellhilfe (Knopf, Navigation,
  Ablehnung).

## Akzeptanzkriterien

- typecheck, test, lint, build grün.
- Mit `?mode=motion` startet das Spiel ohne `getUserMedia`; synthetische Bewegung ergibt
  Urteile, keine Bewegung ergibt X und den Hinweis.
- Kameramodus verhält sich unverändert (bestehende Tests grün).
- Playwright 390×844 und 844×390: Aufstellhilfe mit Knopf, Spiel im Bewegungsmodus, Konsole
  sauber.
- Doku: `scoring.md` (Bewegungsmodus), `architecture.md` (Datenfluss), `roadmap.md` (Status,
  Gerätetest-Liste).

## Gerätetest (offen nach Umsetzung)

iOS-Berechtigungsdialog, Android ohne `acceleration`, Schwellen (fühlt sich PERFECT verdient
an?), Bildschirmsperre beim Spielen ohne Kamera (Wake Lock erst Etappe 7).
