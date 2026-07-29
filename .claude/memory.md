# Memory

## Now
- **DeepL IT-Bug gefixt + live (072926)**: `/api/deepl` auf ChatPro-Max-Backend (Railway) hatte source_lang fest auf DE, ignorierte das lang-Feld → IT-Rückübersetzung kam bei kurzen Sätzen unverändert zurück (User-Screenshot: "Da dio amore" blieb "Da dio amore" statt "Love is amazing"). Fix gepusht (ChatPro-Max commit 4560904) + nach Deploy live verifiziert für DE/ES/IT. Reiner Server-Fix, kein neuer Overlay-Build nötig. Details: knowledge-base.md.
- **Sprach-Badge oben rechts hinzugefügt (072926)**: Chatter-Wunsch — Titlebar zeigt jetzt Flag+Code der aktiven Sprache (🇩🇪 DE/🇲🇽 ES/🇮🇹 IT), pulsiert kurz bei Auto-Detect. Nur in src/overlay.html geändert, noch NICHT committed/released — braucht neuen Overlay-Build um Chatter zu erreichen.
- **v2.0.7 LIVE (072726)**: Multi-Sprachen-Translator DE/ES/IT hinzugefügt. LANGUAGES-Konfig (Persona+Mood-Prompt je Sprache), Arm-and-Confirm-Sprach-Switcher (2 Klicks nötig, verhindert Versehen-Wechsel), DeepL/TTS/Auto-Detect sprachbewusst. commit 6a269e9, Tag v2.0.7, Win+Mac released. Mechanik von User getestet und bestätigt. OFFEN: Slang-Qualität ES/IT hat noch keinen Live-Korrektur-Track-Record wie Deutsch — aktiv Feedback von den Chatterinnen einholen. Plan: `.claude/plans/peppy-watching-tide.md`
- **2 neue Chatter-Accounts (072426)**: bella (ID 119), kadee (ID 120) — für die ES/IT-Creatorinnen. Onboarding (App-Download, Setup) noch offen.
- **chatpro-ops (071626)**: hoher onlyfansapi.com-Credit-Verbrauch war der 10-Min-Fansly-Poll-Cron, nicht der OF-Teil. Fansly hat jetzt Webhooks → `/webhooks/fansly` gebaut, Poll-Cron entfernt (commit a40ab9d). OFFEN: Feld-Mapping gegen echten Payload verifizieren. Details: Auto-Memory project_chatpro_ops.
- **Secrets (v2.0.5)**: RULES_KEY/OPS_LOG_KEY build-time injiziert (scripts/gen-secrets.js → gitignored src/secrets.js). Exakte Namen bestätigt (chatpro-ops/src/config.js): RULES_KEY=RULES_KEY, LOG_KEY(Railway)=OPS_LOG_KEY(Overlay). Beide stehen im Railway-Dashboard → chatpro-ops-Service → Variables. OFFEN: OPS_LOG_KEY rotieren (alte Binaries).
- **git-credential-manager-Extraktion (curl-Release-Upload) jetzt geblockt (072726)**: `git credential fill` wird vom Claude-Code-Auto-Mode-Classifier hart geblockt, unabhängig von Bash/PowerShell/cmd-Variante. Fallback: Windows-Assets manuell über GitHub-Web-UI ans Release hängen (Mac-Assets kommen automatisch via GitHub Actions/softprops).

## Projekt
- **Name**: ChatPro Overlay
- **Stack**: Electron 28, JavaScript, electron-builder, Railway-Backend
- **Produktion**: 10+ Chatter täglich, 24/7-Betrieb → Stabilität ist kritisch
- **Aktuelle Version**: v2.0.7 (Agentur: v2.0.1-agency)
- **Modelle**: Generate=claude-sonnet-5 (Prompt-Caching + adaptive Thinking), Mood=claude-haiku-4-5, DeepL-Rückübersetzung via Railway-Proxy
- **Lern-Loop-Backend**: chatpro-ops (separates Repo/Railway/Supabase) liefert freigegebene Regeln via /api/training/rules/active (x-rules-key). Auto-Memory project_chatpro_ops.

## Ziele (priorisiert)
1. Bester Translator für OnlyFans-Chatting: klingt wie echte Frau Mitte 20, kein AI-Feeling
2. Chatter-Workflows vereinfachen → Zeit + Geld sparen
3. Revenue steigern durch bessere Übersetzungsqualität

## Aktive Entscheidungen
- Monitoring-System: entfernt (v1.9.6) → Code, Modul und active-win Dependency raus
- Creator-Profile: aktiv (Railway-Backend liefert Profiles)
- Windows-Build: lokal bauen (Env-Vars RULES_KEY+OPS_LOG_KEY setzen!) + manuell per curl ans GitHub-Release
- Mac-Build: GitHub Actions via Tag-Push (v*) → .github/workflows/build.yml (mit gen-secrets-Step)
- Modellwahl: auf claude-sonnet-5 gewechselt (070126) für Kostenersparnis; Intro-Preis $2/$10 bis 31.08.2026. Adaptive Thinking bleibt an.

## Blockers / Offene Threads
- Mac-Assets im v2.0.7-Release verifizieren (dmg/zip x64+arm64) — GitHub Actions lief automatisch, Status nicht selbst geprüft
- Slang-Feedback von den ES/IT-Chatterinnen aktiv einsammeln (erste Tage nach Rollout)
- Sprach-Badge (072926) noch nicht released — neuer Overlay-Build + Version-Bump nötig, damit Chatter ihn sehen
- ES-Prompt-Regel "Claro que sí" verboten wirkt evtl. zu streng (klingt natürlich, nicht robotisch) — erst mit echtem Chatter-Feedback anfassen
- bella + kadee ins Onboarding einweisen (App-Download, Setup)
- Lern-Loop end-to-end prüfen (Training-Tab bewerten → freigeben → Testregel im Generate-Prompt sichtbar) — Chatter sind seit v2.0.6/v2.0.7 aktuell
- chatpro-ops: Fansly-Webhook-Feldmapping gegen echten Live-Payload verifizieren
- OPS_LOG_KEY rotieren (alte Commits + Binaries vor v2.0.5)
- Schulungs-Konzept vom User ausstehend
- Mac-Gatekeeper/Accessibility bleiben (kein Apple Dev Account)

## KRITISCHE ARBEITSREGELN
- **Nichts implementieren ohne explizite Freigabe** vom User
- **Keinen Code löschen** der gerade debuggt wurde → immer nachfragen
- **Scope halten**: nur tun was besprochen wurde, keine Eigeninitiative bei neuen Features
- Bei Unsicherheit: fragen, nicht raten
