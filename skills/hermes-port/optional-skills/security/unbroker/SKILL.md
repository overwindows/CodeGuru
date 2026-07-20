# unbroker

**Description:** Autonomous CLI tool that finds and removes personal information from data brokers and people-search sites.
**Platforms:** linux, macos | **Category:** security

## Overview

`unbroker` operates in two phases: Phase 1 (crawl/discover) and Phase 2 (delete/opt-out), following a strict autonomy contract that minimizes human touchpoints after initial consent.

## Key Capabilities

- Multi-phase operation: discover listings, then delete them
- Supports various email modes (browser, SMTP/IMAP, agentmail)
- Cloud browser integration for CAPTCHA handling
- People-search broker database with ownership clusters
- CA DROP request for California residents (deletes from ~545 brokers at once)
- Ledger-based state tracking with recheck scheduling

## Workflow

1. `$PDD setup --auto` - autonomous configuration
2. `$PDD intake --full-name "..." --consent` - create subject with recorded consent
3. Loop `$PDD next <subject>` - execute ordered actions (scan, opt-out, verify)
4. `$PDD tasks <subject>` - present human digest at end
5. Schedule cron for recurring re-scans

## Important Rules

- No action without recorded consent
- Never disclose more than broker already shows
- Parents first for ownership clusters (PeopleConnect, Whitepages, etc.)
- Delete beats suppression except for PeopleConnect (deleting removes suppressions)
- Confirmed_removed only after verifying re-scan