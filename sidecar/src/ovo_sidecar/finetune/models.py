"""Data models for fine-tuning: datasets, training runs, adapters."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

KST = timezone(offset=__import__("datetime").timedelta(hours=9))


def _now_kst() -> str:
    return datetime.now(KST).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class Dataset:
    dataset_id: str = field(default_factory=_new_id)
    name: str = ""
    created_at: str = field(default_factory=_now_kst)
    doc_count: int = 0
    qa_count: int = 0
    train_path: str = ""
    valid_path: str = ""


@dataclass
class TrainingConfig:
    base_model: str = ""
    dataset_id: str = ""
    adapter_name: str = ""
    epochs: int = 3
    learning_rate: float = 1e-4
    lora_rank: int = 8
    lora_layers: int = 16
    batch_size: int = 4
    max_seq_length: int = 2048


@dataclass
class TrainingRun:
    run_id: str = field(default_factory=_new_id)
    adapter_name: str = ""
    base_model: str = ""
    dataset_id: str = ""
    dataset_name: str = ""
    config: TrainingConfig = field(default_factory=TrainingConfig)
    status: str = "pending"
    progress: float = 0.0
    current_epoch: int = 0
    total_epochs: int = 0
    train_loss: float = 0.0
    valid_loss: float = 0.0
    elapsed_seconds: float = 0.0
    error: str | None = None
    started_at: str = ""
    completed_at: str = ""


@dataclass
class Adapter:
    adapter_id: str = field(default_factory=_new_id)
    name: str = ""
    base_model: str = ""
    dataset_id: str = ""
    dataset_name: str = ""
    adapter_path: str = ""
    size_bytes: int = 0
    created_at: str = field(default_factory=_now_kst)
    merged: bool = False
    merged_model_path: str = ""
    config: TrainingConfig = field(default_factory=TrainingConfig)
