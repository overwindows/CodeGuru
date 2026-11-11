"""Qwen-Image-Edit-2511 image-edit loader.

Loads the diffusers QwenImageEditPlusPipeline on a single GPU and exposes a
synchronous edit() that takes a source image + prompt and returns a PIL.Image.

Optionally overlays a ComfyUI-format merged checkpoint (e.g. Qwen-Rapid-AIO)
by extracting its transformer weights and loading them on top of the base
diffusers model.
"""

from __future__ import annotations

import logging
import random
from pathlib import Path
from typing import Optional

import torch
from diffusers import QwenImageEditPlusPipeline
from PIL import Image
from safetensors import safe_open

logger = logging.getLogger(__name__)

DEFAULT_MODEL_PATH = "/nvmedata/hf_checkpoints/Qwen-Image-Edit-2511"
DEFAULT_AIO_CHECKPOINT = "/nvmedata/hf_checkpoints/Qwen-Rapid-AIO-NSFW-v23/v23/Qwen-Rapid-AIO-NSFW-v23.safetensors"


def _load_aio_transformer_weights(pipe: QwenImageEditPlusPipeline, ckpt_path: str) -> None:
    """Extract transformer weights from a ComfyUI-format checkpoint and load
    them into the diffusers pipeline's transformer."""
    prefix = "model.diffusion_model."
    new_state: dict[str, torch.Tensor] = {}
    with safe_open(ckpt_path, framework="pt") as f:
        for k in f.keys():
            if k.startswith(prefix):
                new_key = k[len(prefix):]
                new_state[new_key] = f.get_tensor(k)
    logger.info("Extracted %d transformer keys from %s", len(new_state), ckpt_path)
    missing, unexpected = pipe.transformer.load_state_dict(new_state, strict=False)
    if missing:
        logger.warning("AIO load: %d missing keys (first 5: %s)", len(missing), missing[:5])
    if unexpected:
        logger.warning("AIO load: %d unexpected keys (first 5: %s)", len(unexpected), unexpected[:5])


class QwenImageEdit:
    def __init__(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        device: str = "cuda:2",
        dtype: torch.dtype = torch.bfloat16,
        aio_checkpoint: Optional[str] = None,
    ) -> None:
        self.model_path = model_path
        self.device = device
        self.dtype = dtype
        self.aio_checkpoint = aio_checkpoint
        self.pipe: Optional[QwenImageEditPlusPipeline] = None

    def load(self) -> None:
        logger.info("Loading Qwen-Image-Edit pipeline from %s", self.model_path)
        self.pipe = QwenImageEditPlusPipeline.from_pretrained(
            self.model_path,
            torch_dtype=self.dtype,
            low_cpu_mem_usage=False,
        )

        if self.aio_checkpoint and Path(self.aio_checkpoint).exists():
            logger.info("Overlaying AIO checkpoint from %s", self.aio_checkpoint)
            _load_aio_transformer_weights(self.pipe, self.aio_checkpoint)

        self.pipe.to(self.device)
        self.pipe.set_progress_bar_config(disable=True)
        logger.info("Qwen-Image-Edit pipeline loaded on %s.", self.device)

    def edit(
        self,
        image: Image.Image,
        prompt: str,
        negative_prompt: str = " ",
        steps: int = 30,
        guidance_scale: float = 4.0,
        seed: Optional[int] = None,
    ) -> Image.Image:
        if self.pipe is None:
            raise RuntimeError("Qwen-Image-Edit pipeline not loaded")

        if seed is None:
            seed = random.randint(0, 2**32 - 1)

        generator = torch.Generator(device=self.device).manual_seed(seed)
        logger.info(
            "Editing image: prompt=%r size=%dx%d steps=%d seed=%d",
            prompt[:80],
            image.width,
            image.height,
            steps,
            seed,
        )

        result = self.pipe(
            image=[image],
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=steps,
            true_cfg_scale=guidance_scale,
            generator=generator,
        )
        return result.images[0]
