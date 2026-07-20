**Systematic Debugging** follows a strict "Iron Law": "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST."

The core process is a **4-phase approach**:

1. **Root Cause Investigation** — Read errors completely, build a tight feedback loop (red-capable test), check recent changes, trace data flow
2. **Pattern Analysis** — Minimize reproduction, find working examples, compare implementations, identify differences
3. **Hypothesis & Testing** — Form ranked falsifiable hypotheses, test minimally, one variable at a time
4. **Implementation** — Create regression test first, fix root cause (not symptoms), verify

**Key principle:** The feedback loop is the work. Before reading code to build a theory, create a tight command that goes red on the exact symptom and green when fixed.

**Rule of Three:** After 3+ failed fixes, stop and question the architecture—this signals a pattern problem, not a sequence of isolated bugs.

The approach prevents common failure modes: guessing, quick patches that mask issues, and "one more fix" rationalizations that lead to thrashing.