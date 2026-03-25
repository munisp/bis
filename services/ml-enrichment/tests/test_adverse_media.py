"""tests/test_adverse_media.py — Unit tests for adverse media NLP analysis."""
import pytest
from app.routers.adverse_media import classify_article, simple_sentiment, extract_entities


def test_classify_fraud_article():
    text = "The businessman was arrested for fraud and embezzlement of public funds."
    categories, severity = classify_article(text)
    assert "fraud" in categories
    assert severity in ("medium", "high", "critical")


def test_classify_terrorism_article():
    text = "ISWAP terrorism attack kills 12 soldiers in Borno State."
    categories, severity = classify_article(text)
    assert "terrorism" in categories
    assert severity == "critical"


def test_classify_clean_article():
    text = "The company announced record profits for the fiscal year."
    categories, severity = classify_article(text)
    assert severity == "none"
    assert len(categories) == 0


def test_classify_aml_article():
    text = "CBN fines bank for AML violations and money laundering failures."
    categories, severity = classify_article(text)
    assert "money_laundering" in categories or "regulatory" in categories
    assert severity in ("low", "medium", "high")


def test_sentiment_negative():
    text = "The CEO was convicted and sentenced for fraud and corruption."
    score = simple_sentiment(text)
    assert score < 0, f"Expected negative sentiment, got {score}"


def test_sentiment_positive():
    text = "The accused was acquitted and cleared of all charges."
    score = simple_sentiment(text)
    assert score > 0, f"Expected positive sentiment, got {score}"


def test_sentiment_neutral():
    text = "The company held its annual general meeting today."
    score = simple_sentiment(text)
    assert score == 0.0


def test_extract_entities_subject():
    entities = extract_entities("John Doe was arrested for fraud.", "John Doe")
    names = [e.text for e in entities]
    assert "John Doe" in names


def test_extract_entities_money():
    entities = extract_entities("The suspect laundered ₦500 million through shell companies.", "Suspect")
    money_entities = [e for e in entities if e.entity_type == "MONEY"]
    assert len(money_entities) >= 1


def test_severity_ordering():
    """Terrorism should always rank as critical, above fraud."""
    _, sev_terrorism = classify_article("ISWAP terrorism attack")
    _, sev_fraud = classify_article("arrested for fraud")
    severity_order = ["none", "low", "medium", "high", "critical"]
    assert severity_order.index(sev_terrorism) >= severity_order.index(sev_fraud)
