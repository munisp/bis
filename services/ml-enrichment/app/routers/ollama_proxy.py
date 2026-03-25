"""
app/routers/ollama_proxy.py — Ollama LLM proxy for the BIS platform.

Exposes:
  GET  /api/v1/ollama/models        — list available local models
  POST /api/v1/ollama/generate      — single-shot completion
  POST /api/v1/ollama/chat          — multi-turn chat
  POST /api/v1/ollama/embeddings    — vector embeddings
  POST /api/v1/ollama/pull          — pull a new model (admin)
  GET  /api/v1/ollama/health        — Ollama server health check
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    model: Optional[str] = None  # Defaults to settings.ollama_default_model
    prompt: str
    system: Optional[str] = None
    options: Optional[Dict[str, Any]] = None


class ChatMessage(BaseModel):
    role: str  # system | user | assistant
    content: str


class ChatRequest(BaseModel):
    model: Optional[str] = None
    messages: List[ChatMessage]
    options: Optional[Dict[str, Any]] = None


class EmbeddingsRequest(BaseModel):
    model: Optional[str] = None
    prompt: str


class PullRequest(BaseModel):
    model: str = Field(..., description="Model name to pull, e.g. 'llama3.2', 'mistral'")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/health")
async def ollama_health(request: Request):
    """Check if the local Ollama server is reachable."""
    ollama = request.app.state.ollama
    available = await ollama.is_available()
    return {
        "ollama_available": available,
        "ollama_url": request.app.state.settings.ollama_url,
        "default_model": request.app.state.settings.ollama_default_model,
    }


@router.get("/models")
async def list_models(request: Request):
    """List all locally available Ollama models."""
    ollama = request.app.state.ollama
    models = await ollama.list_models()
    return {"models": models, "count": len(models)}


@router.post("/generate")
async def generate(req: GenerateRequest, request: Request):
    """Single-shot text generation via Ollama."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model

    try:
        result = await ollama.generate(
            model=model,
            prompt=req.prompt,
            system=req.system,
            options=req.options,
        )
        return {"model": model, "response": result}
    except Exception as e:
        log.error("ollama_proxy.generate.error", error=str(e))
        raise HTTPException(status_code=503, detail=f"LLM unavailable: {e}")


@router.post("/chat")
async def chat(req: ChatRequest, request: Request):
    """Multi-turn chat completion via Ollama."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        result = await ollama.chat(model=model, messages=messages, options=req.options)
        return {"model": model, "message": {"role": "assistant", "content": result}}
    except Exception as e:
        log.error("ollama_proxy.chat.error", error=str(e))
        raise HTTPException(status_code=503, detail=f"LLM unavailable: {e}")


@router.post("/embeddings")
async def embeddings(req: EmbeddingsRequest, request: Request):
    """Generate vector embeddings for semantic search."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or "nomic-embed-text"

    try:
        embedding = await ollama.embeddings(model=model, prompt=req.prompt)
        return {"model": model, "embedding": embedding, "dimensions": len(embedding)}
    except Exception as e:
        log.error("ollama_proxy.embeddings.error", error=str(e))
        raise HTTPException(status_code=503, detail=f"Embeddings unavailable: {e}")


@router.post("/pull")
async def pull_model(req: PullRequest, request: Request):
    """Pull a new model from the Ollama registry (admin operation)."""
    ollama = request.app.state.ollama

    async def stream_progress():
        async for line in ollama.pull_model(req.model):
            yield line + "\n"

    return StreamingResponse(stream_progress(), media_type="text/plain")
