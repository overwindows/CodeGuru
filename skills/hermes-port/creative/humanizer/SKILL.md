```markdown
---
name: humanizer
description: "Remove AI writing patterns: de-AI, de-slop, un-ChatGPT."
version: 2.5.1
author: Siqi Chen (@blader), ported by Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [writing, editing, AI-detection, natural-language, tone, voice]
    related_skills: []
---

# Humanizer: Remove AI Writing Patterns

Identify and remove signs of AI-generated text to make writing sound natural and human. Based on Wikipedia's "Signs of AI writing" guide (maintained by WikiProject AI Cleanup), derived from observations of thousands of AI-generated text instances.

**Key insight:** LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely completion, which is how the telltale patterns below get baked in.

## When to use this skill

Load this skill whenever the user asks to:
- "humanize", "de-AI", "de-slop", or "un-ChatGPT" a piece of text
- rewrite something so it doesn't sound like it was written by an LLM
- edit a draft (blog post, essay, PR description, docs, memo, email, tweet, resume bullet) to sound more natural
- match their voice in writing they're producing
- review text for AI tells before publishing

Also apply this skill to **your own** output when writing user-facing prose — release notes, PR descriptions, documentation, long-form explanations, summaries. Hermes's baseline voice already strips most of these, but a focused pass catches what slips through.

## How to use it in Hermes

The text usually arrives one of three ways:
1. **Inline** — user pastes the text directly into the message. Work on it in-place, reply with the rewrite.
2. **File** — user points at a file. Use `read_file` to load it, then `patch` or `write_file` to apply edits. For markdown docs in a repo, a targeted `patch` per section is cleaner than rewriting the whole file.
3. **Voice calibration sample** — user provides an additional sample of their own writing (inline or by file path) and asks to match it. Read the sample first, then rewrite. See the Voice Calibration section below.

Always show the rewrite to the user. For file edits, show a diff or the changed section — don't silently overwrite.

## Your task

When given text to humanize:

1. **Identify AI patterns** — scan for the 29 patterns listed below.
2. **Rewrite problematic sections** — replace AI-isms with natural alternatives.
3. **Preserve meaning** — keep the core message intact.
4. **Maintain voice** — match the intended tone (formal, casual, technical, etc.). If a voice sample was provided, match it specifically.
5. **Add soul** — don't just remove bad patterns, inject actual personality. See PERSONALITY AND SOUL below.
6. **Do a final anti-AI pass** — ask yourself: "What makes the below so obviously AI generated?" Answer briefly with any remaining tells, then revise one more time.

## Voice Calibration (optional)

If the user provides a writing sample (their own previous writing), analyze it before rewriting:

1. **Read the sample first.** Note:
   - Sentence length patterns (short and punchy? Long and flowing? Mixed?)
   - Word choice level (casual? academic? somewhere between?)
   - How they start paragraphs (jump right in? Set context first?)
   - Punctuation habits (lots of dashes? Parenthetical asides? Semicolons?)
   - Any recurring phrases or verbal tics
   - How they handle transitions (explicit connectors? Just start the next point?)

2. **Match their voice in the rewrite.** Don't just remove AI patterns — replace them with patterns from the sample. If they write short sentences, don't produce long ones. If they use "stuff" and "things," don't upgrade to "elements" and "components."

3. **When no sample is provided,** fall back to the default behavior (natural, varied, opinionated voice from the PERSONALITY AND SOUL section below).

### How to provide a sample
- Inline: "Humanize this text. Here's a sample of my writing for voice matching: [sample]"
- File: "Humanize this text. Use my writing style from [file path] as a reference."

## PERSONALITY AND SOUL

Avoiding AI patterns is only half the job. Sterile, voiceless writing is just as obvious as slop. Good writing has a human behind it.

### Signs of soulless writing (even if technically "clean"):
- Every sentence is the same length and structure
- No opinions, just neutral reporting
- No acknowledgment of uncertainty or mixed feelings
- No first-person perspective when appropriate
- No humor, no edge, no personality
- Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just report facts — react to them. "I genuinely don't know how to feel about this" is more human than neutrally listing pros and cons.

**Vary your rhythm.** Short punchy sentences. Then longer ones that take their time getting where they're going. Mix it up.

**Acknowledge complexity.** Real humans have mixed feelings. "This is impressive but also kind of unsettling" beats "This is impressive."

**Use "I" when it fits.** First person isn't unprofessional — it's honest. "I keep coming back to..." or "Here's what gets me..." signals a real person thinking.

**Let some mess in.** Perfect structure feels algorithmic. Tangents, asides, and half-formed thoughts are human.

**Be specific about feelings.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am while nobody's watching."

## CONTENT PATTERNS

### 1. Undue Emphasis on Significance, Legacy, and Broader Trends

**Words to watch:** stands/serves as, is a testament/reminder, a vital/significant/crucial/pivotal/key role/moment, underscores/highlights its importance/significance, reflects broader, symbolizing its ongoing/enduring/lasting, contributing to the, setting the stage for, marking/shaping the, represents/marks a shift, key turning point, evolving landscape, focal point, indelible mark, deeply rooted

### 2. Undue Emphasis on Notability and Media Coverage

**Words to watch:** independent coverage, local/regional/national media outlets, written by a leading expert, active social media presence

### 3. Superficial Analyses with -ing Endings

**Words to watch:** highlighting/underscoring/emphasizing..., ensuring..., reflecting/symbolizing..., contributing to..., cultivating/fostering..., encompassing..., showcasing...

### 4. Promotional and Advertisement-like Language

**Words to watch:** boasts a, vibrant, rich (figurative), profound, enhancing its, showcasing, exemplifies, commitment to, natural beauty, nestled, in the heart of, groundbreaking (figurative), renowned, breathtaking, must-visit, stunning

### 5. Vague Attributions and Weasel Words

**Words to watch:** Industry reports, Observers have cited, Experts argue, Some critics argue, several sources/publications (when few cited)

### 6. Outline-like "Challenges and Future Prospects" Sections

**Words to watch:** Despite its... faces several challenges..., Despite these challenges, Challenges and Legacy, Future Outlook

## LANGUAGE AND GRAMMAR PATTERNS

### 7. Overused "AI Vocabulary" Words

**High-frequency AI words:** Actually, additionally, align with, crucial, delve, emphasizing, enduring, enhance, fostering, garner, highlight (verb), interplay, intricate/intricacies, key (adjective), landscape (abstract noun), pivotal, showcase, tapestry (abstract noun), testament, underscore (verb), valuable, vibrant

### 8. Avoidance of "is"/"are" (Copula Avoidance)

**Words to watch:** serves as/stands as/marks/represents [a], boasts/features/offers [a]

### 9. Negative Parallelisms and Tailing Negations

**Problem:** Constructions like "Not only...but..." or "It's not just about..., it's..." are overused. So are clipped tailing-negation fragments.

### 10. Rule of Three Overuse

**Problem:** LLMs force ideas into groups of three to appear comprehensive.

### 11. Elegant Variation (Synonym Cycling)

**Problem:** AI has repetition-penalty code causing excessive synonym substitution.

### 12. False Ranges

**Problem:** LLMs use "from X to Y" constructions where X and Y aren't on a meaningful scale.

### 13. Passive Voice and Subjectless Fragments

**Problem:** LLMs often hide the actor or drop the subject entirely.

## STYLE PATTERNS

### 14. Em Dash Overuse

**Problem:** LLMs use em dashes more than humans, mimicking "punchy" sales writing.

### 15. Overuse of Boldface

**Problem:** AI chatbots emphasize phrases in boldface mechanically.

### 16. Inline-Header Vertical Lists

**Problem:** AI outputs lists where items start with bolded headers followed by colons.

### 17. Title Case in Headings

**Problem:** AI chatbots capitalize all main words in headings.

### 18. Emojis

**Problem:** AI chatbots often decorate headings or bullet points with emojis.

### 19. Curly Quotation Marks

**Problem:** ChatGPT uses curly quotes ("...") instead of straight quotes ("...").

## COMMUNICATION PATTERNS

### 20. Collaborative Communication Artifacts

**Words to watch:** I hope this helps, Of course!, Certainly!, You're absolutely right!, Would you like..., let me know, here is a...

### 21. Knowledge-Cutoff Disclaimers

**Words to watch:** as of [date], Up to my last training update, While specific details are limited/scarce..., based on available information...

### 22. Sycophantic/Servile Tone

**Problem:** Overly positive, people-pleasing language.

## FILLER AND HEDGING

### 23. Filler Phrases

**Before → After:**
- "In order to achieve this goal" → "To achieve this"
- "Due to the fact that it was raining" → "Because it was raining"
- "At this point in time" → "Now"
- "In the event that you need help" → "If you need help"

### 24. Excessive Hedging

**Problem:** Over-qualifying statements.

### 25. Generic Positive Conclusions

**Problem:** Vague upbeat endings.

### 26. Hyphenated Word Pair Overuse

**Words to watch:** third-party, cross-functional, client-facing, data-driven, decision-making, well-known, high-quality, real-time, long-term, end-to-end

### 27. Persuasive Authority Tropes

**Phrases to watch:** The real question is, at its core, in reality, what really matters, fundamentally, the deeper issue, the heart of the matter

### 28. Signposting and Announcements

**Phrases to watch:** Let's dive in, let's explore, let's break this down, here's what you need to know, now let's look at, without further ado

### 29. Fragmented Headers

**Signs to watch:** A heading followed by a one-line paragraph that simply restates the heading before the real content begins.

## Attribution

This skill is ported from [blader/humanizer](https://github.com/blader/humanizer) (MIT licensed), which is itself based on [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. The patterns documented there come from observations of thousands of instances of AI-generated text on Wikipedia.

Original author: Siqi Chen ([@blader](https://github.com/blader)). Original repo: https://github.com/blader/humanizer (version 2.5.1). Ported to Hermes Agent with Hermes-native tool references (`read_file`, `patch`, `write_file`) and guidance for when to load the skill; the 29 patterns, personality/soul section, and full worked example are preserved verbatim from the source. Original MIT license preserved in the `LICENSE` file alongside this `SKILL.md`.
```