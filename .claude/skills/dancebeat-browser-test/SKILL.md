---
name: dancebeat-browser-test
description: Browser-Tests von DanceBeat mit dem projektlokalen Playwright-MCP-Server (dancebeat-playwright, Fake-Kamera). Vor jedem Test im Playwright-Browser laden.
---

# Browser-Tests mit Playwright MCP

Projektlokal in `.mcp.json` (Version fest), Konfiguration in `.claude/playwright-mcp.json`:
headless Chromium, isoliertes Profil, Fake-Kamera (640×480) mit erteilter Kamera-Berechtigung.

Der Server heißt **`dancebeat-playwright`**, seine Tools tragen das Präfix
`mcp__dancebeat-playwright__*`. Tools mit dem Präfix `mcp__playwright__*` oder
`mcp__plugin_playwright_*` stammen nicht aus diesem Projekt (globales Plugin oder fremder
Server): nicht verwenden, den Nutzer informieren.

- Vorher `bun run dev` starten und `http://localhost:5173` öffnen. Nur localhost und 127.0.0.1
  sind erlaubt; andere Origins blockiert der Browser (`ERR_BLOCKED_BY_CLIENT`). MediaPipe kommt
  seit Etappe 7b-1 von localhost, CDN-Freigaben sind dafür nicht mehr nötig. Die Sperre ist eine
  Schutzhilfe, keine Sicherheitsgrenze.
- **Vor jedem Test mit Kamera** per `ps aux | grep -i playwright` prüfen, dass der laufende
  Playwright-Chromium headless läuft und die Flags `--use-fake-device-for-media-stream` und
  `--use-fake-ui-for-media-stream` trägt, und dass der MCP-Server der projektlokale aus `.mcp.json`
  ist (`@playwright/mcp@0.0.83` mit `--config .claude/playwright-mcp.json`), nicht ein globaler.
- `getUserMedia` niemals direkt aufrufen, um die Konfiguration zu prüfen (es könnte die echte
  Kamera öffnen). Die Flag-Prüfung per `ps` ist der einzige Weg.
- Fehlen Flags oder ist ein Browserfenster sichtbar: Test abbrechen, den Nutzer informieren und
  nichts anklicken.
- Nach jeder Änderung an `.claude/playwright-mcp.json` den MCP-Server neu starten (`/mcp`).
- Screenshots und Snapshots nach dem Test löschen (Ausgabeordner `.playwright-mcp/` liegt im
  Arbeitsverzeichnis der Sitzung, kann also auch außerhalb des Repos landen).
- Jeden Screen in Hochformat 390×844 (Standard) und Querformat 844×390 (`browser_resize`)
  prüfen, per Snapshot und bei Layoutfragen per Screenshot.
- Nach jeder Navigation und Interaktion `browser_console_messages` lesen; Fehler und Warnungen
  aus eigenem Code müssen vor dem Commit weg. Erwartet und kein eigener Fehler: die
  CSP-Meldungen zu `odml.pa.googleapis.com` (gesperrte MediaPipe-Telemetrie, siehe
  [docs/architecture.md](../../../docs/architecture.md#externe-abrufe)).
- Ausgaben landen in `.playwright-mcp/` (ignoriert). Echte Kamera, Audio-Latenz und iOS bleiben
  Gerätetests.
