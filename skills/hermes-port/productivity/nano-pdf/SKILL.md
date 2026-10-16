---
name: nano-pdf
description: Edit PDF text/typos/titles via nano-pdf CLI (NL prompts)
version: 1.0.0
license: MIT
platforms: Linux, macOS, Windows
tags: PDF, Documents, Editing, NLP, Productivity

**Install:**
`uv pip install nano-pdf` or `pip install nano-pdf`

**Usage:**
`nano-pdf edit <file.pdf> <page_number> "<instruction>"`

**Examples:**
- Change title on page 1: `nano-pdf edit deck.pdf 1 "Change the title to 'Q3 Results'"`
- Update date on page 3: `nano-pdf edit report.pdf 3 "Update the date from January to February 2026"`
- Fix client name: `nano-pdf edit contract.pdf 2 "Change 'Acme Corp' to 'Acme Industries'"`

**Notes:**
- Page numbers may be 0-based or 1-based — retry with ±1 if wrong page
- Verify output after editing
- Uses LLM under the hood — requires API key
- Works best for text changes; complex layouts may need alternatives