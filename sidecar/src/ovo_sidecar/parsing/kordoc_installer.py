"""Lazy installer for Node.js runtime + kordoc npm package.

Downloads are triggered on first parse request. Files land in:
  {data_dir}/runtime/node/    — standalone Node.js binary
  {data_dir}/runtime/kordoc/  — kordoc npm package
"""
from __future__ import annotations

import asyncio
import json
import logging
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from ovo_sidecar.config import settings

logger = logging.getLogger(__name__)

_NODE_VERSION = "22.15.0"
_KORDOC_VERSION = "latest"

_install_lock = asyncio.Lock()


def _runtime_dir() -> Path:
    return settings.data_dir / "runtime"


def _node_dir() -> Path:
    return _runtime_dir() / "node"


def _kordoc_dir() -> Path:
    return _runtime_dir() / "kordoc"


def node_bin() -> Path | None:
    """Return path to the managed Node binary, or None if not installed."""
    p = _node_dir() / "bin" / "node"
    return p if p.exists() else None


def npx_bin() -> Path | None:
    p = _node_dir() / "bin" / "npx"
    return p if p.exists() else None


def kordoc_cli() -> Path | None:
    p = _kordoc_dir() / "node_modules" / ".bin" / "kordoc"
    return p if p.exists() else None


def is_ready() -> bool:
    return node_bin() is not None and kordoc_cli() is not None


def status() -> dict:
    return {
        "node_installed": node_bin() is not None,
        "kordoc_installed": kordoc_cli() is not None,
        "node_version": _NODE_VERSION,
        "node_path": str(node_bin()) if node_bin() else None,
        "kordoc_path": str(kordoc_cli()) if kordoc_cli() else None,
        "ready": is_ready(),
    }


def _node_download_url() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "darwin":
        arch = "arm64" if machine == "arm64" else "x64"
        return f"https://nodejs.org/dist/v{_NODE_VERSION}/node-v{_NODE_VERSION}-darwin-{arch}.tar.gz"
    elif system == "linux":
        arch = "arm64" if machine in ("aarch64", "arm64") else "x64"
        return f"https://nodejs.org/dist/v{_NODE_VERSION}/node-v{_NODE_VERSION}-linux-{arch}.tar.gz"
    raise RuntimeError(f"Unsupported platform: {system}/{machine}")


async def install_node(on_progress: callable | None = None) -> Path:
    """Download and extract standalone Node.js."""
    dest = _node_dir()
    if (dest / "bin" / "node").exists():
        logger.info("Node already installed at %s", dest)
        return dest

    url = _node_download_url()
    logger.info("Downloading Node.js from %s", url)
    if on_progress:
        on_progress({"stage": "node", "status": "downloading", "url": url})

    dest.mkdir(parents=True, exist_ok=True)

    def _download_and_extract() -> None:
        import urllib.request
        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            urllib.request.urlretrieve(url, tmp.name)
            tmp_path = Path(tmp.name)

        with tarfile.open(tmp_path, "r:gz") as tar:
            members = tar.getmembers()
            prefix = members[0].name.split("/")[0] if members else ""
            for member in members:
                member.name = member.name.removeprefix(prefix).lstrip("/")
                if member.name:
                    tar.extract(member, dest)

        tmp_path.unlink(missing_ok=True)

    await asyncio.to_thread(_download_and_extract)

    node_path = dest / "bin" / "node"
    if node_path.exists():
        node_path.chmod(0o755)
        logger.info("Node installed: %s", node_path)

    if on_progress:
        on_progress({"stage": "node", "status": "done"})

    return dest


async def install_kordoc(on_progress: callable | None = None) -> Path:
    """Install kordoc npm package into managed directory."""
    dest = _kordoc_dir()
    node = node_bin()
    if not node:
        raise RuntimeError("Node.js not installed — call install_node() first")

    npm = _node_dir() / "bin" / "npm"
    if not npm.exists():
        npm = _node_dir() / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js"

    logger.info("Installing kordoc@%s into %s", _KORDOC_VERSION, dest)
    if on_progress:
        on_progress({"stage": "kordoc", "status": "installing"})

    dest.mkdir(parents=True, exist_ok=True)

    pkg_json = dest / "package.json"
    if not pkg_json.exists():
        pkg_json.write_text(json.dumps({"name": "ovo-kordoc-runtime", "private": True}))

    def _npm_install() -> None:
        env = {
            "PATH": f"{_node_dir() / 'bin'}:{shutil.which('env') and '/usr/bin' or '/bin'}",
            "HOME": str(Path.home()),
            "NODE_PATH": str(dest / "node_modules"),
        }
        cmd = [str(node), str(npm), "install", f"kordoc@{_KORDOC_VERSION}", "--save"]
        result = subprocess.run(
            cmd, cwd=str(dest), capture_output=True, text=True,
            env=env, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"npm install failed: {result.stderr[:500]}")
        logger.info("kordoc installed: %s", result.stdout[:200])

    await asyncio.to_thread(_npm_install)

    if on_progress:
        on_progress({"stage": "kordoc", "status": "done"})

    return dest


async def ensure_ready(on_progress: callable | None = None) -> bool:
    """Install Node + kordoc if missing. Returns True when ready."""
    async with _install_lock:
        if is_ready():
            return True
        await install_node(on_progress)
        await install_kordoc(on_progress)
        return is_ready()
