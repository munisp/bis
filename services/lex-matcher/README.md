# lex-matcher

Python microservice for LEX submission deduplication and name matching.

## Overview

`lex-matcher` provides three core capabilities for the BIS LEX (Law Enforcement Exchange) system:

1. **Name Similarity** — composite scoring using Levenshtein, token-sort ratio, Soundex, and Metaphone algorithms. Handles Nigerian name variants, abbreviations, and phonetic differences.
2. **Duplicate Detection** — identifies duplicate submissions using name similarity + NIN/BVN/phone cross-reference.
3. **Cross-Reference** — finds all submissions sharing a given NIN, BVN, or phone number.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/match` | Find similar submissions |
| `POST` | `/deduplicate` | Check if submission is a duplicate |
| `POST` | `/cross-ref` | Cross-reference NIN/BVN/phone |

All write endpoints require `Authorization: Bearer <BIS_API_KEY>`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BIS_API_KEY` | `lex-matcher-internal-key` | Bearer token for authentication |
| `BIS_API_URL` | `http://bff:4000` | BIS backend URL |
| `PORT` | `8090` | HTTP port |
| `MATCH_THRESHOLD` | `0.75` | Minimum similarity score for a match |

## Running Locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8090
```

## Running Tests

```bash
pip install -r requirements.txt
pytest test_main.py -v
```

## Docker

```bash
docker build -t bis-lex-matcher .
docker run -p 8090:8090 -e BIS_API_KEY=your-key bis-lex-matcher
```

## Name Matching Algorithm

The composite name similarity score is computed as:

```
score = token_sort_ratio × 0.35
      + partial_ratio    × 0.20
      + WRatio           × 0.25
      + soundex_score    × 0.10
      + metaphone_score  × 0.10
```

An ID boost of +0.30 is applied when NIN or BVN matches exactly, and +0.15 for phone number matches. The final score is capped at 1.0.

A submission is flagged as a **duplicate** when the combined score ≥ 0.90, or when an exact NIN/BVN match is found.

## Security

- All sensitive ID fields (NIN, BVN) are compared via SHA-256 hashes — plaintext values are never stored or logged.
- Phone numbers are normalized to E.164 format before comparison.
- Non-root Docker user (`appuser`).
- Bearer token authentication on all write endpoints.
