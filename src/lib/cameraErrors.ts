import { t } from "@/lib/i18n";

export type CameraErrorKind =
  | "denied"
  | "nocamera"
  | "busy"
  | "interrupted"
  | "insecure"
  | "overconstrained"
  | "model"
  | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  title: string;
  /** What the player can do about it. */
  hint: string;
}

/** Builds the (translated, current language) error for `kind`. */
export const cameraError = (kind: CameraErrorKind): CameraError => ({
  kind,
  title: t(`settings.camera.error.${kind}.title`),
  hint: t(`settings.camera.error.${kind}.hint`),
});

const nameOf = (e: unknown): string =>
  e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";

/** Maps a getUserMedia failure to a translated message with advice. */
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

/**
 * True when no camera may be opened at all (permission, insecure context). Then trying another
 * camera is pointless; every other failure may be specific to the requested device.
 */
export const isPermissionError = (e: unknown): boolean =>
  ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(nameOf(e));

export const isOverconstrained = (e: unknown): boolean =>
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
