# Hermes Agent Skills Port - CodeGuru

This directory contains Hermes Agent skills ported to CodeGuru format.

## Purpose

These skills are adapted from [Hermes Agent by Nous Research](https://github.com/nousresearch/hermes-agent) to work with CodeGuru's skill system.

## Skills Structure

```
hermes-port/
├── README.md                    # This file
├── github/
│   └── SKILL.md                 # GitHub Issues management
└── ... (more skills coming)
```

## Installation

To use these skills, copy them to your CodeGuru skills directory:

```bash
# For user-level skills
cp -r hermes-port/* ~/.codeguru/skills/

# For project-level skills
cp -r hermes-port/* ./.codeguru/skills/
```

## Skills Available

| Skill | Status | Description |
|-------|--------|-------------|
| github-issues | ✅ Ready | Create, triage, label, assign GitHub issues |
| (more) | 🚧 In progress | Additional skills being ported |

## Porting Progress

**Built-in Skills (18):**
- [ ] apple
- [ ] autonomous-ai-agents
- [ ] computer-use
- [ ] creative
- [ ] data-science
- [ ] dogfood
- [ ] email
- [ ] github → ✅ github-issues ready
- [ ] index-cache
- [ ] media
- [ ] mlops
- [ ] note-taking
- [ ] productivity
- [ ] research
- [ ] smart-home
- [ ] social-media
- [ ] software-development (9 sub-skills)
- [ ] yuanbao

**Optional Skills (19):**
- [ ] blockchain
- [ ] communication
- [ ] creative
- [ ] devops
- [ ] dogfood
- [ ] email (agentmail)
- [ ] finance
- [ ] gaming
- [ ] health
- [ ] mcp
- [ ] migration
- [ ] mlops
- [ ] payments
- [ ] productivity
- [ ] research
- [ ] security
- [ ] software-development
- [ ] web-development

## Skill Format

Each skill follows CodeGuru's SKILL.md format:

```markdown
---
name: Skill Name
description: Brief description
when_to_use: When to use this skill
---

# Skill Name

Detailed content...
```

## Contributing

To add a new skill:
1. Create a directory: `<skill-name>/`
2. Create `SKILL.md` with frontmatter
3. Copy to your skills directory

## Source

These skills are derived from [Hermes Agent](https://github.com/nousresearch/hermes-agent) by [Nous Research](https://nousresearch.com/), licensed under MIT.

## Differences from Hermes Agent

- No `hermes` CLI dependencies - uses standard bash/curl
- CodeGuru frontmatter format (name, description, when_to_use)
- Removed Hermes-specific environment variables
- Compatible with CodeGuru's skill loading system