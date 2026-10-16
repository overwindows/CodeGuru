The SKILL.md file describes a pre-commit code verification pipeline called "Pre-Commit Code Verification" that runs security scans, quality gates, and uses an independent reviewer subagent before code lands. The core principle is that no agent should verify its own work.

**Key workflow:**
1. Get the git diff
2. Run static security scans (hardcoded secrets, shell injection, dangerous eval/exec, unsafe deserialization, SQL injection)
3. Run baseline tests and linting
4. Self-review checklist
5. Independent reviewer subagent (via `delegate_task`)
6. Evaluate results
7. Auto-fix loop (max 2 cycles)
8. Commit with `[verified]` prefix if all passes

**When to use:** After implementing features or bug fixes, before `git commit`/`git push`, or when the user says "commit", "push", "ship", "done", "verify", or "review before merge".

**Skip for:** Documentation-only changes, pure config tweaks, or when the user says "skip verification".