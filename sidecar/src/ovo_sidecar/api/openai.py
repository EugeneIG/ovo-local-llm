from fastapi import APIRouter

router = APIRouter(tags=["openai"])


@router.get("/models")
async def list_models():
    return {"object": "list", "data": []}


@router.post("/chat/completions")
async def chat_completions():
    return {"error": {"message": "not_implemented", "type": "not_implemented"}}
