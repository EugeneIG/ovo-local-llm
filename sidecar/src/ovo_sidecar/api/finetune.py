"""Fine-tuning API endpoints — dataset management, training runs, adapter CRUD.

Routes:
  POST /ovo/ft/datasets                — create dataset from parsed docs
  GET  /ovo/ft/datasets                — list datasets
  GET  /ovo/ft/datasets/{id}           — get dataset detail
  DELETE /ovo/ft/datasets/{id}         — delete dataset

  POST /ovo/ft/train                   — start LoRA training
  GET  /ovo/ft/runs                    — list active runs
  GET  /ovo/ft/runs/{id}               — get run progress
  POST /ovo/ft/runs/{id}/cancel        — cancel training

  GET  /ovo/ft/adapters                — list adapters
  GET  /ovo/ft/adapters/{id}           — get adapter detail
  DELETE /ovo/ft/adapters/{id}         — delete adapter
  POST /ovo/ft/adapters/{id}/merge     — merge adapter into base model
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ovo_sidecar.finetune import dataset_manager, adapter_manager, lora_trainer
from ovo_sidecar.finetune.models import TrainingConfig

logger = logging.getLogger(__name__)

router = APIRouter(tags=["finetune"])


# ── Dataset endpoints ────────────────────────────────────────

class CreateDatasetRequest(BaseModel):
    name: str
    documents: list[dict[str, str]]


@router.post("/ft/datasets")
async def create_dataset(req: CreateDatasetRequest) -> dict:
    try:
        ds = await dataset_manager.create_dataset(req.name, req.documents)
        return {
            "dataset_id": ds.dataset_id,
            "name": ds.name,
            "doc_count": ds.doc_count,
            "qa_count": ds.qa_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ft/datasets")
async def list_datasets() -> list[dict]:
    datasets = dataset_manager.list_datasets()
    return [
        {
            "dataset_id": d.dataset_id,
            "name": d.name,
            "created_at": d.created_at,
            "doc_count": d.doc_count,
            "qa_count": d.qa_count,
        }
        for d in datasets
    ]


@router.get("/ft/datasets/{dataset_id}")
async def get_dataset(dataset_id: str) -> dict:
    ds = dataset_manager.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {
        "dataset_id": ds.dataset_id,
        "name": ds.name,
        "created_at": ds.created_at,
        "doc_count": ds.doc_count,
        "qa_count": ds.qa_count,
    }


@router.delete("/ft/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str) -> dict:
    if not dataset_manager.delete_dataset(dataset_id):
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"deleted": True}


# ── Training endpoints ───────────────────────────────────────

class TrainRequest(BaseModel):
    adapter_name: str
    base_model: str
    dataset_id: str
    epochs: int = 3
    learning_rate: float = 1e-4
    lora_rank: int = 8
    lora_layers: int = 16
    batch_size: int = 4
    max_seq_length: int = 2048


@router.post("/ft/train")
async def start_train(req: TrainRequest) -> dict:
    ds = dataset_manager.get_dataset(req.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    config = TrainingConfig(
        base_model=req.base_model,
        dataset_id=req.dataset_id,
        adapter_name=req.adapter_name,
        epochs=req.epochs,
        learning_rate=req.learning_rate,
        lora_rank=req.lora_rank,
        lora_layers=req.lora_layers,
        batch_size=req.batch_size,
        max_seq_length=req.max_seq_length,
    )

    run = await lora_trainer.start_training(config)
    run.dataset_name = ds.name

    return {
        "run_id": run.run_id,
        "adapter_name": run.adapter_name,
        "status": run.status,
    }


@router.get("/ft/runs")
async def list_runs() -> list[dict]:
    runs = lora_trainer.list_runs()
    return [_serialize_run(r) for r in runs]


@router.get("/ft/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    run = lora_trainer.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _serialize_run(run)


@router.post("/ft/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict:
    if not lora_trainer.cancel_run(run_id):
        raise HTTPException(status_code=404, detail="Run not found or already finished")
    return {"cancelled": True}


def _serialize_run(r: Any) -> dict:
    return {
        "run_id": r.run_id,
        "adapter_name": r.adapter_name,
        "base_model": r.base_model,
        "dataset_name": r.dataset_name,
        "status": r.status,
        "progress": r.progress,
        "current_epoch": r.current_epoch,
        "total_epochs": r.total_epochs,
        "train_loss": r.train_loss,
        "valid_loss": r.valid_loss,
        "elapsed_seconds": r.elapsed_seconds,
        "error": r.error,
    }


# ── Adapter endpoints ────────────────────────────────────────

@router.get("/ft/adapters")
async def list_adapters() -> list[dict]:
    adapters = adapter_manager.list_adapters()
    return [
        {
            "adapter_id": a.adapter_id,
            "name": a.name,
            "base_model": a.base_model,
            "dataset_name": a.dataset_name,
            "size_bytes": a.size_bytes,
            "created_at": a.created_at,
            "merged": a.merged,
        }
        for a in adapters
    ]


@router.get("/ft/adapters/{adapter_id}")
async def get_adapter(adapter_id: str) -> dict:
    a = adapter_manager.get_adapter(adapter_id)
    if not a:
        raise HTTPException(status_code=404, detail="Adapter not found")
    return {
        "adapter_id": a.adapter_id,
        "name": a.name,
        "base_model": a.base_model,
        "dataset_name": a.dataset_name,
        "size_bytes": a.size_bytes,
        "created_at": a.created_at,
        "merged": a.merged,
        "merged_model_path": a.merged_model_path,
    }


@router.delete("/ft/adapters/{adapter_id}")
async def delete_adapter(adapter_id: str) -> dict:
    if not adapter_manager.delete_adapter(adapter_id):
        raise HTTPException(status_code=404, detail="Adapter not found")
    return {"deleted": True}


@router.post("/ft/adapters/{adapter_id}/merge")
async def merge_adapter(adapter_id: str) -> dict:
    try:
        merged_path = await adapter_manager.merge_adapter(adapter_id)
        return {"merged": True, "model_path": merged_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
