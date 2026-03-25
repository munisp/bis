"""
app/services/ollama_client.py — Async Ollama HTTP client with cloud fallback.

Supports:
  - /api/generate  (single-shot completion)
  - /api/chat      (multi-turn conversation)
  - /api/tags      (list available models)
  - /api/pull      (pull a model by name)
  - /api/embeddings (generate embeddings for semantic search)
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
import structlog

log = structlog.get_logger(__name__)


class OllamaClient:
    """Async HTTP client for a local Ollama instance with cloud LLM fallback."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        timeout: float = 120.0,
        cloud_url: str = "",
        cloud_key: str = "",
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.cloud_url = cloud_url
        self.cloud_key = cloud_key
        self._client = httpx.AsyncClient(timeout=timeout)

    # ── Model management ──────────────────────────────────────────────────────

    async def list_models(self) -> List[Dict[str, Any]]:
        """Return all locally available models."""
        try:
            resp = await self._client.get(f"{self.base_url}/api/tags")
            resp.raise_for_status()
            return resp.json().get("models", [])
        except Exception as e:
            log.warning("ollama.list_models.failed", error=str(e))
            return []

    async def pull_model(self, model: str) -> AsyncIterator[str]:
        """Pull a model from the Ollama registry, streaming progress."""
        async with self._client.stream(
            "POST",
            f"{self.base_url}/api/pull",
            json={"name": model},
        ) as resp:
            async for line in resp.aiter_lines():
                if line:
                    yield line

    async def is_available(self) -> bool:
        """Check if the Ollama server is reachable."""
        try:
            resp = await self._client.get(f"{self.base_url}/api/tags", timeout=5.0)
            return resp.status_code == 200
        except Exception:
            return False

    # ── Completion ────────────────────────────────────────────────────────────

    async def generate(
        self,
        model: str,
        prompt: str,
        system: Optional[str] = None,
        stream: bool = False,
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Single-shot text generation. Returns the full response text."""
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system
        if options:
            payload["options"] = options

        try:
            resp = await self._client.post(
                f"{self.base_url}/api/generate",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json().get("response", "")
        except Exception as e:
            log.warning("ollama.generate.failed", model=model, error=str(e))
            if self.cloud_url and self.cloud_key:
                return await self._cloud_fallback(prompt, system)
            raise

    async def chat(
        self,
        model: str,
        messages: List[Dict[str, str]],
        stream: bool = False,
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Multi-turn chat completion. Returns the assistant message content."""
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if options:
            payload["options"] = options

        try:
            resp = await self._client.post(
                f"{self.base_url}/api/chat",
                json=payload,
            )
            resp.raise_for_status()
            return resp.json().get("message", {}).get("content", "")
        except Exception as e:
            log.warning("ollama.chat.failed", model=model, error=str(e))
            if self.cloud_url and self.cloud_key:
                last_user = next(
                    (m["content"] for m in reversed(messages) if m["role"] == "user"),
                    "",
                )
                system = next(
                    (m["content"] for m in messages if m["role"] == "system"),
                    None,
                )
                return await self._cloud_fallback(last_user, system)
            raise

    async def embeddings(self, model: str, prompt: str) -> List[float]:
        """Generate embeddings for semantic search / similarity."""
        try:
            resp = await self._client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": model, "prompt": prompt},
            )
            resp.raise_for_status()
            return resp.json().get("embedding", [])
        except Exception as e:
            log.warning("ollama.embeddings.failed", model=model, error=str(e))
            return []

    # ── Cloud fallback ────────────────────────────────────────────────────────

    async def _cloud_fallback(self, prompt: str, system: Optional[str]) -> str:
        """Fall back to the configured cloud LLM API (OpenAI-compatible)."""
        if not self.cloud_url or not self.cloud_key:
            return "[Ollama unavailable and no cloud fallback configured]"

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        try:
            resp = await self._client.post(
                f"{self.cloud_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.cloud_key}"},
                json={"model": "gpt-4o-mini", "messages": messages},
                timeout=60.0,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            log.error("ollama.cloud_fallback.failed", error=str(e))
            return "[LLM unavailable — please retry]"

    async def close(self):
        await self._client.aclose()
