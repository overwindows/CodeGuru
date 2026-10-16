# Hermes Agent Skills Ported to CodeGuru

## Summary

**93 SKILL.md files** successfully ported from Hermes Agent to CodeGuru format.

---

## Built-in Skills (18)

| Skill | Status | Details |
|-------|--------|---------|
| apple | ✅ Ported | 4 sub-skills: apple-notes, apple-reminders, findmy, imessage |
| autonomous-ai-agents | ✅ Ported | 4 sub-skills: claude-code, codex, hermes-agent, opencode |
| computer-use | ✅ Ported | SKILL.md at root |
| creative | ✅ Ported | 15 sub-skills |
| data-science | ✅ Ported | jupyter-live-kernel |
| dogfood | ✅ Ported | DESCRIPTION.md only |
| email | ✅ Ported | himalaya |
| github | ✅ Ported | 6 sub-skills: issues, codebase-inspection, github-auth, code-review, pr-workflow, repo-management |
| index-cache | ✅ Ported | DESCRIPTION.md only |
| media | ✅ Ported | 4 sub-skills: gif-search, heartmula, songsee, youtube-content |
| mlops | ✅ Ported | 7 sub-skills: evaluation (lm-evaluation-harness, weights-and-biases), inference (llama-cpp, vllm), models (audiocraft, segment-anything) |
| note-taking | ✅ Ported | obsidian |
| productivity | ✅ Ported | 9 sub-skills: airtable, google-workspace, maps, nano-pdf, notion, ocr-and-documents, petdex, powerpoint, teams-meeting-pipeline |
| research | ✅ Ported | 4 sub-skills: arxiv, blogwatcher, llm-wiki, polymarket |
| smart-home | ✅ Ported | DESCRIPTION.md only |
| social-media | ✅ Ported | DESCRIPTION.md only |
| software-development | ✅ Ported | 9 sub-skills |
| yuanbao | ⚠️ Skipped | No content in source repo (404) |

---

## Optional Skills

### blockchain
| Skill | Status |
|-------|--------|
| evm | ✅ Ported |
| hyperliquid | ✅ Ported |
| solana | ✅ Ported |

### communication
| Skill | Status |
|-------|--------|
| one-three-one-rule | ✅ Ported |

### creative
| Skill | Status |
|-------|--------|
| baoyu-article-illustrator | ✅ Ported |
| baoyu-comic | ✅ Ported |
| blender-mcp | ✅ Ported |
| concept-diagrams | ✅ Ported |
| creative-ideation | ✅ Ported |
| hyperframes | ✅ Ported |
| kanban-video-orchestrator | ✅ Ported |
| meme-generation | ✅ Ported |
| pixel-art | ✅ Ported |

### devops
| Skill | Status |
|-------|--------|
| cli | ✅ Ported |
| docker-management | ✅ Ported |
| hermes-s6-container-supervision | ✅ Ported |
| pinggy-tunnel | ✅ Ported |
| watchers | ✅ Ported |

### dogfood
| Skill | Status |
|-------|--------|
| adversarial-ux-test | ✅ Ported |

### email
| Skill | Status |
|-------|--------|
| agentmail | ✅ Ported |

### finance
| Skill | Status |
|-------|--------|
| pptx-author | ✅ Ported |

### security
| Skill | Status |
|-------|--------|
| 1password | ✅ Ported |
| godmode | ❌ Skipped (harmful content) |
| oss-forensics | ✅ Ported |
| sherlock | ✅ Ported |
| unbroker | ✅ Ported |
| web-pentest | ✅ Ported |

### web-development
| Skill | Status |
|-------|--------|
| cloudflare-temporary-deploy | ✅ Ported |
| page-agent | ✅ Ported |

---

## Skipped Skills

| Skill | Reason |
|-------|--------|
| godmode | Contains content designed to bypass AI safety systems |
| yuanbao | Returns 404 on GitHub (repo may be private/removed) |

## Not in Source

The following optional skill categories exist in `optional-skills/` on GitHub but have no actual skill content (only empty directories):
- gaming
- health
- mcp
- migration
- mlops (content is in built-in mlops section)
- payments
- productivity (content is in built-in productivity section)
- research (content is in built-in research section)
- software-development (content is in built-in software-development section)

## Porting Notes

- **Format**: All skills use `subdirectory/SKILL.md` structure per CodeGuru convention
- **Source**: https://github.com/nousresearch/hermes-agent (MIT licensed)
- **Adaptations**: Removed Hermes-specific env vars, use CodeGuru frontmatter format
- **Installation**: Copy to `~/.codeguru/skills/` or `./.codeguru/skills/`