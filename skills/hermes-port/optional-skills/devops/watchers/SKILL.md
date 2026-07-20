# Watchers Skill Documentation

**Overview:** Poll external sources on an interval and react only to new items using three ready-made scripts with shared watermark deduplication.

**Three Ready-Made Scripts:**

| Script | Watches | Dedup Key |
|--------|---------|-----------|
| `watch_rss.py` | RSS 2.0 or Atom feeds | `<guid>` / `<id>` |
| `watch_http_json.py` | JSON endpoints returning lists | Configurable field |
| `watch_github.py` | GitHub issues/PRs/releases/commits | `id` / `sha` |

**Key Behaviors:**

- First run establishes baseline (never replays existing items)
- Watermark capped at 500 IDs to bound memory
- Empty stdout on no-new-items (caller treats silence as success)
- Non-zero exit on fetch errors
- State files stored in `$HERMES_HOME/watcher-state/<name>.json`

**Example Usage:**

```bash
python $HERMES_HOME/skills/devops/watchers/scripts/watch_rss.py \
  --name hn --url https://news.ycombinator.com/rss --max 5

python $HERMES_HOME/skills/devops/watchers/scripts/watch_github.py \
  --name hermes-issues --repo NousResearch/hermes-agent --scope issues
```

**Common Pitfalls:**

1. Printing "no new items" headers — scripts should output nothing when unchanged
2. Expecting first run to emit items — it only records baseline
3. Unbounded watermark growth — shared helper enforces 500 ID cap
4. Writing state to non-writable paths — use `$HERMES_HOME/watcher-state/`