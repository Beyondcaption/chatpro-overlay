# Knowledge Base

System-wide learned rules. Read by ALL agents and sessions at startup.
Written ONLY by the sentinel after confirming learnings.
Entries are mandatory constraints, not suggestions.

## Source Priority
Every entry MUST cite its source using one of:
- `[Source: user override MMDDYY]` — User explicitly corrected something
- `[Source: empirical MMDDYY]` — Verified through testing or data
- `[Source: agent inference MMDDYY]` — Pattern observed by an agent, confirmed by sentinel

## Hard Rules
- [042026] In Electron overlay.html init(), register IPC listeners (onSetDeText, onOverlayShown) BEFORE any await — events arrive the moment the overlay is shown; blocking on await fetchProfiles() causes them to be missed. [Source: empirical 042026]
- [042026] suppressAutoDetect after any clipboard copy (IPC copy-to-clipboard) must be 500ms, not higher. 2000ms blocks the next real fan message if copied quickly. The primary guard against re-trigger is `lastClipboard === text` (IPC always updates it); 500ms is only backup. [Source: empirical 042026, confirmed 042126]

## Platform & Tool Rules
- [042026] Node.js fetch() in Electron 28 main process hangs indefinitely even when the server responds in <1s — always use https.get + req.setTimeout() for IPC handlers in main.js. [Source: empirical 042026]
- [042026] DeepL Pro key (no :fx suffix) must use https://api.deepl.com/v2/translate — api2.deepl.com times out and api-free.deepl.com returns "wrong endpoint" error. [Source: empirical 042026]

## Project Patterns
- (none yet)

## Known Failure Modes
- (none yet)
