# OSS Security Forensics Skill

A 7-phase multi-agent investigation framework for researching open-source supply chain attacks.
Adapted from RAPTOR's forensics system. Covers GitHub Archive, Wayback Machine, GitHub API,
local git analysis, IOC extraction, evidence-backed hypothesis formation and validation,
and final forensic report generation.

---

## Anti-Hallucination Guardrails

Read these before every investigation step. Violating them invalidates the report.

1. **Evidence-First Rule**: Every claim in any report, hypothesis, or summary MUST cite at least one evidence ID (`EV-XXXX`). Assertions without citations are forbidden.
2. **STAY IN YOUR LANE**: Each sub-agent (investigator) has a single data source. Do NOT mix sources. The GH Archive investigator does not query the GitHub API, and vice versa. Role boundaries are hard.
3. **Fact vs. Hypothesis Separation**: Mark all unverified inferences with `[HYPOTHESIS]`. Only statements verified against original sources may be stated as facts.
4. **No Evidence Fabrication**: The hypothesis validator MUST mechanically check that every cited evidence ID actually exists in the evidence store before accepting a hypothesis.
5. **Proof-Required Disproval**: A hypothesis cannot be dismissed without a specific, evidence-backed counter-argument. "No evidence found" is not sufficient to disprove—it only makes a hypothesis inconclusive.
6. **SHA/URL Double-Verification**: Any commit SHA, URL, or external identifier cited as evidence must be independently confirmed from at least two sources before being marked as verified.
7. **Suspicious Code Rule**: Never run code found inside the investigated repository locally. Analyze statically only, or use `execute_code` in a sandboxed environment.
8. **Secret Redaction**: Any API keys, tokens, or credentials discovered during investigation must be redacted in the final report. Log them internally only.

## Example Scenarios

- **Scenario A: Dependency Confusion**: A malicious package `internal-lib-v2` is uploaded to NPM with a higher version than the internal one. The investigator must track when this package was first seen and if any PushEvents in the target repo updated `package.json` to this version.
- **Scenario B: Maintainer Takeover**: A long-term contributor's account is used to push a backdoored `.github/workflows/build.yml`. The investigator looks for PushEvents from this user after a long period of inactivity or from a new IP/location.
- **Scenario C: Force-Push Hide**: A developer accidentally commits a production secret, then force-pushes to "fix" it. The investigator uses `git fsck` and GH Archive to recover the original commit SHA and verify what was leaked.

## Phase 0: Initialization

1. Create investigation working directory:
   ```bash
   mkdir investigation_$(echo "REPO_NAME" | tr '/' '_')
   cd investigation_$(echo "REPO_NAME" | tr '/' '_')
   ```
2. Initialize the evidence store:
   ```bash
   python3 SKILL_DIR/scripts/evidence-store.py --store evidence.json list
   ```
3. Copy the forensic report template:
   ```bash
   cp SKILL_DIR/templates/forensic-report.md ./investigation-report.md
   ```
4. Create an `iocs.md` file to track Indicators of Compromise as they are discovered.

## Phase 1: Prompt Parsing and IOC Extraction

**Goal**: Extract all structured investigative targets from the user's request.

**Actions**:
- Parse the user prompt and extract: target repository, target actors, time window of interest, provided IOCs (commit SHAs, file paths, package names, IP addresses, domains, API keys, malicious URLs)

**Output**: Populate `iocs.md` with extracted IOCs. Each IOC must have type, value, and source.

## Phase 2: Parallel Evidence Collection

Spawn up to 5 specialist investigator sub-agents. Each investigator has a **single data source** and must not mix sources.

### Investigator 1: Local Git Investigator
**ROLE BOUNDARY**: LOCAL GIT REPOSITORY ONLY.

```bash
git clone https://github.com/OWNER/REPO.git target_repo && cd target_repo
git log --all --full-history --stat --format="%H|%ae|%an|%ai|%s" > ../git_log.txt
git fsck --lost-found --unreachable 2>&1 | grep commit > ../dangling_commits.txt
git reflog --all > ../reflog.txt
```

### Investigator 2: GitHub API Investigator
**ROLE BOUNDARY**: GITHUB REST API ONLY.

```bash
curl -s "https://api.github.com/repos/OWNER/REPO/commits?per_page=100" > api_commits.json
curl -s "https://api.github.com/repos/OWNER/REPO/pulls?state=all&per_page=100" > api_prs.json
```

### Investigator 3: Wayback Machine Investigator
**ROLE BOUNDARY**: WAYBACK MACHINE CDX API ONLY.

```bash
curl -s "https://web.archive.org/cdx/search/cdx?url=github.com/OWNER/REPO&output=json&limit=100" > wayback_main.json
```

### Investigator 4: GH Archive / BigQuery Investigator
**ROLE BOUNDARY**: GITHUB ARCHIVE via BIGQUERY ONLY.

Requires Google Cloud credentials. Always run `--dry_run` before queries.

```bash
bq query --use_legacy_sql=false --dry_run "
SELECT created_at, actor.login, payload.commits
FROM \`githubarchive.month.*\`
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMM' AND 'YYYYMM'
  AND type = 'PushEvent'
  AND repo.name = 'OWNER/REPO'
LIMIT 1000
"
```

### Investigator 5: IOC Enrichment Investigator
**ROLE BOUNDARY**: Enrich EXISTING IOCs using passive public sources ONLY.

## Phase 3: Evidence Consolidation

1. Run `python3 SKILL_DIR/scripts/evidence-store.py --store evidence.json list`
2. Verify content SHA256 hashes
3. Group evidence by timeline, actor, and IOC
4. Identify discrepancies between sources

## Phase 4: Hypothesis Formation

A hypothesis must:
- State a specific claim
- Cite at least 2 evidence IDs (`EV-XXXX`, `EV-YYYY`)
- Identify what evidence would disprove it
- Be labeled `[HYPOTHESIS]` until validated

## Phase 5: Hypothesis Validation

The validator MUST mechanically check:
1. All cited evidence IDs exist in `evidence.json`
2. Each `[VERIFIED]` piece was confirmed from 2+ sources
3. Logical consistency with the timeline
4. Check for alternative explanations

**Output**: `VALIDATED`, `INCONCLUSIVE`, or `REJECTED`

## Phase 6: Final Report Generation

Populate `investigation-report.md`:
- Executive Summary with confidence level
- Timeline with evidence citations
- Validated Hypotheses with status
- Evidence Registry table
- IOC List
- Chain of Custody
- Recommendations

## Ethical Use Guidelines

This skill is for **defensive security investigation** only. It must not be used for:
- Harassment or stalking of contributors
- Doxing
- Competitive intelligence on private repositories
- False accusations without validated evidence

Follow coordinated vulnerability disclosure: notify maintainers privately first, allow time for remediation, coordinate with package registries if published packages are affected.

## API Rate Limiting

- GitHub REST API: 5,000/hour authenticated, 60/hour unauthenticated
- BigQuery: 10 TiB/day free tier — always dry-run first
- Wayback Machine: be courteous (1-2 req/sec max)