"""Qwen-Image-2.1 text-to-image loader.

Loads the diffusers QwenImage21Pipeline on a single GPU and exposes a
synchronous generate() returning a PIL.Image.
"""

from __future__ import annotations

import logging
import random
from typing import Optional

import torch
from diffusers import QwenImage21Pipeline
from PIL import Image

logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = "/nvmedata/hf_checkpoints/Qwen-Image-2.1"


class QwenImageGen:
    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        device: str = "cuda:1",
        dtype: torch.dtype = torch.bfloat16,
    ) -> None:
        self.model_path = model_path
        self.device = device
        self.dtype = dtype
        self.pipe: Optional[QwenImage21Pipeline] = None

    def load(self) -> None:
        logger.info("Loading Qwen-Image pipeline from %s", self.model_path)
        self.pipe = QwenImage21Pipeline.from_pretrained(
            self.model_path,
            torch_dtype=self.dtype,
            low_cpu_mem_usage=False,
        )
        self.pipe.to(self.device)
        self.pipe.set_progress_bar_config(disable=True)
        logger.info("Qwen-Image pipeline loaded on %s.", self.device)

    def generate(
        self,
        prompt: str,
        negative_prompt: str = " ",
        width: int = 1024,
        height: int = 1024,
        steps: int = 30,
        guidance_scale: float = 4.0,
        seed: Optional[int] = None,
    ) -> Image.Image:
        if self.pipe is None:
            raise RuntimeError("Qwen-Image pipeline not loaded")

        if seed is None:
            seed = random.randint(0, 2**32 - 1)

        generator = torch.Generator(device=self.device).manual_seed(seed)
        logger.info(
            "Generating image: prompt=%r size=%dx%d steps=%d seed=%d",
            prompt[:80],
            width,
            height,
            steps,
            seed,
        )

        result = self.pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            true_cfg_scale=guidance_scale,
            generator=generator,
        )
        return result.images[0]
