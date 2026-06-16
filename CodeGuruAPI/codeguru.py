"""Legacy one-shot CodeGuru tasks (code review, beautify, etc.)."""

from __future__ import annotations

from llm_client import complete
from prompts import (
    PROMPT_BEAUTIFY,
    PROMPT_BUG_FIX,
    PROMPT_CODE_REVIEW,
    PROMPT_CODE_TRANSLATION,
    PROMPT_COMMIT_MESSAGE,
    PROMPT_FUNCTION_DESCRIPTION,
    PROMPT_PERF_OPTIMIZATION,
    PROMPT_TEST_GENERATION,
)

TASK_PROMPTS = {
    "code_review": PROMPT_CODE_REVIEW,
    "commit_msg": PROMPT_COMMIT_MESSAGE,
    "code_beautify": PROMPT_BEAUTIFY,
    "code_trans": PROMPT_CODE_TRANSLATION,
    "gen_tests": PROMPT_TEST_GENERATION,
    "func_desc": PROMPT_FUNCTION_DESCRIPTION,
    "perf_opt": PROMPT_PERF_OPTIMIZATION,
    "bug_fix": PROMPT_BUG_FIX,
}


def run_task(task: str, code: str) -> str:
    prompt = TASK_PROMPTS.get(task)
    if not prompt:
        raise ValueError(f"Unknown task: {task}")
    return complete(prompt, code)


def beautify_code(input: str) -> str:
    return run_task("code_beautify", input)


def review_code(input: str) -> str:
    return run_task("code_review", input)


def transpile_code(input: str) -> str:
    return run_task("code_trans", input)


def commit_msg(input: str) -> str:
    return run_task("commit_msg", input)


def summarize_code(input: str) -> str:
    return run_task("func_desc", input)


def generate_testcases(input: str) -> str:
    return run_task("gen_tests", input)


def fix_bug(input: str) -> str:
    return run_task("bug_fix", input)


def optimize_perf(input: str) -> str:
    return run_task("perf_opt", input)
