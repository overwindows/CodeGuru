"""Gemma 4 26B-A4B-it-decensored chat loader.

Loads the model on a single GPU and exposes a streaming generate() that yields
text deltas via an asyncio.Queue, suitable for SSE in a FastAPI handler.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import AsyncIterator

import torch
from transformers import (
    AutoProcessor,
    Gemma4ForConditionalGeneration,
    TextIteratorStreamer,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = "/nvmedata/hf_checkpoints/gemma-4-26B-A4B-it-decensored"


class GemmaChat:
    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        device: str = "cuda:0",
        dtype: torch.dtype = torch.bfloat16,
    ) -> None:
        self.model_path = model_path
        self.device = device
        self.dtype = dtype
        self.model: Gemma4ForConditionalGeneration | None = None
        self.processor: AutoProcessor | None = None
        # Serialize concurrent stream() calls — Gemma's KV cache is not
        # safe to share across simultaneous generate() invocations.
        self._inflight = asyncio.Lock()

    @staticmethod
    def _attach_images(
        messages: list[dict], images: list
    ) -> list[dict]:
        """Rewrite the last user message so it carries image blocks + text."""
        out = [dict(m) for m in messages]
        # Find the last user message; if none, append one.
        last_user_idx = None
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("role") == "user":
                last_user_idx = i
                break
        text = ""
        if last_user_idx is not None:
            existing = out[last_user_idx].get("content", "")
            text = existing if isinstance(existing, str) else ""
        content: list[dict] = [{"type": "image", "image": img} for img in images]
        if text:
            content.append({"type": "text", "text": text})
        if last_user_idx is None:
            out.append({"role": "user", "content": content})
        else:
            out[last_user_idx] = {**out[last_user_idx], "content": content}
        return out

    def load(self) -> None:
        logger.info("Loading Gemma processor from %s", self.model_path)
        self.processor = AutoProcessor.from_pretrained(self.model_path)

        logger.info(
            "Loading Gemma model from %s onto %s (dtype=%s)",
            self.model_path,
            self.device,
            self.dtype,
        )
        self.model = Gemma4ForConditionalGeneration.from_pretrained(
            self.model_path,
            torch_dtype=self.dtype,
            device_map={"": self.device},
        )
        # lm_head is randomly initialized (missing from checkpoint) in float32.
        # Cast it to the target dtype to avoid matmul dtype mismatch.
        if hasattr(self.model, "lm_head") and self.model.lm_head.weight.dtype != self.dtype:
            self.model.lm_head.to(self.dtype)
        self.model.eval()

        # Warmup: run a tiny generation to ensure CUDA kernels are compiled
        # and the model is actually usable. Without this, the first real
        # request can hang silently.
        logger.info("Warming up Gemma model...")
        try:
            msgs = [{"role": "user", "content": "hi"}]
            prompt = self.processor.apply_chat_template(
                msgs, add_generation_prompt=True, tokenize=False
            )
            inp = self.processor(text=[prompt], return_tensors="pt").to(self.device)
            with torch.inference_mode():
                self.model.generate(
                    **inp, max_new_tokens=5, do_sample=False, use_cache=True
                )
            logger.info("Gemma warmup complete.")
        except Exception as exc:
            logger.exception("Gemma warmup failed")
            raise

        logger.info("Gemma model loaded.")

    async def stream(
        self,
        messages: list[dict],
        max_new_tokens: int = 1024,
        temperature: float = 1.0,
        top_p: float = 0.95,
        top_k: int = 64,
        do_sample: bool = True,
        images: list | None = None,
    ) -> AsyncIterator[str]:
        if self.model is None or self.processor is None:
            raise RuntimeError("Gemma model not loaded")

        async with self._inflight:
            async for token in self._stream_unlocked(
                messages,
                max_new_tokens,
                temperature,
                top_p,
                top_k,
                do_sample,
                images,
            ):
                yield token

    async def _stream_unlocked(
        self,
        messages: list[dict],
        max_new_tokens: int,
        temperature: float,
        top_p: float,
        top_k: int,
        do_sample: bool,
        images: list | None,
    ) -> AsyncIterator[str]:
        # If images are attached, convert the last user message into a
        # multimodal content list (image blocks + text).
        if images:
            messages = self._attach_images(messages, images)

        prompt = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False,
        )

        inputs = self.processor(
            text=[prompt],
            images=images if images else None,
            return_tensors="pt",
        ).to(self.device)

        streamer = TextIteratorStreamer(
            self.processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=60.0,
        )

        generation_kwargs = dict(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=do_sample,
            temperature=temperature if do_sample else 1.0,
            top_p=top_p if do_sample else 1.0,
            top_k=top_k if do_sample else 0,
            streamer=streamer,
        )

        # TextIteratorStreamer is sync; bridge to async via a queue.
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        gen_error: list[Exception] = []
        gen_done = threading.Event()

        def _generate() -> None:
            try:
                with torch.inference_mode():
                    self.model.generate(**generation_kwargs)
            except Exception as exc:
                gen_error.append(exc)
            finally:
                gen_done.set()

        def _push() -> None:
            for token in streamer:
                loop.call_soon_threadsafe(queue.put_nowait, token)
            # If generation errored, the streamer may not have emitted all
            # tokens — wait for it to finish before signaling end-of-stream.
            gen_done.wait()
            loop.call_soon_threadsafe(queue.put_nowait, None)

        gen_thread = threading.Thread(target=_generate, daemon=True)
        push_thread = threading.Thread(target=_push, daemon=True)
        gen_thread.start()
        push_thread.start()

        try:
            while True:
                token = await queue.get()
                if token is None:
                    if gen_error:
                        raise gen_error[0]
                    return
                yield token
        finally:
            gen_thread.join(timeout=1.0)
            push_thread.join(timeout=1.0)
