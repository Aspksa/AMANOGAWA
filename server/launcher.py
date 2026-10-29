"""Dependency bootstrap; uses only the Python standard library."""

import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PRIVATE_PYTHON = ROOT / ".python/tools/python.exe"
if os.name == "nt" and Path(sys.executable).resolve() == PRIVATE_PYTHON.resolve():
    VENV = ROOT / ".python"
    PYTHON = PRIVATE_PYTHON
STAMP = VENV / "amanogawa-dependencies.sha256"
CHECK = "import fastapi, uvicorn, multipart, dotenv, openai, lightrag, raganything, raganything.image_signature"


def fingerprint():
    digest = hashlib.sha256()
    for path in sorted({*ROOT.glob("requirements*.txt"), *(
        p for p in (ROOT / "vendor/RAG-Anything").rglob("*")
        if p.is_file() and p.suffix in {".py", ".toml", ".txt", ".in"}
        and "__pycache__" not in p.parts
    )}):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def python_works():
    if not PYTHON.is_file():
        return False
    try:
        run(str(PYTHON), "-c", "import sys; sys.exit(sys.version_info < (3, 10))",
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, subprocess.CalledProcessError):
        return False


def main():
    try:
        if not python_works():
            print("Creating or repairing .venv ...", flush=True)
            run(sys.executable, "-m", "venv", str(VENV))
        expected = fingerprint()
        installed = STAMP.read_text().strip() if STAMP.exists() else ""
        needs_install = installed != expected
        if not needs_install:
            try:
                run(str(PYTHON), "-c", CHECK)
            except subprocess.CalledProcessError:
                needs_install = True
        if needs_install:
            print("Installing RAG-Anything and dependencies. First run can take 10+ minutes.", flush=True)
            try:
                run(str(PYTHON), "-m", "pip", "--version", stdout=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                run(str(PYTHON), "-m", "ensurepip", "--upgrade")
            run(str(PYTHON), "-m", "pip", "install", "-r", "requirements.txt")
            run(str(PYTHON), "-c", CHECK)
            STAMP.write_text(expected + "\n", encoding="ascii")
        env_file = ROOT / ".env"
        if not env_file.exists():
            try:
                with env_file.open("xb") as target:
                    target.write((ROOT / ".env.example").read_bytes())
            except FileExistsError:
                pass
        return subprocess.call([str(PYTHON), "-m", "server"], cwd=ROOT,
                               env=dict(os.environ, OPEN_BROWSER="1"))
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"AMANOGAWA could not start: {exc}", file=sys.stderr)
        print("Check the error above, then run AMANOGAWA.BAT again.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
