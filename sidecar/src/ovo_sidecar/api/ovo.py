from fastapi import APIRouter

router = APIRouter(tags=["ovo"])


@router.get("/models")
async def list_local_models():
    return {"models": [], "source": "stub"}


@router.get("/models/search")
async def search_models(q: str = ""):
    return {"query": q, "results": []}


@router.post("/models/download")
async def download_model():
    return {"status": "not_implemented"}


@router.get("/settings")
async def get_settings():
    return {"status": "not_implemented"}
