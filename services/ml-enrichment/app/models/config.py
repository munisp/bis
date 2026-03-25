"""app/models/config.py — Pydantic settings for the ML enrichment service."""
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    env: str = "development"
    port: int = 8083
    database_url: str = "mysql+aiomysql://root:@localhost:3306/bis_db"
    ollama_url: str = "http://localhost:11434"
    ollama_default_model: str = "llama3.2"
    ollama_fallback_to_cloud: bool = True
    cloud_llm_url: str = ""
    cloud_llm_key: str = ""
    allowed_origins: List[str] = ["http://localhost:3000", "http://localhost:5173"]
    jwt_secret: str = "dev-secret"
    # Lakehouse / data warehouse connection
    lakehouse_url: str = ""
    lakehouse_token: str = ""
    # SERP API for live OSINT
    serp_api_key: str = ""

    class Config:
        env_file = "../../.env"
        env_file_encoding = "utf-8"
        extra = "ignore"
