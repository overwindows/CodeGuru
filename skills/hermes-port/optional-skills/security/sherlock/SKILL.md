# Sherlock OSINT Username Search Skill

**Name:** sherlock
**Description:** OSINT username search across 400+ social networks.
**Platforms:** linux, macos, windows

## When to Use

- Finding accounts associated with a username
- Checking username availability across platforms
- Conducting OSINT or reconnaissance research

## Requirements

- Sherlock CLI installed: `pipx install sherlock-project` or `pip install sherlock-project`
- Docker available (optional alternative)

## Procedure

1. **Verify installation:** `sherlock --version`
2. **Extract username** from user message
3. **Build command:** `sherlock --print-found --no-color "<username>" --timeout 90`
4. **Execute** via terminal tool
5. **Parse results** and present categorized links

## Key Options

- `--nsfw` — Include NSFW sites
- `--tor` — Route through Tor
- `--timeout 120` — Increase wait time

## Output

Presents as:
- Summary: "Found X accounts for username 'Y'"
- Categorized clickable links
- File location: `<username>.txt`

## Ethical Use

- Only search usernames you own or have permission to investigate
- Respect platform terms of service
- Do not use for harassment or illegal activities