"""FastAPI playground server for Gemma 4 chat + Qwen-Image-2.1 generation."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from PIL import Image
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from models.gemma import GemmaChat
from models.qwen_image import QwenImageGen
from models.qwen_image_edit import QwenImageEdit

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("playground")

BASE_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = BASE_DIR / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)

GEMMA_DEVICE = os.environ.get("GEMMA_DEVICE", "cuda:0")
QWEN_DEVICE = os.environ.get("QWEN_DEVICE", "cuda:1")
QWEN_EDIT_DEVICE = os.environ.get("QWEN_EDIT_DEVICE", "cuda:2")
QWEN_AIO_DEVICE = os.environ.get("QWEN_AIO_DEVICE", "cuda:3")

gemma: GemmaChat | None = None
qwen_image: QwenImageGen | None = None
qwen_edit: QwenImageEdit | None = None
qwen_aio: QwenImageEdit | None = None
gemma_error: str | None = None
qwen_error: str | None = None
qwen_edit_error: str | None = None
qwen_aio_error: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global gemma, qwen_image, qwen_edit, qwen_aio, gemma_error, qwen_error, qwen_edit_error, qwen_aio_error

    loop = asyncio.get_event_loop()

    def _load_gemma() -> None:
        global gemma, gemma_error
        try:
            g = GemmaChat(device=GEMMA_DEVICE)
            g.load()
            gemma = g
        except Exception as exc:  # pragma: no cover - logged + reported via /health
            logger.exception("Failed to load Gemma")
            gemma_error = f"{type(exc).__name__}: {exc}"

    def _load_qwen() -> None:
        global qwen_image, qwen_error
        try:
            q = QwenImageGen(device=QWEN_DEVICE)
            q.load()
            qwen_image = q
        except Exception as exc:  # pragma: no cover
            logger.exception("Failed to load Qwen-Image")
            qwen_error = f"{type(exc).__name__}: {exc}"

    def _load_qwen_edit() -> None:
        global qwen_edit, qwen_edit_error
        try:
            q = QwenImageEdit(device=QWEN_EDIT_DEVICE)
            q.load()
            qwen_edit = q
        except Exception as exc:  # pragma: no cover
            logger.exception("Failed to load Qwen-Image-Edit")
            qwen_edit_error = f"{type(exc).__name__}: {exc}"

    def _load_qwen_aio() -> None:
        global qwen_aio, qwen_aio_error
        try:
            q = QwenImageEdit(
                device=QWEN_AIO_DEVICE,
                aio_checkpoint="/nvmedata/hf_checkpoints/Qwen-Rapid-AIO-NSFW-v23/v23/Qwen-Rapid-AIO-NSFW-v23.safetensors",
            )
            q.load()
            qwen_aio = q
        except Exception as exc:  # pragma: no cover
            logger.exception("Failed to load Qwen-Image-Edit-AIO")
            qwen_aio_error = f"{type(exc).__name__}: {exc}"

    await asyncio.gather(
        loop.run_in_executor(None, _load_gemma),
        loop.run_in_executor(None, _load_qwen),
        loop.run_in_executor(None, _load_qwen_edit),
        loop.run_in_executor(None, _load_qwen_aio),
    )

    if gemma:
        logger.info("Gemma ready on %s", GEMMA_DEVICE)
    else:
        logger.warning("Gemma NOT loaded: %s", gemma_error)
    if qwen_image:
        logger.info("Qwen-Image ready on %s", QWEN_DEVICE)
    else:
        logger.warning("Qwen-Image NOT loaded: %s", qwen_error)
    if qwen_edit:
        logger.info("Qwen-Image-Edit ready on %s", QWEN_EDIT_DEVICE)
    else:
        logger.warning("Qwen-Image-Edit NOT loaded: %s", qwen_edit_error)
    if qwen_aio:
        logger.info("Qwen-Image-Edit-AIO ready on %s", QWEN_AIO_DEVICE)
    else:
        logger.warning("Qwen-Image-Edit-AIO NOT loaded: %s", qwen_aio_error)

    yield

    gemma = None
    qwen_image = None
    qwen_edit = None
    qwen_aio = None


app = FastAPI(title="Playground", lifespan=lifespan)


# --- Schemas -----------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    max_new_tokens: int = Field(default=1024, ge=1, le=8192)
    temperature: float = Field(default=1.0, ge=0.0, le=2.0)
    top_p: float = Field(default=0.95, ge=0.0, le=1.0)
    top_k: int = Field(default=64, ge=0, le=500)
    do_sample: bool = True
    # Optional base64-encoded images (raw base64 or data URLs) attached to the
    # last user message for vision queries.
    images: list[str] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    negative_prompt: str = " "
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    steps: int = Field(default=30, ge=1, le=100)
    guidance_scale: float = Field(default=4.0, ge=0.0, le=20.0)
    seed: int | None = None


class EditRequest(BaseModel):
    prompt: str = Field(min_length=1)
    image: str  # base64 (raw or data URL)
    negative_prompt: str = " "
    steps: int = Field(default=30, ge=1, le=100)
    guidance_scale: float = Field(default=4.0, ge=0.0, le=20.0)
    seed: int | None = None


# --- Routes ------------------------------------------------------------------

def _decode_image(data: str) -> Image.Image:
    """Decode a base64 image string (raw or data URL) into a PIL Image."""
    if data.startswith("data:"):
        # data:[<mediatype>][;base64],<data>
        comma = data.find(",")
        if comma == -1:
            raise ValueError("malformed data URL")
        data = data[comma + 1:]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64: {exc}") from exc
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"cannot decode image: {exc}") from exc


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "gemma": {
                "loaded": gemma is not None,
                "device": GEMMA_DEVICE if gemma else None,
                "error": gemma_error,
            },
            "qwen_image": {
                "loaded": qwen_image is not None,
                "device": QWEN_DEVICE if qwen_image else None,
                "error": qwen_error,
            },
            "qwen_edit": {
                "loaded": qwen_edit is not None,
                "device": QWEN_EDIT_DEVICE if qwen_edit else None,
                "error": qwen_edit_error,
            },
            "qwen_aio": {
                "loaded": qwen_aio is not None,
                "device": QWEN_AIO_DEVICE if qwen_aio else None,
                "error": qwen_aio_error,
            },
        }
    )


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    if gemma is None:
        raise HTTPException(status_code=503, detail=f"Gemma not loaded: {gemma_error}")

    messages = [m.model_dump() for m in req.messages]

    images: list[Image.Image] = []
    for data in req.images:
        try:
            images.append(_decode_image(data))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async for token in gemma.stream(
                messages=messages,
                max_new_tokens=req.max_new_tokens,
                temperature=req.temperature,
                top_p=req.top_p,
                top_k=req.top_k,
                do_sample=req.do_sample,
                images=images or None,
            ):
                payload = token.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")
                yield f"data: {payload}\n\n".encode("utf-8")
            yield b"data: [DONE]\n\n"
        except Exception as exc:
            logger.exception("Chat streaming failed")
            msg = f"{type(exc).__name__}: {exc}".replace("\\", "\\\\").replace("\n", "\\n")
            yield f"data: [ERROR] {msg}\n\n".encode("utf-8")

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> StreamingResponse:
    if qwen_image is None:
        raise HTTPException(
            status_code=503, detail=f"Qwen-Image not loaded: {qwen_error}"
        )

    loop = asyncio.get_running_loop()

    def _run() -> bytes:
        img = qwen_image.generate(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            width=req.width,
            height=req.height,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()

        ts = time.strftime("%Y%m%d-%H%M%S")
        prompt_hash = hashlib.sha256(req.prompt.encode()).hexdigest()[:12]
        out_path = OUTPUTS_DIR / f"{ts}_{prompt_hash}.png"
        out_path.write_bytes(data)
        return data

    data = await loop.run_in_executor(None, _run)
    return StreamingResponse(io.BytesIO(data), media_type="image/png")


@app.post("/api/edit")
async def edit(req: EditRequest) -> StreamingResponse:
    if qwen_edit is None:
        raise HTTPException(
            status_code=503, detail=f"Qwen-Image-Edit not loaded: {qwen_edit_error}"
        )

    try:
        image = _decode_image(req.image)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    loop = asyncio.get_running_loop()

    def _run() -> bytes:
        img = qwen_edit.edit(
            image=image,
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()

        ts = time.strftime("%Y%m%d-%H%M%S")
        prompt_hash = hashlib.sha256(req.prompt.encode()).hexdigest()[:12]
        out_path = OUTPUTS_DIR / f"{ts}_edit_{prompt_hash}.png"
        out_path.write_bytes(data)
        return data

    data = await loop.run_in_executor(None, _run)
    return StreamingResponse(io.BytesIO(data), media_type="image/png")


@app.post("/api/edit-aio")
async def edit_aio(req: EditRequest) -> StreamingResponse:
    if qwen_aio is None:
        raise HTTPException(
            status_code=503, detail=f"Qwen-Image-Edit-AIO not loaded: {qwen_aio_error}"
        )

    try:
        image = _decode_image(req.image)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    loop = asyncio.get_running_loop()

    def _run() -> bytes:
        img = qwen_aio.edit(
            image=image,
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            seed=req.seed,
        )
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()

        ts = time.strftime("%Y%m%d-%H%M%S")
        prompt_hash = hashlib.sha256(req.prompt.encode()).hexdigest()[:12]
        out_path = OUTPUTS_DIR / f"{ts}_aio_{prompt_hash}.png"
        out_path.write_bytes(data)
        return data

    data = await loop.run_in_executor(None, _run)
    return StreamingResponse(io.BytesIO(data), media_type="image/png")


# --- Static frontend ---------------------------------------------------------

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False,
    )
