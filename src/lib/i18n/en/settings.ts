import type { deSettings } from "../de/settings";

/** English UI strings; must have exactly the keys of the German file. */
export const enSettings = {
  // Settings screen
  "settings.title": "Settings",
  "settings.game.title": "Game",
  "settings.game.difficulty": "Difficulty",
  "settings.game.difficulty.leicht": "Easy",
  "settings.game.difficulty.normal": "Normal",
  "settings.game.difficulty.schwer": "Hard",
  "settings.game.difficultyHint":
    "Changes how closely your moves must match the choreography: easy is more forgiving, hard less.",
  "settings.game.autoStart.label": "Start automatically",
  "settings.game.autoStart.hint": "The setup guide starts the game as soon as you are detected.",
  "settings.game.haptics.label": "Vibration",
  "settings.game.haptics.hint":
    "Short vibration on PERFECT and hit Gold Moves. Not available on iPhone.",
  "settings.audio.title": "Sound",
  "settings.audio.volume": "Volume",
  "settings.audio.percent": "{value}%",
  "settings.audio.volumeIgnoredHint":
    "On this device the slider only controls your own audio files. For audio URLs and YouTube, use the volume buttons.",
  "settings.audio.latency": "Latency compensation",
  "settings.audio.latencyHint":
    "Positive: the pictograms arrive later. This helps when Bluetooth headphones delay the sound. A sync test that measures the value will follow later.",
  "settings.audio.latencyReset": "Reset",
  "settings.display.title": "Display",
  "settings.display.skeleton.label": "Show skeleton",
  "settings.display.skeleton.hint": "Draws your detected joints over the camera image.",
  "settings.display.beatPulse.label": "Beat pulse on the edge",
  "settings.display.beatPulse.hint": "The screen edge pulses to the beat of the music.",
  "settings.display.danceVideo.label": "Show dance video",
  "settings.display.danceVideo.hint":
    "For songs with a dance video, the muted video plays instead of the stick figure.",
  "settings.display.danceVideoLarge.label": "Large dance video",
  "settings.display.danceVideoLarge.hint":
    "Shows the dance video larger in the game; it then covers more of the camera image.",
  "settings.display.danceVideoLarge.hintOff": "Only with “Show dance video”.",
  "settings.display.mirror.label": "Mirror camera image",
  "settings.display.mirror.hint": "Only the display is mirrored; scoring is not affected.",
  "settings.camera.title": "Camera",
  "settings.camera.hint": "You choose the camera in the setup guide before a song starts.",
  "settings.camera.forget": "Forget saved camera",
  "settings.storage.title": "Storage",
  "settings.storage.loading": "Checking …",
  "settings.storage.unavailable": "Not available",
  "settings.storage.usage": "{used} used of {quota}",
  "settings.storage.hint": "Songs and audio files are stored on this device only.",
  "settings.about.title": "About and credits",
  "settings.credits.linksNote": "Links open in a new tab only when you tap them.",
  "settings.licenses.summary": "License texts",
  "settings.licenses.loading": "Loading …",
  "settings.licenses.apache": "Apache License 2.0 (MediaPipe, pose models)",
  "settings.licenses.font": "SIL Open Font License 1.1 (Bricolage Grotesque)",
  "settings.licenses.bundled": "Bundled npm packages",
  "settings.licenses.bundledNone": "The package list is only generated in the production build.",

  // Spotify settings
  "settings.spotify.status.disconnected": "Not connected",
  "settings.spotify.status.connected": "Connected",
  "settings.spotify.status.expired": "Login expired, please reconnect",
  "settings.spotify.intro":
    "For Spotify songs you need Spotify Premium and your own app in the Spotify Developer Dashboard. When connecting and playing, your device talks directly to Spotify (accounts.spotify.com, api.spotify.com, sdk.scdn.co); Spotify sees your IP address. The login only lasts until you close the tab.",
  "settings.spotify.clientId": "Client ID",
  "settings.spotify.clientIdPlaceholder": "32 characters from the dashboard",
  "settings.spotify.clientIdError": "The client ID consists of 32 characters (0–9, a–f).",
  "settings.spotify.redirectLabel": "Redirect URI for the dashboard",
  "settings.spotify.redirectLocalhost":
    "Spotify does not allow “localhost”. Open the app via 127.0.0.1 instead of localhost.",
  "settings.spotify.redirectHttps":
    "Spotify requires an HTTPS address. On your phone, open the app via HTTPS.",
  "settings.spotify.status": "Status: {status}",
  "settings.spotify.connect": "Connect to Spotify",
  "settings.spotify.reconnect": "Reconnect",
  "settings.spotify.disconnect": "Disconnect",

  // Setup screen
  "settings.setup.title": "Setup guide",
  "settings.setup.intro":
    "You are about to dance to “{title}”. The camera sees you so DanceBeat can score your moves.",
  "settings.setup.step1": "Prop up your phone, for example leaning against a wall.",
  "settings.setup.step2":
    "Step back two or three paces until you are in the frame from head to toe.",
  "settings.setup.step3": "Make sure there is enough light, ideally from the front.",
  "settings.setup.startCamera": "Start camera",
  "settings.setup.motionIntro":
    "No camera: hold your phone firmly in your hand and move to the beat. You are scored on how strongly you move.",
  "settings.setup.playWithoutCamera": "Play without camera",
  "settings.setup.motionChecking": "Checking motion sensor …",
  "settings.setup.motionDenied":
    "Motion sensor not allowed. Allow access in your browser settings and try again.",
  "settings.setup.motionUnsupported": "This device has no motion sensor.",
  "settings.setup.liveVideo": "Live image from your camera",
  "settings.setup.loading": "Starting camera and detection …",
  "settings.setup.loadingSlow": "This can take a moment the first time.",
  "settings.setup.standUp": "Get in position",
  "settings.setup.standInFront": "Step in front of the camera.",
  "settings.setup.cameraStarting": "One moment, the camera is starting.",
  "settings.setup.lightHint": "More light: turn on a lamp or stand in front of a window.",
  "settings.setup.fallbackCamera": "The saved camera is not available; using the default camera.",
  "settings.setup.autoStartOn": "As soon as everything fits, it starts by itself.",
  "settings.setup.autoStartCancelled":
    "Auto-start is off because you cancelled. Tap “Let's go” when you are ready.",
  "settings.setup.tapWhenReady": "Tap “Let's go” when you are ready.",
  "settings.setup.cameraLabel": "Camera",
  "settings.setup.cameraPlaceholder": "Choose camera",
  "settings.setup.go": "Let's go",
  "settings.setup.diagToggle": "Show or hide diagnostics",

  // Camera (errors, device names)
  "settings.camera.fallbackLabel": "Camera {n}",
  "settings.camera.error.denied.title": "Camera access denied",
  "settings.camera.error.denied.hint":
    "Allow the camera in your browser settings (lock icon next to the address; on iPhone “aA” → Website Settings → Camera), then tap “Try again”.",
  "settings.camera.error.nocamera.title": "No camera found",
  "settings.camera.error.nocamera.hint":
    "Connect a camera or use a device with a front camera. Then tap “Try again”.",
  "settings.camera.error.busy.title": "Camera is already in use",
  "settings.camera.error.busy.hint":
    "Close other apps or tabs that use the camera (video call, camera app), then tap “Try again”.",
  "settings.camera.error.interrupted.title": "The camera was interrupted",
  "settings.camera.error.interrupted.hint":
    "A call or another app took over the camera. End it and tap “Restart”.",
  "settings.camera.error.insecure.title": "Camera only works over a secure connection",
  "settings.camera.error.insecure.hint":
    "Open DanceBeat via HTTPS (or localhost). On your phone: run “bun run dev:https” and open the https address.",
  "settings.camera.error.overconstrained.title": "Selected camera not available",
  "settings.camera.error.overconstrained.hint":
    "Choose another camera or tap “Try again” to use the default camera.",
  "settings.camera.error.model.title": "Detection could not be loaded",
  "settings.camera.error.model.hint":
    "When the camera starts, DanceBeat loads the detection model and runtime from the app's own address. Check your connection to the app and tap “Try again”.",
  "settings.camera.error.unknown.title": "Camera could not be started",
  "settings.camera.error.unknown.hint":
    "Reload the page and tap “Try again”. If that does not help, restart your browser.",
  "settings.camera.retryRestart": "Restart",
  "settings.camera.retry": "Try again",

  // Body tracker (hints and checklist)
  "settings.body.hint.none": "Step in front of the camera. I can't see you yet.",
  "settings.body.hint.kneesMissing": "Knees not in frame. Take a step back.",
  "settings.body.hint.feetMissing": "Feet not in frame. Take a step back.",
  "settings.body.hint.torsoMissing": "Upper body not in frame. Take a step back.",
  "settings.body.hint.near": "Take a step back.",
  "settings.body.hint.far": "Come a step closer.",
  "settings.body.hint.center": "Move to the center of the frame.",
  "settings.body.hint.ready": "All set. Let's go!",
  "settings.body.hint.hold": "Great, hold still for a moment.",
  "settings.body.row.visible": "Head to toe visible",
  "settings.body.row.feet": "Feet not in frame",
  "settings.body.row.knees": "Knees not in frame",
  "settings.body.row.torso": "Upper body not in frame",
  "settings.body.row.lightLow": "More light needed",
  "settings.body.row.light": "Enough light",
  "settings.body.row.distanceOk": "Distance is good",
  "settings.body.row.near": "Too close",
  "settings.body.row.far": "Too far away",
  "settings.body.state.ok": "OK",
  "settings.body.state.warn": "Warning",
  "settings.body.state.pending": "checking",

  // Diagnostics panel
  "settings.diag.label": "Diagnostics",
  "settings.diag.detection": "Detection",
  "settings.diag.fps": "{fps} FPS (target: over 25)",
  "settings.diag.inference": "Inference",
  "settings.diag.delegate": "Delegate",
  "settings.diag.model": "Model",

  // Privacy note
  "settings.privacy.camera":
    "Camera images never leave your device. Motion detection runs entirely on your device.",
  "settings.privacy.youtube":
    "The music comes from YouTube (script from youtube.com, video via youtube-nocookie.com); YouTube sees your IP address.",
  "settings.privacy.spotify":
    "The music comes from Spotify (script from sdk.scdn.co, login and playback via accounts.spotify.com and api.spotify.com); Spotify sees your IP address and which song you play.",
  "settings.privacy.url": "The music is loaded from {origin}; the server sees your IP address.",
  "settings.privacy.urlFallback": "the entered address",

  // Sync test screen
  "settings.sync.title": "Sync test",
  "settings.sync.intro":
    "Tap the pad or press the space bar in time with the music, exactly when you hear the beat. After {total} taps DanceBeat suggests a sync offset; the first {discard} don't count.",
  "settings.sync.savedOffset": "Saved sync offset:",
  "settings.sync.lowPrecision":
    "With {source}, timing is less precise than with an audio file. The value may vary by a few milliseconds.",
  "settings.sync.youtubeFrame": "YouTube video",
  "settings.sync.audioError": "The music could not be loaded. {error}",
  "settings.sync.stop": "Stop",
  "settings.sync.start": "Start",
  "settings.sync.loadingMusic": "Loading music …",
  "settings.sync.startBlockedYoutube": "Playback was blocked. Tap the video directly.",
  "settings.sync.startFailed": "The music could not be started. Tap “Start” again.",
  "settings.sync.toSettings": "Go to settings",
  "settings.sync.ended": "The song has ended.",
  "settings.sync.danceVideo": "Dance video",
  "settings.sync.tapArea": "Tap to the beat",
  "settings.sync.tapNow": "Tap!",
  "settings.sync.tapStartFirst": "Press “Start” first",
  "settings.sync.tapCount_one": "{count} tap",
  "settings.sync.tapCount_other": "{count} taps",
  "settings.sync.tapsLeft": " · {remaining} to go",
  "settings.sync.result": "Result",
  "settings.sync.deviationIntro":
    "Deviation of your last taps from the beat (with the current offset):",
  "settings.sync.deviationList": "Deviation per tap",
  "settings.sync.proposal": "Suggestion:",
  "settings.sync.spread_one": "Spread ±{spread} ms from {count} tap",
  "settings.sync.spread_other": "Spread ±{spread} ms from {count} taps",
  "settings.sync.uneven": "Uneven, try again.",
  "settings.sync.noTaps": "No taps yet.",
  "settings.sync.untilProposal_one": "{count} more tap until a suggestion.",
  "settings.sync.untilProposal_other": "{count} more taps until a suggestion.",
  "settings.sync.acceptProposal": "Use suggestion",
  "settings.sync.again": "Again",
  "settings.sync.fineTune": "Fine-tuning",
  "settings.sync.offset": "Offset:",
  "settings.sync.lightHint":
    "The light flashes to the beat with the current offset. If it matches the beat you hear, save.",
  "settings.sync.nudgeDec": "Decrease offset by {ms} ms",
  "settings.sync.nudgeInc": "Increase offset by {ms} ms",
  "settings.sync.saveFailed": "Saving failed. Please try again.",
  "settings.sync.resetNotice": "Sync offset set to 0 ms.",
  "settings.sync.resetToZero": "Reset to 0",

  // Audio analysis (src/lib/beat.ts)
  "settings.beat.decodeError": "This file can't be played. Please use MP3, M4A, WAV or OGG.",
} as const satisfies Record<keyof typeof deSettings, string>;
