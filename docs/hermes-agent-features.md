# Hermes Agent Learning Features - CodeGuru Port

*July 2026*

This document describes the learning features ported from Hermes Agent to CodeGuru, enabling self-improving AI assistance with persistent memory, autonomous skill management, and background curation.

---

## Overview

The implementation follows Hermes Agent's key patterns while maintaining backward compatibility with existing CodeGuru users:

- **File-based memory remains the default** - no changes required for existing users
- **SQLite FTS5 is opt-in** - enabled via settings for fast cross-session search
- **Feature flags control each feature independently**

---

## 1. MemoryProvider Plugin Architecture

### What It Does
Provides a pluggable memory backend system supporting multiple providers (file-based, SQLite, future cloud backends).

### Key Files
- `src/memdir/providers/types.ts` - MemoryProvider interface
- `src/memdir/providers/MemoryProviderRegistry.ts` - Provider registration
- `src/memdir/providers/FileMemoryProvider.ts` - File-based implementation (default)
- `src/memdir/MemoryManager.ts` - Provider orchestration

### Architecture
```
MemoryProvider (interface)
├── FileMemoryProvider  (isExternal=false, default)
└── SqliteMemoryProvider (isExternal=true, opt-in)
```

### Usage
Memory operations automatically route to the active provider. No user-facing changes.

---

## 2. SQLite FTS5 Full-Text Search

### What It Does
Provides fast, BM25-ranked full-text search across all memory entries, with search results that persist across sessions.

### Key Files
- `src/memdir/providers/SqliteMemoryProvider.ts`
- `src/memdir/providers/schema.sql`

### Enabling
Add to `~/.codeguru/settings.local.json`:

```json
{
  "memoryProvider": "sqlite"
}
```

### Features
- **FTS5 virtual tables** for fast full-text search
- **BM25 ranking** for relevance scoring
- **WAL mode** for concurrent access
- **Snippet extraction** with highlighted matches
- **Skill lifecycle tracking** tables built-in

### Tables Created
- `memories` - Core memory storage
- `memories_fts` - FTS5 full-text search index
- `skill_usage` - Skill invocation tracking
- `skill_states` - Skill lifecycle states
- `skill_improvements` - Skill improvement history

---

## 3. Skill Lifecycle States

### What It Does
Tracks skills through states: `active`, `archived`, `developing`. Automatically filters archived skills from loading.

### Key Files
- `src/skills/skillStates.ts` - State types and interfaces
- `src/skills/SkillLifecycleManager.ts` - State management

### States
| State | Description |
|-------|-------------|
| `active` | Normal skill, available for use |
| `archived` | Removed from loading, preserved for reference |
| `developing` | New skill, work in progress |

### Archive Reasons
- `unused` - Not used for 90+ days
- `superseded` - Replaced by a better skill
- `broken` - Consistently fails
- `manual` - User explicitly archived
- `consolidated` - Merged into another skill

### Metadata Location
`.codeguru/skills/.metadata/<skill-name>.json`

### What Changes
- Archived skills no longer appear in `/skills` list
- Usage counts and last-used timestamps are tracked
- Improvements applied counter tracks skill refinement

---

## 4. CuratorAgent - Background Skill Maintenance

### What It Does
Runs after long sessions to:
- Archive skills unused for 90+ days
- Identify skill consolidation opportunities
- Log improvement suggestions

### Key Files
- `src/skills/CuratorAgent.ts`

### Enabling
Feature flag: `tengu_curator_agent`

Set in environment or via GrowthBook feature flag.

### Behavior
- **Fire-and-forget** - runs after session ends, doesn't block
- **Uses forked agent pattern** - shares prompt cache with main session
- **Only runs on main thread** - skipped for subagents
- **Configurable threshold** - defaults to 90 days unused

### Tasks
1. Archive unused skills (with reason `unused`)
2. Identify consolidation opportunities
3. Log events for analytics

---

## 5. Autonomous Skill Creation

### What It Does
Detects skill-worthy patterns from session behavior and suggests creating new skills.

### Key Files
- `src/skills/AutonomousSkillCreation.ts`

### Enabling
Feature flag: `tengu_autonomous_skills`

### Flow
1. Pattern detection during extraction/dream agents
2. Records skill creation suggestions
3. User prompted at session end with suggestions
4. User approves → skill created in `developing` state

### Suggestion Interface
```typescript
interface SkillCreationSuggestion {
  id: string
  pattern: string
  description: string
  exampleUsage?: string
  confidence: 'low' | 'medium' | 'high'
}
```

---

## 6. Skill Self-Improvement Tracking

### What It Does
Tracks user corrections and preferences during skill execution, applies improvements automatically.

### Key Files
- `src/utils/hooks/skillImprovement.ts` (existing, enhanced)
- `src/skills/SkillLifecycleManager.ts` - `recordImprovement()`

### Enabling
Existing `SKILL_IMPROVEMENT` feature flag + `tengu_copper_panda`

### Flow
1. Every 5 user messages, analyzes recent conversation
2. Detects preferences/corrections relevant to skill execution
3. Stores improvement suggestions in appState
4. User approves via UI → skill file updated automatically
5. `improve mentsApplied` counter incremented in lifecycle manager

### Improvement Tracking
Each improvement records:
- Section modified
- Change made
- Reason (which user message prompted it)
- Timestamp

---

## 7. Integration Points

### Modified Files
| File | Change |
|------|--------|
| `src/main.tsx` | Initialize memory system, curator agent, autonomous skill creation |
| `src/skills/loadSkillsDir.ts` | Filter archived skills, check lifecycle state |
| `src/tools/SkillTool/SkillTool.ts` | Record usage via SkillLifecycleManager |
| `src/query/stopHooks.ts` | Run curator agent after sessions |
| `src/utils/hooks/skillImprovement.ts` | Track improvements in lifecycle manager |

---

## Feature Flags Summary

| Flag | Purpose | Default |
|------|---------|---------|
| `EXTRACT_MEMORIES` | Enable memory extraction | On (existing) |
| `tengu_curator_agent` | Enable curator agent | Off |
| `tengu_autonomous_skills` | Enable autonomous skill creation | Off |
| `SKILL_IMPROVEMENT` + `tengu_copper_panda` | Enable skill self-improvement | Off |

---

## Backward Compatibility

### Existing Users
- **No changes required** - file-based memory remains default
- Existing skills continue to work unchanged
- Archived skills feature only activates for NEW skills tracked

### Existing Memory Files
- All `~/.codeguru/memory/` files remain readable
- `MEMORY.md` format unchanged
- Migration not required

### Settings
```json
{
  "memoryProvider": "file"  // Default, or "sqlite" for FTS5
}
```

---

## Future Enhancements

Potential areas for expansion:
1. **LLM re-ranking** for memory search relevance
2. **Cloud memory providers** (remote sync)
3. **Skill effectiveness scoring** based on success rate
4. **Auto-promotion** of developing skills after user approval
5. **Cross-session skill learning** from usage patterns

---

## Technical Notes

### Forked Agent Pattern
CuratorAgent and extractMemories use `runForkedAgent()` which:
- Shares parent's prompt cache for efficiency
- Runs in isolated subagent context
- Reports usage metrics separately

### Single External Provider
The architecture enforces exactly ONE external provider (like SQLite) at a time. This prevents conflicts between multiple backends trying to own the same memory namespace.

### Lifecycle State Isolation
Archived skills:
- Are filtered at load time (not deleted)
- Preserve metadata for potential restoration
- Can be restored via `SkillLifecycleManager.restoreSkill()`

---

## Debugging

### Check Skill States
```bash
ls ~/.codeguru/skills/.metadata/
cat ~/.codeguru/skills/.metadata/<skill-name>.json
```

### Enable Debug Logging
The `logForDebugging` function prefix logs with `[SkillLifecycleManager]`, `[CuratorAgent]`, etc.

### Provider Status
Check initialization in startup logs for:
```
[SqliteMemoryProvider] Initialized at ...
[SkillLifecycleManager] Initialized
[CuratorAgent] initialized (enabled=...)
```