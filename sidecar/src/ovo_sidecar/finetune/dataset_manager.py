"""Dataset Manager — converts parsed documents into Q&A training JSONL.

Flow:
  1. User drops folder → kordoc parses → Markdown per document
  2. Markdown split into sections
  3. Each section → Q&A pair generation (template-based, no external LLM needed)
  4. Output: train.jsonl + valid.jsonl (90/10 split)

JSONL format (mlx-lm chat fine-tune):
  {"messages": [{"role": "user", "content": "Q"}, {"role": "assistant", "content": "A"}]}
"""
from __future__ import annotations

import json
import logging
import random
import re
from pathlib import Path

from ovo_sidecar.config import settings
from ovo_sidecar.finetune.models import Dataset, _new_id, _now_kst

logger = logging.getLogger(__name__)


def _datasets_dir() -> Path:
    return settings.data_dir / "datasets"


def _dataset_dir(dataset_id: str) -> Path:
    return _datasets_dir() / dataset_id


def list_datasets() -> list[Dataset]:
    base = _datasets_dir()
    if not base.exists():
        return []
    datasets: list[Dataset] = []
    for d in sorted(base.iterdir()):
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
            datasets.append(Dataset(
                dataset_id=meta["dataset_id"],
                name=meta["name"],
                created_at=meta.get("created_at", ""),
                doc_count=meta.get("doc_count", 0),
                qa_count=meta.get("qa_count", 0),
                train_path=str(d / "train.jsonl"),
                valid_path=str(d / "valid.jsonl"),
            ))
        except Exception as e:
            logger.warning("Failed to read dataset meta %s: %s", d, e)
    return datasets


def get_dataset(dataset_id: str) -> Dataset | None:
    meta_path = _dataset_dir(dataset_id) / "meta.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    d = _dataset_dir(dataset_id)
    return Dataset(
        dataset_id=meta["dataset_id"],
        name=meta["name"],
        created_at=meta.get("created_at", ""),
        doc_count=meta.get("doc_count", 0),
        qa_count=meta.get("qa_count", 0),
        train_path=str(d / "train.jsonl"),
        valid_path=str(d / "valid.jsonl"),
    )


def delete_dataset(dataset_id: str) -> bool:
    d = _dataset_dir(dataset_id)
    if not d.exists():
        return False
    import shutil
    shutil.rmtree(d)
    return True


def _section_to_qa_pairs(title: str, content: str, filename: str) -> list[dict]:
    """Generate Q&A training pairs from a document section."""
    content = content.strip()
    if not content or len(content) < 30:
        return []

    pairs: list[dict] = []

    if title:
        pairs.append({
            "messages": [
                {"role": "user", "content": f"{title}에 대해 설명해주세요."},
                {"role": "assistant", "content": content},
            ]
        })
        pairs.append({
            "messages": [
                {"role": "user", "content": f"{title}이란 무엇인가요?"},
                {"role": "assistant", "content": content},
            ]
        })
    else:
        first_line = content.split("\n")[0][:80]
        pairs.append({
            "messages": [
                {"role": "user", "content": f"{first_line}에 관한 내용을 알려주세요."},
                {"role": "assistant", "content": content},
            ]
        })

    if len(content) > 200:
        pairs.append({
            "messages": [
                {"role": "user", "content": f"다음 내용을 요약해주세요:\n{content[:500]}"},
                {"role": "assistant", "content": content},
            ]
        })

    return pairs


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def _markdown_to_qa(markdown: str, filename: str) -> list[dict]:
    """Convert full Markdown document to Q&A pairs by splitting on headings."""
    matches = list(_HEADING_RE.finditer(markdown))
    pairs: list[dict] = []

    if not matches:
        pairs.extend(_section_to_qa_pairs("", markdown, filename))
        return pairs

    if matches[0].start() > 0:
        preamble = markdown[:matches[0].start()].strip()
        if preamble:
            pairs.extend(_section_to_qa_pairs("", preamble, filename))

    for i, m in enumerate(matches):
        title = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        body = markdown[start:end].strip()
        if body:
            pairs.extend(_section_to_qa_pairs(title, body, filename))

    return pairs


async def create_dataset(
    name: str,
    documents: list[dict],
    valid_split: float = 0.1,
) -> Dataset:
    """Create dataset from parsed documents.

    Args:
        name: Human-readable dataset name
        documents: List of {"filename": str, "full_text": str}
        valid_split: Fraction reserved for validation (default 10%)
    """
    dataset_id = _new_id()
    dest = _dataset_dir(dataset_id)
    dest.mkdir(parents=True, exist_ok=True)

    all_pairs: list[dict] = []
    for doc in documents:
        qa = _markdown_to_qa(doc["full_text"], doc.get("filename", ""))
        all_pairs.extend(qa)

    random.shuffle(all_pairs)
    split_idx = max(1, int(len(all_pairs) * (1 - valid_split)))
    train_pairs = all_pairs[:split_idx]
    valid_pairs = all_pairs[split_idx:]

    train_path = dest / "train.jsonl"
    valid_path = dest / "valid.jsonl"

    train_path.write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in train_pairs),
        encoding="utf-8",
    )
    valid_path.write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in valid_pairs),
        encoding="utf-8",
    )

    meta = {
        "dataset_id": dataset_id,
        "name": name,
        "created_at": _now_kst(),
        "doc_count": len(documents),
        "qa_count": len(all_pairs),
        "train_count": len(train_pairs),
        "valid_count": len(valid_pairs),
    }
    (dest / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    logger.info("Created dataset %s: %d docs → %d Q&A pairs", name, len(documents), len(all_pairs))

    return Dataset(
        dataset_id=dataset_id,
        name=name,
        created_at=meta["created_at"],
        doc_count=len(documents),
        qa_count=len(all_pairs),
        train_path=str(train_path),
        valid_path=str(valid_path),
    )
