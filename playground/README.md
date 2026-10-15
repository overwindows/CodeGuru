# Playground

Local web playground for two models:

- **Chat**: `gemma-4-26B-A4B-it-decensored` (Gemma 4 26B-A4B MoE, BF16) on GPU 0.
- **Image**: `Qwen-Image-2.1` (QwenImage21Pipeline, BF16) on GPU 1.

FastAPI backend + vanilla HTML/JS frontend. Single page with two tabs.

## Setup

The active `codeguru` env has a torch wheel (`cu130`) that doesn't match the
system driver (CUDA 12.6). Use a dedicated conda env:

```bash
conda create -n playground python=3.11 -y
conda activate playground

# Torch with cu126 (matches driver 12.6)
pip install torch==2.7.1 torchvision==0.22.1 \
    --index-url https://download.pytorch.org/whl/cu126

# Diffusers from git (PyPI doesn't yet ship QwenImage21Pipeline)
pip install git+https://github.com/huggingface/diffusers.git

# Everything else
pip install -r requirements.txt
```

Verify:

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.device_count())"
python -c "from diffusers import QwenImage21Pipeline; from transformers import Gemma4ForConditionalGeneration; print('ok')"
```

## Run

```bash
./run.sh            # default port 8000
./run.sh 9000       # custom port
```

Then open <http://localhost:8000/>.

GPU assignment is controlled via env vars:

```bash
GEMMA_DEVICE=cuda:2 QWEN_DEVICE=cuda:3 ./run.sh
```

## Files

- `server.py` — FastAPI app, `/api/health`, `/api/chat` (SSE), `/api/generate`.
- `models/gemma.py` — Gemma 4 loader + streaming generator.
- `models/qwen_image.py` — Qwen-Image-2.1 loader + image generator.
- `static/` — HTML/CSS/JS frontend.
- `outputs/` — generated images saved here (gitignored).

## Notes

- Both models load in parallel at startup. Loading Gemma 4 26B-A4B takes
  ~30-60s; Qwen-Image-2.1 takes ~15-30s. `/api/health` reports status.
- Image generation takes ~30-60s for 30 steps at 1024×1024.
- Chat streams tokens via Server-Sent Events.
- Gemma 4 is multimodal but we use the text-only path here.
