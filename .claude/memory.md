# Memory

## Now
- **v2.0.5 LIVE auf master (062126)**: Lernende Translator-Regeln + Build-Zeit-Secret-Injektion. commit 5b279f7, Tag v2.0.5, Release alle 8 Assets (Win Setup+portable, Mac dmg/zip x64+arm64). Lern-Loop: Nutzer bewertet Stellen im chatpro-ops Training-Tab → Opus destilliert Regeln → Overlay zieht freigegebene Regeln via /api/training/rules/active in den Generate-Prompt (fehlersicher: ops down = Translator läuft normal weiter).
- **Secrets nicht mehr hartcodiert (v2.0.5)**: RULES_KEY/OPS_LOG_KEY werden beim Build aus Env-Vars injiziert (scripts/gen-secrets.js → gitignored src/secrets.js; Mac-CI via GitHub-Repo-Secrets). Build OHNE Env = leere Keys. LOG_KEY(Railway)=OPS_LOG_KEY(Overlay), gleicher Wert. Auto-Memory project_overlay_secret_injection. OFFEN: OPS_LOG_KEY rotieren (alte Commits/Binaries).
- **Kostenanalyse (062026)**: $200-Anthropic-Limit gerissen, aber NICHT durch adaptive Thinking (Output, ~20% der Rechnung). Treiber: Overlay-Produktion + chatpro-ops (~$50/Mt) + eigener Claude-Code-Dev-Verbrauch. Thinking bleibt bewusst drin. Hebel falls nötig: Batch-API auf ops-Tageslauf-QA (flat 50%, asynchron, gleiche Qualität). Caching greift nur bei Prefix ab 4096 Token + Wiederholung in 5min → ops-Prompts zu kurz, Overlay cached schon.
- **Admin-API-Schutz erledigt (061026)**: adminAuth auf 7 User-Endpoints, ChatPro-Max/main. BEIDE Railway-Services (Master + Agentur) deployen aus diesem Repo mit Auto-Deploy. Auto-Memory project_railway_backend_topology.
- **Agentur (chatpro-j) auf v2.0.1-agency**: v2.0.x + Lern-Loop + Secret-Injektion NICHT portiert; Neubau braucht eigene Env-Secrets. Auto-Memory project_chatpro_j_agency.
- **Fable 5**: claude-fable-5 GA seit 09.06., $10/$50 (2x Opus 4.8). Bewusst NICHT umgestellt. Bei Modellfragen claude-api-skill/Live-Quelle prüfen.

## Projekt
- **Name**: ChatPro Overlay
- **Stack**: Electron 28, JavaScript, electron-builder, Railway-Backend
- **Produktion**: 10+ Chatter täglich, 24/7-Betrieb → Stabilität ist kritisch
- **Aktuelle Version**: v2.0.5 (Agentur: v2.0.1-agency)
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
- Modellwahl über Qualität, nicht Preis (Translator revenue-kritisch)

## Blockers / Offene Threads
- Chatter auf v2.0.5 updaten → dann Lern-Loop end-to-end prüfen (Training-Tab bewerten → freigeben → Testregel im Generate-Prompt sichtbar)
- OPS_LOG_KEY rotieren (alte Commits + Binaries vor v2.0.5)
- Lern-Loop nach chatpro-j portieren wenn validiert (Agentur-Neubau braucht eigene Env-Secrets)
- Schulungs-Konzept vom User ausstehend
- Mac-Gatekeeper/Accessibility bleiben (kein Apple Dev Account)

## KRITISCHE ARBEITSREGELN
- **Nichts implementieren ohne explizite Freigabe** vom User
- **Keinen Code löschen** der gerade debuggt wurde → immer nachfragen
- **Scope halten**: nur tun was besprochen wurde, keine Eigeninitiative bei neuen Features
- Bei Unsicherheit: fragen, nicht raten
