"""
app/routers/adverse_media.py — Adverse media NLP analysis endpoint.

Pipeline:
  1. Accept raw article text or a list of article URLs
  2. Extract named entities (persons, organisations, locations)
  3. Classify article into compliance categories (fraud, corruption, AML, etc.)
  4. Compute sentiment score per article
  5. Return structured findings with severity rating
"""
from __future__ import annotations

from typing import List, Optional

import structlog
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class Article(BaseModel):
    title: str
    content: str
    url: Optional[str] = None
    published_at: Optional[str] = None
    source: Optional[str] = None


class AdverseMediaRequest(BaseModel):
    subject_name: str
    articles: List[Article] = Field(default_factory=list)
    raw_text: Optional[str] = None
    use_ollama: bool = True
    ollama_model: str = "llama3.2"


class EntityMention(BaseModel):
    text: str
    entity_type: str  # PERSON | ORG | GPE | MONEY | DATE
    count: int


class ArticleAnalysis(BaseModel):
    title: str
    url: Optional[str]
    categories: List[str]
    severity: str  # none | low | medium | high | critical
    sentiment: float  # -1.0 (negative) to 1.0 (positive)
    entities: List[EntityMention]
    summary: str


class AdverseMediaResponse(BaseModel):
    subject_name: str
    total_articles: int
    adverse_count: int
    overall_severity: str
    categories_found: List[str]
    articles: List[ArticleAnalysis]
    summary: str


# ── Category keywords ─────────────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    "fraud": ["fraud", "scam", "deception", "forgery", "embezzlement", "ponzi"],
    "corruption": ["corruption", "bribery", "kickback", "graft", "abuse of office"],
    "money_laundering": ["money laundering", "AML", "proceeds of crime", "financial crime"],
    "terrorism": ["terrorism", "terrorist", "extremism", "ISWAP", "Boko Haram"],
    "regulatory": ["sanction", "CBN", "SEC", "EFCC", "fine", "penalty", "violation"],
    "drug_trafficking": ["drug", "narcotics", "trafficking", "NDLEA"],
    "cybercrime": ["cybercrime", "hacking", "phishing", "ransomware"],
}

SEVERITY_CATEGORIES = {
    "terrorism": "critical",
    "money_laundering": "high",
    "corruption": "high",
    "fraud": "medium",
    "drug_trafficking": "high",
    "cybercrime": "medium",
    "regulatory": "low",
}


def classify_article(text: str) -> tuple[List[str], str]:
    """Keyword-based category classification and severity rating."""
    text_lower = text.lower()
    found_categories = []
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            found_categories.append(category)

    if not found_categories:
        return [], "none"

    # Severity = highest severity among found categories
    severity_order = ["none", "low", "medium", "high", "critical"]
    max_severity = "low"
    for cat in found_categories:
        cat_sev = SEVERITY_CATEGORIES.get(cat, "low")
        if severity_order.index(cat_sev) > severity_order.index(max_severity):
            max_severity = cat_sev

    return found_categories, max_severity


def simple_sentiment(text: str) -> float:
    """Lexicon-based sentiment score (-1.0 to 1.0)."""
    positive = ["acquitted", "cleared", "innocent", "exonerated", "vindicated"]
    negative = ["convicted", "arrested", "charged", "guilty", "sentenced", "fraud",
                "corrupt", "laundering", "trafficking", "bribery"]
    text_lower = text.lower()
    pos = sum(1 for w in positive if w in text_lower)
    neg = sum(1 for w in negative if w in text_lower)
    total = pos + neg
    if total == 0:
        return 0.0
    return round((pos - neg) / total, 3)


def extract_entities(text: str, subject_name: str) -> List[EntityMention]:
    """Simple entity extraction — returns subject mentions and money amounts."""
    entities = []
    name_parts = subject_name.lower().split()
    count = sum(1 for part in name_parts if part in text.lower())
    if count > 0:
        entities.append(EntityMention(text=subject_name, entity_type="PERSON", count=count))
    # Money pattern (₦ or $ followed by digits)
    import re
    money_matches = re.findall(r'[₦$]\s*[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|trillion))?', text)
    for match in money_matches[:3]:
        entities.append(EntityMention(text=match.strip(), entity_type="MONEY", count=1))
    return entities


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=AdverseMediaResponse)
async def analyze_adverse_media(req: AdverseMediaRequest, request: Request) -> AdverseMediaResponse:
    """Analyze articles for adverse media content related to a subject."""

    articles_to_analyze = list(req.articles)

    # If raw_text provided, treat it as a single article
    if req.raw_text:
        articles_to_analyze.append(Article(
            title="Raw text analysis",
            content=req.raw_text,
        ))

    analyzed: List[ArticleAnalysis] = []
    all_categories: set = set()

    for article in articles_to_analyze:
        text = f"{article.title} {article.content}"
        categories, severity = classify_article(text)
        sentiment = simple_sentiment(text)
        entities = extract_entities(text, req.subject_name)

        # Generate summary using Ollama if available
        summary = f"Article discusses {req.subject_name} in context of {', '.join(categories) or 'general news'}."
        if req.use_ollama and hasattr(request.app.state, "ollama"):
            try:
                ollama = request.app.state.ollama
                settings = request.app.state.settings
                summary = await ollama.generate(
                    model=req.ollama_model or settings.ollama_default_model,
                    prompt=f"Summarize this article in 2 sentences focusing on {req.subject_name}:\n\n{text[:1000]}",
                    system="You are a compliance analyst. Be concise and factual.",
                )
            except Exception:
                pass  # Use default summary

        all_categories.update(categories)
        analyzed.append(ArticleAnalysis(
            title=article.title,
            url=article.url,
            categories=categories,
            severity=severity,
            sentiment=sentiment,
            entities=entities,
            summary=summary,
        ))

    # Overall severity
    severity_order = ["none", "low", "medium", "high", "critical"]
    overall = "none"
    for a in analyzed:
        if severity_order.index(a.severity) > severity_order.index(overall):
            overall = a.severity

    adverse_count = sum(1 for a in analyzed if a.severity != "none")

    log.info(
        "adverse_media.analyzed",
        subject=req.subject_name,
        total=len(analyzed),
        adverse=adverse_count,
        severity=overall,
    )

    return AdverseMediaResponse(
        subject_name=req.subject_name,
        total_articles=len(analyzed),
        adverse_count=adverse_count,
        overall_severity=overall,
        categories_found=list(all_categories),
        articles=analyzed,
        summary=(
            f"Analyzed {len(analyzed)} article(s) for {req.subject_name}. "
            f"Found {adverse_count} adverse article(s) with overall severity: {overall}."
        ),
    )
