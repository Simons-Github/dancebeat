import type { deSongs } from "../de/songs";

/** English UI strings; must have exactly the keys of the German file. */
export const enSongs = {
  // ---- Add-song dialog ----
  "songs.add.title": "Add song",
  "songs.add.description":
    "Pick the music and let the choreography be generated, import your own, or build it from a dance video.",
  "songs.add.tab.file": "File",
  "songs.add.tab.url": "URL",
  "songs.add.tab.youtube": "YouTube",
  "songs.add.tab.spotify": "Spotify",
  "songs.add.videoMusic.label": "Music from the dance video",
  "songs.add.videoMusic.hintOn":
    "The video's sound under “From video” is played. For this, the video is saved with the song on this device.",
  "songs.add.videoMusic.hintOff":
    "Turn on if the dance video already contains the music: then no separate audio file is needed.",
  "songs.add.audio.label": "Audio file",
  "songs.add.audio.readingVideo": "Reading the video's sound …",
  "songs.add.audio.analyzing": "Analyzing …",
  "songs.add.audio.idleVideo": "Pick a dance video below under “From video”.",
  "songs.add.audio.idleFile": "MP3, M4A, WAV or OGG. The file stays on this device.",
  "songs.add.audio.music": "Music: {name}",
  "songs.add.audio.videoRead": "Read the video's sound. The video takes up {size} in the library.",
  "songs.add.audio.videoTooBig":
    "The video is too large to use its music (max. {max}). Please pick the music as an audio file.",
  "songs.add.audio.videoUnreadable":
    "Can't read the video's sound. Please pick the music as an audio file.",
  "songs.add.audio.analyzeFailed": "Couldn't analyze the file.",
  "songs.add.bpm.label": "BPM",
  "songs.add.bpm.estimated": "Estimated, please check.",
  "songs.add.duration.label": "Length in seconds",
  "songs.add.duration.clamped": "The choreography covers the first {minutes} minutes.",
  "songs.add.url.label": "Audio file address",
  "songs.add.url.hint":
    "Only use your own or private sources. The music is loaded from {host} when you play.",
  "songs.add.url.hostFallback": "the given address",
  "songs.add.youtube.label": "YouTube link or video ID",
  "songs.add.youtube.hint": "The video is loaded via youtube-nocookie.com when you play.",
  "songs.add.spotify.label": "Spotify song link or URI",
  "songs.add.spotify.hint":
    "Needs Spotify Premium. When you play, your device talks to sdk.scdn.co, accounts.spotify.com and api.spotify.com.",
  "songs.add.spotify.expired": "Your Spotify login has expired.",
  "songs.add.spotify.notConnected": "Not connected to Spotify yet.",
  "songs.add.spotify.connectHint": "To play, connect it in Settings under “Spotify”.",
  "songs.add.choreo.legend": "Choreography",
  "songs.add.choreo.auto": "Generate automatically",
  "songs.add.choreo.import": "Import from file",
  "songs.add.choreo.video": "From video",
  "songs.add.keepVideo.label": "Keep video",
  "songs.add.keepVideo.tooBig":
    "The video is too large to keep (max. {max}). Please turn off “Keep video”.",
  "songs.add.keepVideo.on":
    "While playing, the video runs muted instead of the coach. For this, it is saved with the song on this device.",
  "songs.add.keepVideo.onSize":
    "While playing, the video runs muted instead of the coach. For this, it is saved with the song on this device and takes up {size} in the library.",
  "songs.add.keepVideo.off":
    "Turn on to show the video muted instead of the coach while playing. For this, it is saved with the song on this device.",
  "songs.add.import.label": "Choreography file",
  "songs.add.import.moves_one": "{count} move",
  "songs.add.import.moves_other": "{count} moves",
  "songs.add.import.readFailed": "Couldn't read the file.",
  "songs.add.field.title": "Title",
  "songs.add.field.artist": "Artist",
  "songs.add.field.difficulty": "Difficulty",
  "songs.add.difficulty.1": "1 – Easy",
  "songs.add.difficulty.2": "2 – Medium",
  "songs.add.difficulty.3": "3 – Hard",
  "songs.add.submit": "Add",
  "songs.add.saveFailed": "Couldn't save the song.",

  // ---- Field validation (newSong.ts) ----
  "songs.validate.urlHttps": "Please use an https address.",
  "songs.validate.titleRequired": "Please enter a title.",
  "songs.validate.titleMax": "The title can have at most {max} characters.",
  "songs.validate.youtube":
    "That's not a valid YouTube link. Please enter a link or an 11-character video ID.",
  "songs.validate.spotify":
    "That's not a valid Spotify song. Please enter a song link (open.spotify.com/track/…) or a Spotify URI.",
  "songs.validate.bpm": "BPM must be between {min} and {max}.",
  "songs.validate.duration": "The length must be between {min} and {max} seconds.",

  // ---- Storage / import / migration errors ----
  "songs.storage.full": "Storage is full. Delete songs or large audio files and try again.",
  "songs.import.invalidJson": "The file is not valid JSON.",
  "songs.import.invalidFile": "Invalid choreography file. {details}",
  "songs.import.fileFallback": "File",
  "songs.import.choreoMissing": "The choreography is missing or not an object.",
  "songs.import.unknownVersion": "Unknown choreography version: {version}",
  "songs.import.songNotObject": "The song entry is not an object.",
  "songs.schema.color": "Color as #RRGGBB",
  "songs.schema.framesSorted": "Frames must be sorted by timeMs",
  "songs.schema.movesSorted": "Moves must be sorted by timeMs",
  "songs.db.otherTab": "The database is open in another tab. Please close that one.",
  "songs.db.audioLocalOnly": "Audio data only belongs to local songs.",
  "songs.db.videoNeedsBlobId": "The dance video needs a videoBlobId.",
  "songs.db.notFound": "Song not found.",
  "songs.db.corrupt": "The song is damaged and can't be changed.",

  // ---- Video import ----
  "songs.video.range.invalid": "Please enter start and end in seconds.",
  "songs.video.range.endAfterStart": "The end must come after the start.",
  "songs.video.range.beyondEnd": "The end is past the end of the video.",
  "songs.video.range.tooShort": "The section must be at least {seconds} seconds long.",
  "songs.video.range.tooLong":
    "The section can be at most {minutes} minutes long. Please adjust the start or end.",
  "songs.video.range.typeBoth": "Please enter start and end in seconds, e.g. 12.5.",
  "songs.video.beatPhase.invalid": "Invalid beat phase.",
  "songs.video.build.tooFewDetections": "A person was detected in too few frames of the video.",
  "songs.video.build.tooFewMoves": "Too few usable moves in the chosen section.",
  "songs.video.build.failed": "Couldn't build a dance from the video.",
  "songs.video.err.model": "Couldn't load the pose model.",
  "songs.video.err.video": "Can't read the video.",
  "songs.video.err.timeout": "The video stopped responding (timed out while seeking).",
  "songs.video.err.range": "The chosen section is outside the video.",
  "songs.video.err.unexpected": "The analysis stopped unexpectedly.",

  // ---- Video panel ----
  "songs.video.model.lite": "Fast",
  "songs.video.model.full": "Accurate",
  "songs.video.placement.grid": "Fixed beat",
  "songs.video.placement.holds": "Hold points",
  "songs.video.beatHand": "Please enter the beat phase by hand.",
  "songs.video.beat.noneInRange": "No beat can be detected in the section. {hint}",
  "songs.video.beat.fileTooBig":
    "The video is too large for beat detection (max. {max} MB). {hint}",
  "songs.video.beat.tooLong":
    "The video is too long for beat detection (max. {minutes} minutes). {hint}",
  "songs.video.beat.noneInAudio": "No beat can be detected in the video's sound. {hint}",
  "songs.video.beat.audioFailed": "Can't analyze the video's sound. {hint}",
  "songs.video.unknownLength": "The video's length is unknown. Please pick another file.",
  "songs.video.unreadable": "Can't read the video. Please use MP4 or MOV.",
  "songs.video.file.label": "Dance video",
  "songs.video.file.hintMusic":
    "MP4 or MOV with the music as its sound. The video stays on this device and is saved as the song's music; detection runs in the browser with no external requests.",
  "songs.video.file.hintKeep":
    "MP4 or MOV, same recording as the music (from second 0). The video stays on this device and is saved with the song; detection runs in the browser with no external requests.",
  "songs.video.file.hintDiscard":
    "MP4 or MOV, same recording as the music (from second 0). The video stays on this device and is discarded after adding; detection runs in the browser with no external requests.",
  "songs.video.preview": "Video preview",
  "songs.video.loadingModel": "Loading pose model …",
  "songs.video.analyzing": "Analyzing … {progress} %",
  "songs.video.cancel": "Cancel",
  "songs.video.progress": "Analysis progress",
  "songs.video.start.label": "Start (seconds)",
  "songs.video.start.button": "From here",
  "songs.video.end.label": "End (seconds)",
  "songs.video.end.button": "To here",
  "songs.video.selfie.label": "Video is mirrored (selfie)",
  "songs.video.selfie.fromName": "Turned on because the file name suggests a mirrored video. ",
  "songs.video.selfie.hint":
    "Turn on for selfie recordings and dance practice videos with “Mirrored” in the title: left and right are already swapped there.",
  "songs.video.phase.label": "Beat phase (ms)",
  "songs.video.phase.lost":
    "The detected beat can't be calculated right now (BPM, range or music file missing). Please detect again or enter it by hand.",
  "songs.video.phase.invalid": "Please enter whole milliseconds, e.g. 0 or 250.",
  "songs.video.phase.autoMusic":
    "First beat after the start, detected from the music file. Please check in the sync test.",
  "songs.video.phase.autoVideo":
    "First beat after the start, detected from the video's sound. Please check in the sync test.",
  "songs.video.phase.manual":
    "Time of a beat in the video. Fine-tuning follows later in the sync test.",
  "songs.video.beat.detect": "Detect beat",
  "songs.video.beat.detecting": "Analyzing the sound …",
  "songs.video.model.label": "Model",
  "songs.video.model.hint":
    "Accurate detects poses more reliably, but the analysis takes longer. About 9 MB are downloaded the first time.",
  "songs.video.placement.label": "Moves",
  "songs.video.placement.hint":
    "Hold points: moves on beats where the pose briefly holds still (roughly the same number of moves).",
  "songs.video.analyze": "Analyze video",
  "songs.video.reanalyze": "Analyze again",
  "songs.video.aborted": "Analysis canceled.",
  "songs.video.stale.both": "The time range and model have changed.",
  "songs.video.stale.range": "The time range has changed.",
  "songs.video.stale.model": "The model has changed.",
  "songs.video.stale.rerun": "Please analyze the video again.",
  "songs.video.needBpm": "Please enter a valid BPM, then the moves will be built.",
  "songs.video.result.person": "Person {number} of {total}: ",
  "songs.video.result.summary":
    "{moves} moves, {gold} of them Gold Moves, person detected in {percent} % of the frames.",
  "songs.video.result.model": " Model: {model}.",
  "songs.video.result.placement": " Moves: {placement}.",
  "songs.video.persons.title": "Several people detected",
  "songs.video.persons.tap": "Tap the person whose moves you want to use.",
  "songs.video.persons.group": "Target person",
  "songs.video.persons.person": "Person {number}",
  "songs.video.persons.notFound":
    "The chosen person isn't detected in this frame. Pick a person or another frame.",
  "songs.video.persons.currentFrame": "Current frame",
  "songs.video.persons.currentFrameHint":
    "Shows the frame at the video preview's position, e.g. where the people stand well apart.",

  // ---- Audio sources ----
  "songs.audio.playRefused": "The start was blocked. Tap to start.",
  "songs.audio.urlLoadFailed":
    "Couldn't load the audio URL. Check the link and that the file is publicly reachable.",
  "songs.audio.decodeFailed": "Couldn't decode the audio file. Please use MP3, M4A, WAV or OGG.",
  "songs.audio.connectionLost": "The connection to the music was lost.",
  "songs.audio.fileMissing": "Audio file not found.",
  "songs.audio.pausedPlay": "Playback paused.",
  "songs.audio.endedPlay": "Playback ended.",
  "songs.audio.youtube.loadOffline": "Couldn't load YouTube. Are you online?",
  "songs.audio.youtube.load": "Couldn't load YouTube.",
  "songs.audio.youtube.noEmbed": "This video can't be embedded.",
  "songs.audio.youtube.unavailable": "YouTube video unavailable.",
  "songs.audio.youtube.videoTimeout":
    "The YouTube video won't load. Check the link and connection.",
  "songs.audio.youtube.rate": "This video can't be played at {rate}× speed. Set the editor to 1×.",
  "songs.audio.youtube.notLoaded": "The YouTube player hasn't loaded yet.",
  "songs.audio.youtube.blocked": "YouTube blocked the start. Tap to start.",
  "songs.audio.spotify.loadOffline": "Couldn't load Spotify. Are you online?",
  "songs.audio.spotify.load": "Couldn't load Spotify.",
  "songs.audio.spotify.accountError": "Spotify Premium is required to play in the browser.",
  "songs.audio.spotify.authError": "Spotify login expired. Please reconnect in Settings.",
  "songs.audio.spotify.initError": "Your browser doesn't support Spotify playback.",
  "songs.audio.spotify.playbackError": "Spotify couldn't play the song.",
  "songs.audio.spotify.blocked": "Spotify blocked the start. Tap to start.",
  "songs.audio.spotify.playerTimeout": "The Spotify player won't load. Check your connection.",
  "songs.audio.spotify.connectFailed": "The Spotify player couldn't connect.",
  "songs.audio.spotify.connectionLost": "The connection to Spotify was lost.",
  "songs.audio.spotify.notLoaded": "The Spotify player hasn't loaded yet.",
  "songs.audio.spotify.notReady": "The Spotify player isn't ready.",
  "songs.audio.spotify.resumeFailed": "Spotify couldn't resume playback.",
  "songs.audio.spotify.unreachable": "Can't reach Spotify. Are you online?",
  "songs.audio.spotify.startFailed": "Spotify couldn't start the song (HTTP {status}).",

  // ---- Spotify login ----
  "songs.spotify.noLocalhost": "Spotify doesn't allow “localhost”. Open the app via 127.0.0.1.",
  "songs.spotify.needsHttps": "Spotify requires an HTTPS address.",
  "songs.spotify.badClientId": "The client ID is invalid.",
  "songs.spotify.loginFailed": "Spotify login failed.",
  "songs.spotify.denied": "You declined the connection with Spotify.",
  "songs.spotify.noLogin": "Spotify didn't return a login.",
  "songs.spotify.stateMismatch": "The login doesn't match this session. Please connect again.",
  "songs.spotify.expired": "Your Spotify login has expired. Please reconnect in Settings.",
  "songs.spotify.connectFirst": "Please connect to Spotify in Settings first.",
} as const satisfies Record<keyof typeof deSongs, string>;
