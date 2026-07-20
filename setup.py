"""Install the CodeGuru Python design-doc tool.

Usage:
    pip install -r requirements.txt
    pip install -e .

Or run the helper script (macOS / Linux):
    ./scripts/install-python.sh
"""

from pathlib import Path

from setuptools import setup

ROOT = Path(__file__).resolve().parent


def read_requirements() -> list[str]:
    requirements_path = ROOT / "requirements.txt"
    lines = requirements_path.read_text(encoding="utf-8").splitlines()
    return [
        line.strip()
        for line in lines
        if line.strip() and not line.strip().startswith("#")
    ]

setup(
    name="codeguru-doc",
    version="0.1.0",
    description="Convert a design document (.docx) into a project directory layout",
    python_requires=">=3.10",
    install_requires=read_requirements(),
    packages=["src"],
    entry_points={
        "console_scripts": [
            "guru=src.main:main",
        ],
    },
)
