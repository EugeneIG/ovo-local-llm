from fastapi import APIRouter

router = APIRouter(tags=["ollama"])


@router.get("/api/tags")
async def list_tags():
    return {"models": []}


@router.post("/api/chat")
async def chat():
    return {"error": "not_implemented", "phase": "0"}


@router.post("/api/generate")
async def generate():
    return {"error": "not_implemented", "phase": "0"}


@router.post("/api/pull")
async def pull():
    return {"error": "not_implemented", "phase": "0"}
