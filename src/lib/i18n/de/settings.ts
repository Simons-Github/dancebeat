/** German UI strings (source of truth). Keys start with "settings.". */
export const deSettings = {
  // Settings screen
  "settings.title": "Einstellungen",
  "settings.game.title": "Spiel",
  "settings.game.difficulty": "Schwierigkeit",
  "settings.game.difficulty.leicht": "Leicht",
  "settings.game.difficulty.normal": "Normal",
  "settings.game.difficulty.schwer": "Schwer",
  "settings.game.difficultyHint":
    "Verändert, wie genau deine Bewegung zur Vorlage passen muss: leicht verzeiht mehr, schwer weniger.",
  "settings.game.autoStart.label": "Automatisch starten",
  "settings.game.autoStart.hint": "Die Aufstellhilfe startet das Spiel, sobald du erkannt wirst.",
  "settings.game.haptics.label": "Vibration",
  "settings.game.haptics.hint":
    "Kurzes Vibrieren bei PERFECT und getroffenen Gold Moves. Nicht auf dem iPhone verfügbar.",
  "settings.audio.title": "Ton",
  "settings.audio.volume": "Lautstärke",
  "settings.audio.percent": "{value} %",
  "settings.audio.volumeIgnoredHint":
    "Auf diesem Gerät regelt der Regler nur eigene Audiodateien. Bei Audio-URLs und YouTube gelten die Lautstärketasten.",
  "settings.audio.latency": "Latenz-Ausgleich",
  "settings.audio.latencyHint":
    "Positiv: die Piktogramme kommen später. Das hilft, wenn Bluetooth-Kopfhörer den Ton verzögern. Ein Sync-Test, der den Wert misst, folgt später.",
  "settings.audio.latencyReset": "Zurücksetzen",
  "settings.display.title": "Anzeige",
  "settings.display.skeleton.label": "Skelett anzeigen",
  "settings.display.skeleton.hint": "Zeichnet deine erkannten Gelenke über das Kamerabild.",
  "settings.display.beatPulse.label": "Beat-Puls am Rand",
  "settings.display.beatPulse.hint": "Der Bildschirmrand pulsiert im Takt der Musik.",
  "settings.display.danceVideo.label": "Tanzvideo zeigen",
  "settings.display.danceVideo.hint":
    "Bei Songs mit Tanzvideo läuft das Video stumm statt der Strichfigur mit.",
  "settings.display.danceVideoLarge.label": "Tanzvideo groß",
  "settings.display.danceVideoLarge.hint":
    "Zeigt das Tanzvideo im Spiel größer; es verdeckt dann mehr vom Kamerabild.",
  "settings.display.danceVideoLarge.hintOff": "Nur mit „Tanzvideo zeigen“.",
  "settings.display.mirror.label": "Kamerabild spiegeln",
  "settings.display.mirror.hint":
    "Nur die Anzeige wird gespiegelt, die Bewertung ändert sich nicht.",
  "settings.camera.title": "Kamera",
  "settings.camera.hint": "Die Kamera wählst du in der Aufstellhilfe, bevor ein Song startet.",
  "settings.camera.forget": "Gespeicherte Kamera vergessen",
  "settings.storage.title": "Speicher",
  "settings.storage.loading": "Wird ermittelt …",
  "settings.storage.unavailable": "Nicht verfügbar",
  "settings.storage.usage": "{used} belegt von {quota}",
  "settings.storage.hint": "Songs und Audiodateien liegen nur auf diesem Gerät.",
  "settings.about.title": "Über und Credits",
  "settings.credits.linksNote": "Links öffnen sich erst beim Tippen in einem neuen Tab.",
  "settings.licenses.summary": "Lizenztexte",
  "settings.licenses.loading": "Wird geladen …",
  "settings.licenses.apache": "Apache License 2.0 (MediaPipe, Pose-Modelle)",
  "settings.licenses.font": "SIL Open Font License 1.1 (Bricolage Grotesque)",
  "settings.licenses.bundled": "Mitgelieferte npm-Pakete",
  "settings.licenses.bundledNone": "Die Paketliste entsteht erst beim Produktions-Build.",

  // Spotify settings
  "settings.spotify.status.disconnected": "Nicht verbunden",
  "settings.spotify.status.connected": "Verbunden",
  "settings.spotify.status.expired": "Anmeldung abgelaufen, bitte neu verbinden",
  "settings.spotify.intro":
    "Für Spotify-Songs brauchst du Spotify Premium und eine eigene App im Spotify-Developer-Dashboard. Beim Verbinden und Abspielen spricht dein Gerät direkt mit Spotify (accounts.spotify.com, api.spotify.com, sdk.scdn.co); Spotify sieht dabei deine IP-Adresse. Die Anmeldung gilt nur, bis du den Tab schließt.",
  "settings.spotify.clientId": "Client-ID",
  "settings.spotify.clientIdPlaceholder": "32 Zeichen aus dem Dashboard",
  "settings.spotify.clientIdError": "Die Client-ID besteht aus 32 Zeichen (0–9, a–f).",
  "settings.spotify.redirectLabel": "Redirect-URI für das Dashboard",
  "settings.spotify.redirectLocalhost":
    "Spotify erlaubt „localhost“ nicht. Öffne die App über 127.0.0.1 statt localhost.",
  "settings.spotify.redirectHttps":
    "Spotify verlangt eine HTTPS-Adresse. Auf dem Handy die App über HTTPS öffnen.",
  "settings.spotify.status": "Status: {status}",
  "settings.spotify.connect": "Mit Spotify verbinden",
  "settings.spotify.reconnect": "Neu verbinden",
  "settings.spotify.disconnect": "Trennen",

  // Setup screen
  "settings.setup.title": "Aufstellhilfe",
  "settings.setup.intro":
    "Gleich tanzt du zu „{title}“. Die Kamera sieht dich, damit DanceBeat deine Bewegungen bewerten kann.",
  "settings.setup.step1": "Stell das Handy fest auf, zum Beispiel angelehnt an eine Wand.",
  "settings.setup.step2":
    "Geh zwei bis drei Schritte zurück, bis du von Kopf bis Fuß im Bild bist.",
  "settings.setup.step3": "Sorge für genug Licht, am besten von vorne.",
  "settings.setup.startCamera": "Kamera starten",
  "settings.setup.motionIntro":
    "Ohne Kamera: Halte das Handy fest in der Hand und beweg dich im Takt. Bewertet wird, wie kräftig du dich bewegst.",
  "settings.setup.playWithoutCamera": "Ohne Kamera spielen",
  "settings.setup.motionChecking": "Bewegungssensor wird geprüft …",
  "settings.setup.motionDenied":
    "Bewegungssensor nicht erlaubt. Erlaube den Zugriff in den Browser-Einstellungen und versuche es noch einmal.",
  "settings.setup.motionUnsupported": "Dieses Gerät hat keinen Bewegungssensor.",
  "settings.setup.liveVideo": "Live-Bild deiner Kamera",
  "settings.setup.loading": "Kamera und Erkennung werden gestartet …",
  "settings.setup.loadingSlow": "Beim ersten Mal kann das etwas dauern.",
  "settings.setup.standUp": "Stell dich auf",
  "settings.setup.standInFront": "Stell dich vor die Kamera.",
  "settings.setup.cameraStarting": "Einen Moment, die Kamera startet.",
  "settings.setup.lightHint": "Mehr Licht: schalte eine Lampe an oder stell dich vor ein Fenster.",
  "settings.setup.fallbackCamera":
    "Die gespeicherte Kamera ist nicht erreichbar, es läuft die Standardkamera.",
  "settings.setup.autoStartOn": "Sobald alles passt, geht es von selbst los.",
  "settings.setup.autoStartCancelled":
    "Automatischer Start ist aus, weil du abgebrochen hast. Tippe auf „Los geht's“, wenn du bereit bist.",
  "settings.setup.tapWhenReady": "Tippe auf „Los geht's“, wenn du bereit bist.",
  "settings.setup.cameraLabel": "Kamera",
  "settings.setup.cameraPlaceholder": "Kamera wählen",
  "settings.setup.go": "Los geht's",
  "settings.setup.diagToggle": "Diagnose ein- oder ausblenden",

  // Camera (errors, device names)
  "settings.camera.fallbackLabel": "Kamera {n}",
  "settings.camera.error.denied.title": "Kamera-Zugriff verweigert",
  "settings.camera.error.denied.hint":
    "Erlaube die Kamera in den Browser-Einstellungen (Schloss-Symbol neben der Adresse; auf dem iPhone „aA“ → Website-Einstellungen → Kamera) und tippe dann auf „Erneut versuchen“.",
  "settings.camera.error.nocamera.title": "Keine Kamera gefunden",
  "settings.camera.error.nocamera.hint":
    "Schließe eine Kamera an oder nutze ein Gerät mit Frontkamera. Dann tippe auf „Erneut versuchen“.",
  "settings.camera.error.busy.title": "Kamera wird bereits verwendet",
  "settings.camera.error.busy.hint":
    "Schließe andere Apps oder Tabs, die die Kamera nutzen (Videoanruf, Kamera-App), und tippe auf „Erneut versuchen“.",
  "settings.camera.error.interrupted.title": "Die Kamera wurde unterbrochen",
  "settings.camera.error.interrupted.hint":
    "Ein Anruf oder eine andere App hat die Kamera übernommen. Beende sie und tippe auf „Erneut starten“.",
  "settings.camera.error.insecure.title": "Kamera nur über eine sichere Verbindung",
  "settings.camera.error.insecure.hint":
    "Öffne DanceBeat über HTTPS (oder localhost). Auf dem Handy: „bun run dev:https“ starten und die https-Adresse öffnen.",
  "settings.camera.error.overconstrained.title": "Gewählte Kamera nicht verfügbar",
  "settings.camera.error.overconstrained.hint":
    "Wähle eine andere Kamera aus oder tippe auf „Erneut versuchen“, um die Standardkamera zu nutzen.",
  "settings.camera.error.model.title": "Erkennung konnte nicht geladen werden",
  "settings.camera.error.model.hint":
    "Beim Start der Kamera lädt DanceBeat Erkennungsmodell und Laufzeit von der eigenen Adresse der App. Prüfe die Verbindung zur App und tippe auf „Erneut versuchen“.",
  "settings.camera.error.unknown.title": "Kamera konnte nicht gestartet werden",
  "settings.camera.error.unknown.hint":
    "Lade die Seite neu und tippe auf „Erneut versuchen“. Hilft das nicht, starte den Browser neu.",
  "settings.camera.retryRestart": "Erneut starten",
  "settings.camera.retry": "Erneut versuchen",

  // Body tracker (hints and checklist)
  "settings.body.hint.none": "Stell dich vor die Kamera. Ich sehe dich noch nicht.",
  "settings.body.hint.kneesMissing": "Knie nicht im Bild. Geh einen Schritt zurück.",
  "settings.body.hint.feetMissing": "Füße nicht im Bild. Geh einen Schritt zurück.",
  "settings.body.hint.torsoMissing": "Oberkörper nicht im Bild. Geh einen Schritt zurück.",
  "settings.body.hint.near": "Geh einen Schritt zurück.",
  "settings.body.hint.far": "Komm einen Schritt näher.",
  "settings.body.hint.center": "Stell dich in die Bildmitte.",
  "settings.body.hint.ready": "Alles bereit. Los geht's!",
  "settings.body.hint.hold": "Super, bleib kurz so stehen.",
  "settings.body.row.visible": "Kopf bis Fuß sichtbar",
  "settings.body.row.feet": "Füße nicht im Bild",
  "settings.body.row.knees": "Knie nicht im Bild",
  "settings.body.row.torso": "Oberkörper nicht im Bild",
  "settings.body.row.lightLow": "Mehr Licht nötig",
  "settings.body.row.light": "Genug Licht",
  "settings.body.row.distanceOk": "Abstand passt",
  "settings.body.row.near": "Zu nah dran",
  "settings.body.row.far": "Zu weit weg",
  "settings.body.state.ok": "in Ordnung",
  "settings.body.state.warn": "Achtung",
  "settings.body.state.pending": "wird geprüft",

  // Diagnostics panel
  "settings.diag.label": "Diagnose",
  "settings.diag.detection": "Erkennung",
  "settings.diag.fps": "{fps} FPS (Ziel: über 25)",
  "settings.diag.inference": "Inferenz",
  "settings.diag.delegate": "Delegate",
  "settings.diag.model": "Modell",

  // Privacy note
  "settings.privacy.camera":
    "Kamerabilder verlassen dein Gerät nie. Die Bewegungserkennung läuft vollständig auf deinem Gerät.",
  "settings.privacy.youtube":
    "Die Musik kommt von YouTube (Skript von youtube.com, Video über youtube-nocookie.com); YouTube sieht dabei deine IP-Adresse.",
  "settings.privacy.spotify":
    "Die Musik kommt von Spotify (Skript von sdk.scdn.co, Anmeldung und Wiedergabe über accounts.spotify.com und api.spotify.com); Spotify sieht dabei deine IP-Adresse und welchen Song du spielst.",
  "settings.privacy.url": "Die Musik wird von {origin} geladen; der Server sieht deine IP-Adresse.",
  "settings.privacy.urlFallback": "der eingetragenen Adresse",

  // Sync test screen
  "settings.sync.title": "Sync-Test",
  "settings.sync.intro":
    "Tippe im Takt der Musik auf die Fläche oder drücke die Leertaste, genau dann, wenn du den Beat hörst. Nach {total} Taps schlägt DanceBeat einen Sync-Offset vor; die ersten {discard} zählen nicht.",
  "settings.sync.savedOffset": "Gespeicherter Sync-Offset:",
  "settings.sync.lowPrecision":
    "Bei {source} ist die Zeitmessung ungenauer als bei einer Audiodatei. Der Wert kann um einige Millisekunden schwanken.",
  "settings.sync.youtubeFrame": "YouTube-Video",
  "settings.sync.audioError": "Die Musik konnte nicht geladen werden. {error}",
  "settings.sync.stop": "Stopp",
  "settings.sync.start": "Start",
  "settings.sync.loadingMusic": "Musik lädt …",
  "settings.sync.startBlockedYoutube": "Der Start wurde blockiert. Tippe direkt auf das Video.",
  "settings.sync.startFailed": "Die Musik ließ sich nicht starten. Tippe noch einmal auf „Start“.",
  "settings.sync.toSettings": "Zu den Einstellungen",
  "settings.sync.ended": "Der Song ist zu Ende.",
  "settings.sync.danceVideo": "Tanzvideo",
  "settings.sync.tapArea": "Im Takt tippen",
  "settings.sync.tapNow": "Tipp!",
  "settings.sync.tapStartFirst": "Erst „Start“ drücken",
  "settings.sync.tapCount_one": "{count} Taps",
  "settings.sync.tapCount_other": "{count} Taps",
  "settings.sync.tapsLeft": " · noch {remaining}",
  "settings.sync.result": "Ergebnis",
  "settings.sync.deviationIntro":
    "Abweichung deiner letzten Taps vom Beat (mit eingestelltem Offset):",
  "settings.sync.deviationList": "Abweichung pro Tap",
  "settings.sync.proposal": "Vorschlag:",
  "settings.sync.spread_one": "Streuung ±{spread} ms aus {count} Taps",
  "settings.sync.spread_other": "Streuung ±{spread} ms aus {count} Taps",
  "settings.sync.uneven": "Ungleichmäßig, nochmal versuchen.",
  "settings.sync.noTaps": "Noch keine Taps.",
  "settings.sync.untilProposal_one": "Noch {count} Taps bis zum Vorschlag.",
  "settings.sync.untilProposal_other": "Noch {count} Taps bis zum Vorschlag.",
  "settings.sync.acceptProposal": "Vorschlag übernehmen",
  "settings.sync.again": "Nochmal",
  "settings.sync.fineTune": "Feinjustierung",
  "settings.sync.offset": "Offset:",
  "settings.sync.lightHint":
    "Das Licht blinkt im Takt mit dem eingestellten Offset. Passt es zum Beat, den du hörst, speichere.",
  "settings.sync.nudgeDec": "Offset um {ms} ms verringern",
  "settings.sync.nudgeInc": "Offset um {ms} ms erhöhen",
  "settings.sync.saveFailed": "Speichern hat nicht geklappt. Versuch es noch einmal.",
  "settings.sync.resetNotice": "Sync-Offset auf 0 ms gesetzt.",
  "settings.sync.resetToZero": "Auf 0 zurücksetzen",

  // Audio analysis (src/lib/beat.ts)
  "settings.beat.decodeError":
    "Diese Datei lässt sich nicht abspielen. Bitte MP3, M4A, WAV oder OGG verwenden.",
} as const satisfies Record<string, string>;
