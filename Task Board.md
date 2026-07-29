# Task Board

## Today
- [ ] Mac-Assets im v2.0.7-Release verifizieren (dmg/zip x64+arm64) — GitHub Actions lief automatisch, Status noch nicht selbst geprüft
- [ ] bella + kadee ins Chatter-Onboarding einweisen (App-Download, Setup, v2.0.7-Installer) — Accounts stehen
- [ ] Slang-Feedback von bella/kadee (bzw. den ES/IT-Creatorinnen) aktiv einholen, sobald sie live chatten

## This Week
- [ ] Neuen Overlay-Build releasen (Sprach-Badge-Feature oben rechts) — nur in src/overlay.html geändert, noch nicht committed/getaggt
- [ ] Lern-Loop end-to-end prüfen (Training-Tab bewerten → freigeben → Testregel im Generate-Prompt sichtbar) — Chatter sind seit v2.0.6/v2.0.7 aktuell
- [ ] chatpro-ops: Fansly-Webhook-Feldmapping (`storeFanslyMessage`) gegen echten Payload verifizieren, sobald erste Live-Nachricht durchkommt
- [ ] OPS_LOG_KEY rotieren (Railway + GitHub-Secret + lokale Env)
- [ ] ChatPro J: optional eigenes Agentur-Icon einbauen (braucht `.ico` + `.png` von der Agentur) + Mac-Gatekeeper-Anleitung (`xattr -dr com.apple.quarantine`) an die Chatter geben
- [ ] ChatPro J: Übergabe-Dokument (Login-Daten + Download-Links + Setup-Schritte) für die Agentur erstellen
- [ ] Translator-Qualität Sonnet 5 vs. Opus 4.8 im echten Chat-Betrieb beobachten (ab v2.0.6)
- [ ] Token-Kosten in Console prüfen — reale Sonnet-5-Kosten validieren (Schätzung ~$50-70/Monat bei Intro-Preis)
- [ ] Chatter-Feedback zu v1.9.6 + v2.0.0 einsammeln (Mac-Setup, Translator-Stil)
- [ ] Schulungs-Konzept vom User einfordern + Schulungs-Feature
- [ ] Translator-Qualität weiterentwickeln (nach stabilem v2.0.x)

## Backlog
- [ ] ADMIN_KEY evtl. rotieren (wurde 072426 im Klartext-Chat übermittelt, um bella/kadee-Accounts per curl anzulegen)
- [ ] Icon-Assets in Git prüfen (assets/icon.* fehlen)
- [ ] Apple Developer Account (99 €/Jahr) evaluieren: würde Gatekeeper + Accessibility komplett eliminieren
- [ ] Ungenutzte Dependencies entfernen: `axios`, `electron-store`, `node-machine-id` (nirgends mehr referenziert nach v1.9.6)

## Done
<!-- Freitag 072426 geleert. Vollstaendige Historie in Daily Notes/. -->
- [x] 072426: 2 neue Chatter-Accounts angelegt via `POST /api/users/create` — bella (ID 119), kadee (ID 120), Passwörter ausgegeben
- [x] 072726: Multi-Sprachen-Translator (DE/ES/IT) gebaut + released als v2.0.7 (commit 6a269e9). Arm-and-Confirm-Sprach-Switcher, DeepL/TTS/Auto-Detect sprachbewusst. User hat Mechanik selbst getestet und bestätigt. Win-Installer + portable + Mac dmg/zip hochgeladen
- [x] 072926: DeepL-IT-Bug gefixt — ChatPro-Max `/api/deepl` erzwang source_lang=DE, ignorierte lang-Feld. Live reproduziert, Fix isoliert getestet, gepusht (commit 4560904), nach Deploy für DE/ES/IT live verifiziert
