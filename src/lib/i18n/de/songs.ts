/** German UI strings (source of truth). Keys start with "songs.". */
export const deSongs = {
  // ---- Add-song dialog ----
  "songs.add.title": "Song hinzufügen",
  "songs.add.description":
    "Wähle die Musik und lass die Choreografie erzeugen, importiere eine eigene oder erstelle sie aus einem Tanzvideo.",
  "songs.add.tab.file": "Datei",
  "songs.add.tab.url": "URL",
  "songs.add.tab.youtube": "YouTube",
  "songs.add.tab.spotify": "Spotify",
  "songs.add.videoMusic.label": "Musik aus dem Tanzvideo",
  "songs.add.videoMusic.hintOn":
    "Gespielt wird der Ton des Videos unter „Aus Video“. Dafür wird das Video mit dem Song auf diesem Gerät gespeichert.",
  "songs.add.videoMusic.hintOff":
    "Einschalten, wenn das Tanzvideo die Musik schon enthält: dann braucht es keine eigene Audiodatei.",
  "songs.add.audio.label": "Audiodatei",
  "songs.add.audio.readingVideo": "Lese den Ton des Videos …",
  "songs.add.audio.analyzing": "Analysiere …",
  "songs.add.audio.idleVideo": "Wähle unten unter „Aus Video“ ein Tanzvideo.",
  "songs.add.audio.idleFile": "MP3, M4A, WAV oder OGG. Die Datei bleibt auf diesem Gerät.",
  "songs.add.audio.music": "Musik: {name}",
  "songs.add.audio.videoRead": "Ton des Videos gelesen. Das Video belegt {size} in der Bibliothek.",
  "songs.add.audio.videoTooBig":
    "Das Video ist zu groß, um seine Musik zu verwenden (höchstens {max}). Bitte die Musik als Audiodatei wählen.",
  "songs.add.audio.videoUnreadable":
    "Der Ton des Videos kann nicht gelesen werden. Bitte die Musik als Audiodatei wählen.",
  "songs.add.audio.analyzeFailed": "Die Datei konnte nicht analysiert werden.",
  "songs.add.bpm.label": "BPM",
  "songs.add.bpm.estimated": "Geschätzt, bitte prüfen.",
  "songs.add.duration.label": "Länge in Sekunden",
  "songs.add.duration.clamped": "Die Choreografie deckt die ersten {minutes} Minuten ab.",
  "songs.add.url.label": "Adresse der Audiodatei",
  "songs.add.url.hint":
    "Nur eigene oder private Quellen verwenden. Die Musik wird beim Spielen von {host} geladen.",
  "songs.add.url.hostFallback": "der angegebenen Adresse",
  "songs.add.youtube.label": "YouTube-Link oder Video-ID",
  "songs.add.youtube.hint": "Das Video wird beim Spielen über youtube-nocookie.com geladen.",
  "songs.add.spotify.label": "Spotify-Song-Link oder URI",
  "songs.add.spotify.hint":
    "Braucht Spotify Premium. Beim Spielen spricht dein Gerät mit sdk.scdn.co, accounts.spotify.com und api.spotify.com.",
  "songs.add.spotify.expired": "Die Spotify-Anmeldung ist abgelaufen.",
  "songs.add.spotify.notConnected": "Noch nicht mit Spotify verbunden.",
  "songs.add.spotify.connectHint": "Zum Spielen in den Einstellungen unter „Spotify“ verbinden.",
  "songs.add.choreo.legend": "Choreografie",
  "songs.add.choreo.auto": "Automatisch erzeugen",
  "songs.add.choreo.import": "Aus Datei importieren",
  "songs.add.choreo.video": "Aus Video",
  "songs.add.keepVideo.label": "Video behalten",
  "songs.add.keepVideo.tooBig":
    "Das Video ist zu groß, um es zu behalten (höchstens {max}). Bitte „Video behalten“ ausschalten.",
  "songs.add.keepVideo.on":
    "Beim Spielen läuft das Video stumm statt des Coachs. Dafür wird es mit dem Song auf diesem Gerät gespeichert.",
  "songs.add.keepVideo.onSize":
    "Beim Spielen läuft das Video stumm statt des Coachs. Dafür wird es mit dem Song auf diesem Gerät gespeichert und belegt {size} in der Bibliothek.",
  "songs.add.keepVideo.off":
    "Einschalten, um das Video beim Spielen stumm statt des Coachs zu zeigen. Es wird dafür mit dem Song auf diesem Gerät gespeichert.",
  "songs.add.import.label": "Choreografie-Datei",
  "songs.add.import.moves_one": "{count} Moves",
  "songs.add.import.moves_other": "{count} Moves",
  "songs.add.import.readFailed": "Die Datei konnte nicht gelesen werden.",
  "songs.add.field.title": "Titel",
  "songs.add.field.artist": "Künstler",
  "songs.add.field.difficulty": "Schwierigkeit",
  "songs.add.difficulty.1": "1 – Leicht",
  "songs.add.difficulty.2": "2 – Mittel",
  "songs.add.difficulty.3": "3 – Schwer",
  "songs.add.submit": "Hinzufügen",
  "songs.add.saveFailed": "Der Song konnte nicht gespeichert werden.",

  // ---- Field validation (newSong.ts) ----
  "songs.validate.urlHttps": "Bitte eine https-Adresse verwenden.",
  "songs.validate.titleRequired": "Bitte einen Titel eingeben.",
  "songs.validate.titleMax": "Der Titel darf höchstens {max} Zeichen haben.",
  "songs.validate.youtube":
    "Das ist kein gültiger YouTube-Link. Bitte Link oder 11-stellige Video-ID eingeben.",
  "songs.validate.spotify":
    "Das ist kein gültiger Spotify-Song. Bitte einen Song-Link (open.spotify.com/track/…) oder eine Spotify-URI eingeben.",
  "songs.validate.bpm": "BPM muss zwischen {min} und {max} liegen.",
  "songs.validate.duration": "Die Länge muss zwischen {min} und {max} Sekunden liegen.",

  // ---- Storage / import / migration errors ----
  "songs.storage.full":
    "Der Speicher ist voll. Lösche Songs oder große Audiodateien und versuche es erneut.",
  "songs.import.invalidJson": "Die Datei ist kein gültiges JSON.",
  "songs.import.invalidFile": "Ungültige Choreografie-Datei. {details}",
  "songs.import.fileFallback": "Datei",
  "songs.import.choreoMissing": "Choreografie fehlt oder ist kein Objekt.",
  "songs.import.unknownVersion": "Unbekannte Choreografie-Version: {version}",
  "songs.import.songNotObject": "Song-Eintrag ist kein Objekt.",
  "songs.schema.color": "Farbe als #RRGGBB",
  "songs.schema.framesSorted": "Frames müssen nach timeMs sortiert sein",
  "songs.schema.movesSorted": "Moves müssen nach timeMs sortiert sein",
  "songs.db.otherTab": "Die Datenbank ist in einem anderen Tab geöffnet. Bitte diesen schließen.",
  "songs.db.audioLocalOnly": "Audiodaten gehören nur zu lokalen Songs.",
  "songs.db.videoNeedsBlobId": "Das Tanzvideo braucht eine videoBlobId.",
  "songs.db.notFound": "Song nicht gefunden.",
  "songs.db.corrupt": "Der Song ist beschädigt und kann nicht geändert werden.",

  // ---- Video import ----
  "songs.video.range.invalid": "Bitte Start und Ende in Sekunden angeben.",
  "songs.video.range.endAfterStart": "Das Ende muss nach dem Start liegen.",
  "songs.video.range.beyondEnd": "Das Ende liegt hinter dem Videoende.",
  "songs.video.range.tooShort": "Der Abschnitt muss mindestens {seconds} Sekunden lang sein.",
  "songs.video.range.tooLong":
    "Der Abschnitt darf höchstens {minutes} Minuten lang sein. Bitte Start oder Ende anpassen.",
  "songs.video.range.typeBoth": "Bitte Start und Ende in Sekunden angeben, z. B. 12,5.",
  "songs.video.beatPhase.invalid": "Ungültige Beat-Phase.",
  "songs.video.build.tooFewDetections": "Im Video wurde zu selten eine Person erkannt.",
  "songs.video.build.tooFewMoves": "Zu wenige auswertbare Moves im gewählten Abschnitt.",
  "songs.video.build.failed": "Aus dem Video ließ sich kein Tanz bauen.",
  "songs.video.err.model": "Das Pose-Modell konnte nicht geladen werden.",
  "songs.video.err.video": "Das Video kann nicht gelesen werden.",
  "songs.video.err.timeout": "Das Video reagiert nicht mehr (Zeitüberschreitung beim Spulen).",
  "songs.video.err.range": "Der gewählte Abschnitt liegt außerhalb des Videos.",
  "songs.video.err.unexpected": "Die Analyse wurde unerwartet abgebrochen.",

  // ---- Video panel ----
  "songs.video.model.lite": "Schnell",
  "songs.video.model.full": "Genau",
  "songs.video.placement.grid": "Fester Takt",
  "songs.video.placement.holds": "Haltepunkte",
  "songs.video.beatHand": "Bitte die Beat-Phase von Hand eintragen.",
  "songs.video.beat.noneInRange": "Im Abschnitt ist kein Takt erkennbar. {hint}",
  "songs.video.beat.fileTooBig":
    "Das Video ist zu groß für die Takterkennung (höchstens {max} MB). {hint}",
  "songs.video.beat.tooLong":
    "Das Video ist zu lang für die Takterkennung (höchstens {minutes} Minuten). {hint}",
  "songs.video.beat.noneInAudio": "Im Ton des Videos ist kein Takt erkennbar. {hint}",
  "songs.video.beat.audioFailed": "Der Ton des Videos lässt sich nicht auswerten. {hint}",
  "songs.video.unknownLength":
    "Die Länge des Videos ist unbekannt. Bitte eine andere Datei wählen.",
  "songs.video.unreadable": "Das Video kann nicht gelesen werden. Bitte MP4 oder MOV.",
  "songs.video.file.label": "Tanzvideo",
  "songs.video.file.hintMusic":
    "MP4 oder MOV mit der Musik als Ton. Das Video bleibt auf diesem Gerät und wird als Musik des Songs gespeichert; die Erkennung läuft im Browser ohne externe Abrufe.",
  "songs.video.file.hintKeep":
    "MP4 oder MOV, gleiche Aufnahme wie die Musik (ab Sekunde 0). Das Video bleibt auf diesem Gerät und wird mit dem Song gespeichert; die Erkennung läuft im Browser ohne externe Abrufe.",
  "songs.video.file.hintDiscard":
    "MP4 oder MOV, gleiche Aufnahme wie die Musik (ab Sekunde 0). Das Video bleibt auf diesem Gerät und wird nach dem Hinzufügen verworfen; die Erkennung läuft im Browser ohne externe Abrufe.",
  "songs.video.preview": "Videovorschau",
  "songs.video.loadingModel": "Lade Pose-Modell …",
  "songs.video.analyzing": "Analysiere … {progress} %",
  "songs.video.cancel": "Abbrechen",
  "songs.video.progress": "Analysefortschritt",
  "songs.video.start.label": "Start (Sekunden)",
  "songs.video.start.button": "Ab hier",
  "songs.video.end.label": "Ende (Sekunden)",
  "songs.video.end.button": "Bis hier",
  "songs.video.selfie.label": "Video ist gespiegelt (Selfie-Aufnahme)",
  "songs.video.selfie.fromName":
    "Eingeschaltet, weil der Dateiname auf ein gespiegeltes Video hinweist. ",
  "songs.video.selfie.hint":
    "Einschalten bei Selfie-Aufnahmen und Dance-Practice-Videos mit „Mirrored“ im Titel: Dort sind links und rechts schon vertauscht.",
  "songs.video.phase.label": "Beat-Phase (ms)",
  "songs.video.phase.lost":
    "Der erkannte Takt lässt sich gerade nicht berechnen (BPM, Bereich oder Musikdatei fehlen). Bitte neu erkennen oder von Hand eintragen.",
  "songs.video.phase.invalid": "Bitte ganze Millisekunden eingeben, z. B. 0 oder 250.",
  "songs.video.phase.autoMusic":
    "Erster Beat ab Start, erkannt aus der Musikdatei. Bitte im Sync-Test prüfen.",
  "songs.video.phase.autoVideo":
    "Erster Beat ab Start, erkannt aus dem Ton des Videos. Bitte im Sync-Test prüfen.",
  "songs.video.phase.manual":
    "Zeitpunkt eines Beats im Video. Die Feinabstimmung folgt später im Sync-Test.",
  "songs.video.beat.detect": "Takt erkennen",
  "songs.video.beat.detecting": "Werte den Ton aus …",
  "songs.video.model.label": "Modell",
  "songs.video.model.hint":
    "Genau erkennt Posen zuverlässiger, die Analyse dauert aber länger. Beim ersten Mal werden ca. 9 MB geladen.",
  "songs.video.placement.label": "Moves",
  "songs.video.placement.hint":
    "Haltepunkte: Moves auf Beats, an denen die Pose kurz steht (etwa gleich viele Moves).",
  "songs.video.analyze": "Video analysieren",
  "songs.video.reanalyze": "Neu analysieren",
  "songs.video.aborted": "Analyse abgebrochen.",
  "songs.video.stale.both": "Zeitbereich und Modell haben sich geändert.",
  "songs.video.stale.range": "Der Zeitbereich hat sich geändert.",
  "songs.video.stale.model": "Das Modell hat sich geändert.",
  "songs.video.stale.rerun": "Bitte das Video neu analysieren.",
  "songs.video.needBpm": "Bitte gültige BPM eintragen, dann entstehen die Moves.",
  "songs.video.result.person": "Person {number} von {total}: ",
  "songs.video.result.summary":
    "{moves} Moves, davon {gold} Gold Moves, Person in {percent} % der Bilder erkannt.",
  "songs.video.result.model": " Modell: {model}.",
  "songs.video.result.placement": " Moves: {placement}.",
  "songs.video.persons.title": "Mehrere Personen erkannt",
  "songs.video.persons.tap": "Tippe auf die Person, deren Bewegungen du übernehmen willst.",
  "songs.video.persons.group": "Zielperson",
  "songs.video.persons.person": "Person {number}",
  "songs.video.persons.notFound":
    "Die gewählte Person ist in diesem Bild nicht erkannt. Wähle eine Person oder ein anderes Bild.",
  "songs.video.persons.currentFrame": "Aktuelles Bild",
  "songs.video.persons.currentFrameHint":
    "Zeigt das Bild an der Stelle der Videovorschau, z. B. wo die Personen gut getrennt stehen.",

  // ---- Audio sources ----
  "songs.audio.playRefused": "Der Start wurde blockiert. Tippe zum Starten.",
  "songs.audio.urlLoadFailed":
    "Die Audio-URL konnte nicht geladen werden. Prüfe den Link und ob die Datei öffentlich erreichbar ist.",
  "songs.audio.decodeFailed":
    "Die Audiodatei konnte nicht dekodiert werden. Bitte MP3, M4A, WAV oder OGG verwenden.",
  "songs.audio.connectionLost": "Die Verbindung zur Musik ist abgebrochen.",
  "songs.audio.fileMissing": "Audiodatei nicht gefunden.",
  "songs.audio.pausedPlay": "Wiedergabe angehalten.",
  "songs.audio.endedPlay": "Wiedergabe beendet.",
  "songs.audio.youtube.loadOffline": "YouTube konnte nicht geladen werden. Bist du online?",
  "songs.audio.youtube.load": "YouTube konnte nicht geladen werden.",
  "songs.audio.youtube.noEmbed": "Dieses Video darf nicht eingebettet werden.",
  "songs.audio.youtube.unavailable": "YouTube-Video nicht verfügbar.",
  "songs.audio.youtube.videoTimeout": "YouTube-Video lädt nicht. Prüfe Link und Verbindung.",
  "songs.audio.youtube.rate":
    "Dieses Video lässt sich nicht im Tempo {rate}× abspielen. Stelle im Editor 1× ein.",
  "songs.audio.youtube.notLoaded": "YouTube-Player ist noch nicht geladen.",
  "songs.audio.youtube.blocked": "YouTube hat den Start blockiert. Tippe zum Starten.",
  "songs.audio.spotify.loadOffline": "Spotify konnte nicht geladen werden. Bist du online?",
  "songs.audio.spotify.load": "Spotify konnte nicht geladen werden.",
  "songs.audio.spotify.accountError": "Spotify Premium wird benötigt, um im Browser abzuspielen.",
  "songs.audio.spotify.authError":
    "Spotify-Anmeldung abgelaufen. Bitte in den Einstellungen neu verbinden.",
  "songs.audio.spotify.initError": "Dein Browser unterstützt Spotify-Wiedergabe nicht.",
  "songs.audio.spotify.playbackError": "Spotify konnte den Song nicht abspielen.",
  "songs.audio.spotify.blocked": "Spotify hat den Start blockiert. Tippe zum Starten.",
  "songs.audio.spotify.playerTimeout": "Spotify-Player lädt nicht. Prüfe deine Verbindung.",
  "songs.audio.spotify.connectFailed": "Spotify-Player konnte sich nicht verbinden.",
  "songs.audio.spotify.connectionLost": "Die Verbindung zu Spotify ist abgebrochen.",
  "songs.audio.spotify.notLoaded": "Spotify-Player ist noch nicht geladen.",
  "songs.audio.spotify.notReady": "Spotify-Player ist nicht bereit.",
  "songs.audio.spotify.resumeFailed": "Spotify konnte nicht weiterspielen.",
  "songs.audio.spotify.unreachable": "Spotify ist nicht erreichbar. Bist du online?",
  "songs.audio.spotify.startFailed": "Spotify konnte den Song nicht starten (HTTP {status}).",

  // ---- Spotify login ----
  "songs.spotify.noLocalhost": "Spotify erlaubt „localhost“ nicht. Öffne die App über 127.0.0.1.",
  "songs.spotify.needsHttps": "Spotify verlangt eine HTTPS-Adresse.",
  "songs.spotify.badClientId": "Die Client-ID ist ungültig.",
  "songs.spotify.loginFailed": "Spotify-Anmeldung fehlgeschlagen.",
  "songs.spotify.denied": "Du hast die Verbindung mit Spotify abgelehnt.",
  "songs.spotify.noLogin": "Spotify hat keine Anmeldung zurückgegeben.",
  "songs.spotify.stateMismatch":
    "Die Anmeldung passt nicht zu dieser Sitzung. Bitte neu verbinden.",
  "songs.spotify.expired":
    "Die Spotify-Anmeldung ist abgelaufen. Bitte in den Einstellungen neu verbinden.",
  "songs.spotify.connectFirst": "Bitte zuerst in den Einstellungen mit Spotify verbinden.",
} as const satisfies Record<string, string>;
