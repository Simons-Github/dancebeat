export type CameraErrorKind =
  "denied" | "nocamera" | "busy" | "insecure" | "overconstrained" | "model" | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  title: string;
  /** What the player can do about it. */
  hint: string;
}

const ERRORS: Record<CameraErrorKind, Omit<CameraError, "kind">> = {
  denied: {
    title: "Kamera-Zugriff verweigert",
    hint: "Erlaube die Kamera in den Browser-Einstellungen (Schloss-Symbol neben der Adresse) und tippe dann auf „Erneut versuchen“.",
  },
  nocamera: {
    title: "Keine Kamera gefunden",
    hint: "Schließe eine Kamera an oder nutze ein Gerät mit Frontkamera. Dann tippe auf „Erneut versuchen“.",
  },
  busy: {
    title: "Kamera wird bereits verwendet",
    hint: "Schließe andere Apps oder Tabs, die die Kamera nutzen (Videoanruf, Kamera-App), und tippe auf „Erneut versuchen“.",
  },
  insecure: {
    title: "Kamera nur über eine sichere Verbindung",
    hint: "Öffne DanceBeat über HTTPS (oder localhost). Auf dem Handy: „bun run dev:https“ starten und die https-Adresse öffnen.",
  },
  overconstrained: {
    title: "Gewählte Kamera nicht verfügbar",
    hint: "Wähle eine andere Kamera aus oder tippe auf „Erneut versuchen“, um die Standardkamera zu nutzen.",
  },
  model: {
    title: "Erkennung konnte nicht geladen werden",
    hint: "Beim ersten Start braucht DanceBeat eine Internetverbindung (Erkennungsmodell und Laufzeit). Prüfe die Verbindung und tippe auf „Erneut versuchen“.",
  },
  unknown: {
    title: "Kamera konnte nicht gestartet werden",
    hint: "Lade die Seite neu und tippe auf „Erneut versuchen“. Hilft das nicht, starte den Browser neu.",
  },
};

export const cameraError = (kind: CameraErrorKind): CameraError => ({
  kind,
  ...ERRORS[kind],
});

const nameOf = (e: unknown): string =>
  e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";

/** Maps a getUserMedia failure to a German message with advice. */
export function mapCameraError(e: unknown): CameraError {
  switch (nameOf(e)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return cameraError("denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
      return cameraError("nocamera");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return cameraError("busy");
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return cameraError("overconstrained");
    case "SecurityError":
      return cameraError("insecure");
    default:
      return cameraError("unknown");
  }
}

/** True when the failure means the requested deviceId is stale (stored camera was unplugged). */
export const isStaleCameraError = (e: unknown): boolean =>
  nameOf(e) === "OverconstrainedError" || nameOf(e) === "ConstraintNotSatisfiedError";

/** Null when the camera API is usable, otherwise the matching error. */
export function checkCameraSupport(): CameraError | null {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return cameraError("insecure");
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return cameraError(
      typeof window !== "undefined" && window.isSecureContext ? "nocamera" : "insecure",
    );
  }
  return null;
}
