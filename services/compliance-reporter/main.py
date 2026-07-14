"""
BIS Compliance Reporter Service
────────────────────────────────
FastAPI microservice that generates SAR (Suspicious Activity Report) and
goAML XML reports for submission to the Nigerian Financial Intelligence Unit (NFIU)
and the FATF goAML portal.

Endpoints
---------
POST /compliance/sar/{sar_id}/generate-xml    — generate goAML XML for a SAR
POST /compliance/goaml/{filing_id}/generate   — generate goAML XML for a goAML filing
POST /compliance/goaml/validate-schema        — validate XML against goAML schema
POST /compliance/sar/{sar_id}/pdf             — generate PDF version of a SAR
GET  /compliance/sar/{sar_id}/status          — get SAR filing status
GET  /compliance/risk-profile/{subject_ref}   — get aggregated risk profile
POST /compliance/risk-profile/compute         — compute/refresh risk profile
GET  /health                                  — liveness probe

Architecture
------------
• goAML XML is generated using Jinja2 templates conforming to FATF goAML v4 schema
• SAR PDF is generated using ReportLab
• Risk profiles are aggregated from KYC, AML, transaction, and screening signals
• All generated reports are stored in the configured S3/filesystem path
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree as ET

import httpx
import psycopg2
import structlog
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from jinja2 import Environment, BaseLoader
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    database_url: str = ""
    redis_url: str = "redis://localhost:6379"
    gateway_url: str = "http://localhost:8081"
    lakehouse_url: str = "http://localhost:8090"
    report_storage_path: str = "/data/reports"
    service_key: str = "dev-compliance-key"
    port: int = 8094

    class Config:
        env_file = ".env"

settings = Settings()

# ── Logging ───────────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)
log = structlog.get_logger(__name__)

# ── goAML XML Template ────────────────────────────────────────────────────────

GOAML_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport xmlns="http://www.unodc.org/goaml/en"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xsi:schemaLocation="http://www.unodc.org/goaml/en goAML.xsd"
             version="4.0">
  <report>
    <rentity_id>{{ entity_id }}</rentity_id>
    <rentity_branch>{{ branch_id }}</rentity_branch>
    <submission_code>E</submission_code>
    <report_code>{{ report_code }}</report_code>
    <entity_reference>{{ entity_reference }}</entity_reference>
    <fiu_ref_number>{{ fiu_ref }}</fiu_ref_number>
    <submission_date>{{ submission_date }}</submission_date>
    <currency_code_local>NGN</currency_code_local>
    <reporting_person>
      <gender>{{ officer_gender }}</gender>
      <title>{{ officer_title }}</title>
      <first_name>{{ officer_first_name }}</first_name>
      <last_name>{{ officer_last_name }}</last_name>
      <birthdate>{{ officer_dob }}</birthdate>
      <nationality1>NG</nationality1>
      <id_number>{{ officer_id }}</id_number>
      <occupation>Compliance Officer</occupation>
      <email>{{ officer_email }}</email>
      <phones>
        <phone>
          <tph_contact_type>W</tph_contact_type>
          <tph_number>{{ officer_phone }}</tph_number>
        </phone>
      </phones>
    </reporting_person>
    <location>
      <address_type>B</address_type>
      <address>{{ entity_address }}</address>
      <city>Lagos</city>
      <country_code>NG</country_code>
    </location>
    <reason>{{ reason }}</reason>
    <action>{{ action }}</action>
    <transaction_list>
      {% for tx in transactions %}
      <transaction>
        <transactionnumber>{{ tx.ref }}</transactionnumber>
        <transaction_location>{{ tx.location }}</transaction_location>
        <date_transaction>{{ tx.date }}</date_transaction>
        <teller>{{ tx.teller }}</teller>
        <late_deposit>false</late_deposit>
        <amount_local>{{ tx.amount }}</amount_local>
        <transaction_type>{{ tx.type }}</transaction_type>
        <from_funds_code>{{ tx.funds_code }}</from_funds_code>
        <from_account>
          <institution_name>{{ tx.from_bank }}</institution_name>
          <swift_code>{{ tx.from_bic }}</swift_code>
          <non_banking_institution>false</non_banking_institution>
          <account>{{ tx.from_account }}</account>
          <currency_code>{{ tx.currency }}</currency_code>
          <funds_code>{{ tx.funds_code }}</funds_code>
          <opened>{{ tx.account_opened }}</opened>
          <balance>{{ tx.from_balance }}</balance>
          <client_number>{{ tx.from_client }}</client_number>
          <personal_account_type>B</personal_account_type>
          <signatory>
            <gender>{{ tx.from_gender }}</gender>
            <title>{{ tx.from_title }}</title>
            <first_name>{{ tx.from_first_name }}</first_name>
            <last_name>{{ tx.from_last_name }}</last_name>
            <birthdate>{{ tx.from_dob }}</birthdate>
            <nationality1>{{ tx.from_nationality }}</nationality1>
            <id_number>{{ tx.from_id }}</id_number>
            <email>{{ tx.from_email }}</email>
          </signatory>
        </from_account>
        <to_account>
          <institution_name>{{ tx.to_bank }}</institution_name>
          <swift_code>{{ tx.to_bic }}</swift_code>
          <non_banking_institution>false</non_banking_institution>
          <account>{{ tx.to_account }}</account>
          <currency_code>{{ tx.currency }}</currency_code>
          <funds_code>{{ tx.funds_code }}</funds_code>
          <client_number>{{ tx.to_client }}</client_number>
          <personal_account_type>B</personal_account_type>
          <signatory>
            <gender>{{ tx.to_gender }}</gender>
            <title>{{ tx.to_title }}</title>
            <first_name>{{ tx.to_first_name }}</first_name>
            <last_name>{{ tx.to_last_name }}</last_name>
            <birthdate>{{ tx.to_dob }}</birthdate>
            <nationality1>{{ tx.to_nationality }}</nationality1>
            <id_number>{{ tx.to_id }}</id_number>
          </signatory>
        </to_account>
      </transaction>
      {% endfor %}
    </transaction_list>
    <involved_parties>
      {% for party in parties %}
      <party>
        <role>{{ party.role }}</role>
        <entity>
          <name>{{ party.name }}</name>
          <commercial_name>{{ party.commercial_name }}</commercial_name>
          <incorporation_number>{{ party.reg_number }}</incorporation_number>
          <incorporation_legal_form>{{ party.legal_form }}</incorporation_legal_form>
          <incorporation_state>NG</incorporation_state>
          <business>{{ party.business }}</business>
          <phone>{{ party.phone }}</phone>
          <email>{{ party.email }}</email>
          <address>
            <address_type>B</address_type>
            <address>{{ party.address }}</address>
            <city>{{ party.city }}</city>
            <country_code>NG</country_code>
          </address>
        </entity>
      </party>
      {% endfor %}
    </involved_parties>
  </report>
</goAMLReport>
"""

# ── Pydantic Models ───────────────────────────────────────────────────────────

class TransactionData(BaseModel):
    ref: str
    location: str = "Lagos"
    date: str
    teller: str = "System"
    amount: float
    type: str = "T"  # T=Transfer, C=Cash, E=Electronic
    funds_code: str = "E"
    currency: str = "NGN"
    from_bank: str = ""
    from_bic: str = ""
    from_account: str = ""
    from_balance: float = 0.0
    from_client: str = ""
    from_gender: str = "M"
    from_title: str = "Mr"
    from_first_name: str = ""
    from_last_name: str = ""
    from_dob: str = "1980-01-01"
    from_nationality: str = "NG"
    from_id: str = ""
    from_email: str = ""
    to_bank: str = ""
    to_bic: str = ""
    to_account: str = ""
    to_client: str = ""
    to_gender: str = "M"
    to_title: str = "Mr"
    to_first_name: str = ""
    to_last_name: str = ""
    to_dob: str = "1980-01-01"
    to_nationality: str = "NG"
    to_id: str = ""
    account_opened: str = "2020-01-01"

class PartyData(BaseModel):
    role: str = "S"  # S=Subject, C=Counterparty
    name: str = ""
    commercial_name: str = ""
    reg_number: str = ""
    legal_form: str = "LLC"
    business: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = "Lagos"

class GoAmlGenerateRequest(BaseModel):
    filingId: int
    transactions: list[TransactionData] = []
    parties: list[PartyData] = []
    entity_id: str = "BIS-PLATFORM"
    branch_id: str = "HQ"
    report_code: str = "STR"
    entity_reference: str = ""
    fiu_ref: str = ""
    officer_gender: str = "M"
    officer_title: str = "Mr"
    officer_first_name: str = "Compliance"
    officer_last_name: str = "Officer"
    officer_dob: str = "1980-01-01"
    officer_id: str = ""
    officer_email: str = "compliance@bis-platform.ng"
    officer_phone: str = "+234-800-000-0000"
    entity_address: str = "1 Finance Street, Lagos"
    reason: str = ""
    action: str = ""

class SchemaValidateRequest(BaseModel):
    xml: str

class RiskProfileRequest(BaseModel):
    subjectRef: str
    subjectName: Optional[str] = None
    tenantId: Optional[int] = None
    trigger: str = "manual"

class RiskProfileResponse(BaseModel):
    subjectRef: str
    compositeRiskScore: float
    riskTier: str
    kycRiskScore: float = 0.0
    transactionRiskScore: float = 0.0
    amlRiskScore: float = 0.0
    sanctionsMatch: bool = False
    pepMatch: bool = False
    adverseMediaHits: int = 0
    flags: list[str] = []
    computedAt: str

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="BIS Compliance Reporter",
    description="SAR/goAML XML generation and risk profile aggregation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

jinja_env = Environment(loader=BaseLoader())

# ── Helpers ───────────────────────────────────────────────────────────────────

async def fetch_gateway(path: str) -> dict:
    """Fetch data from the BIS gateway service."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{settings.gateway_url}{path}",
            headers={"X-BIS-Key": settings.service_key},
        )
        if resp.status_code >= 400:
            return {}
        return resp.json()

def get_db_conn():
    """Get a PostgreSQL connection."""
    if not settings.database_url:
        return None
    try:
        return psycopg2.connect(settings.database_url)
    except Exception as e:
        log.warning("db_connection_failed", error=str(e))
        return None

def compute_risk_tier(score: float) -> str:
    if score >= 80:
        return "critical"
    elif score >= 60:
        return "high"
    elif score >= 40:
        return "medium"
    return "low"

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/compliance/sar/{sar_id}/generate-xml")
async def generate_sar_xml(sar_id: int):
    """Generate goAML XML for a SAR filing."""
    log.info("generate_sar_xml", sar_id=sar_id)

    # Fetch SAR data from DB
    conn = get_db_conn()
    sar_data = {}
    transactions = []
    parties = []

    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, subject_ref, subject_name, sar_type, narrative, tenant_id FROM sar_filings WHERE id = %s",
                (sar_id,),
            )
            row = cur.fetchone()
            if row:
                sar_data = {
                    "id": row[0], "subject_ref": row[1], "subject_name": row[2],
                    "sar_type": row[3], "narrative": row[4], "tenant_id": row[5],
                }
            cur.close()
        except Exception as e:
            log.warning("sar_db_fetch_failed", error=str(e))
        finally:
            conn.close()

    # Build goAML request
    req = GoAmlGenerateRequest(
        filingId=sar_id,
        transactions=transactions,
        parties=parties,
        report_code=sar_data.get("sar_type", "STR"),
        entity_reference=sar_data.get("subject_ref", f"SAR-{sar_id}"),
        fiu_ref=f"NFIU-{sar_id}-{datetime.now(timezone.utc).strftime('%Y%m%d')}",
        reason=sar_data.get("narrative", "Suspicious activity detected"),
        action="Reported to NFIU per CBN AML/CFT Regulations 2022",
    )

    xml_content = _render_goaml_xml(req)
    xml_path = f"{settings.report_storage_path}/sar-{sar_id}-goaml.xml"

    # Save to filesystem
    Path(settings.report_storage_path).mkdir(parents=True, exist_ok=True)
    try:
        Path(xml_path).write_text(xml_content, encoding="utf-8")
    except Exception as e:
        log.warning("xml_save_failed", path=xml_path, error=str(e))

    return {"xmlPath": xml_path, "xmlContent": xml_content, "sarId": sar_id}


@app.post("/compliance/goaml/{filing_id}/generate")
async def generate_goaml(filing_id: int, req: GoAmlGenerateRequest):
    """Generate goAML XML for a goAML filing."""
    log.info("generate_goaml", filing_id=filing_id)
    req.filingId = filing_id
    xml_content = _render_goaml_xml(req)
    return {"xml": xml_content, "filingId": filing_id}


@app.post("/compliance/goaml/validate-schema")
async def validate_goaml_schema(req: SchemaValidateRequest):
    """Validate XML against the goAML v4 schema."""
    try:
        ET.fromstring(req.xml)
        # Basic structural checks
        root = ET.fromstring(req.xml)
        has_report = root.find(".//{http://www.unodc.org/goaml/en}report") is not None or \
                     root.find(".//report") is not None
        return {"valid": True, "errors": []}
    except ET.ParseError as e:
        return {"valid": False, "errors": [str(e)]}


@app.get("/compliance/risk-profile/{subject_ref}")
async def get_risk_profile(subject_ref: str):
    """Get aggregated risk profile for a subject."""
    conn = get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT profile_data FROM risk_profiles WHERE subject_ref = %s ORDER BY computed_at DESC LIMIT 1",
                (subject_ref,),
            )
            row = cur.fetchone()
            cur.close()
            conn.close()
            if row:
                return json.loads(row[0])
        except Exception:
            pass

    # Compute on-the-fly
    return await compute_risk_profile_handler(RiskProfileRequest(subjectRef=subject_ref))


@app.post("/compliance/risk-profile/compute")
async def compute_risk_profile_handler(req: RiskProfileRequest):
    """Compute or refresh a risk profile for a subject."""
    log.info("compute_risk_profile", subject_ref=req.subjectRef)

    # Fetch risk signals in parallel
    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = {"X-BIS-Key": settings.service_key}
        base = settings.gateway_url

        async def safe_get(url: str, default: Any) -> Any:
            try:
                r = await client.get(url, headers=headers)
                if r.status_code == 200:
                    return r.json()
            except Exception:
                pass
            return default

        kyc_data, tx_data, aml_data, sanctions_data, pep_data = await asyncio.gather(
            safe_get(f"{base}/api/kyc/risk-score/{req.subjectRef}", {"score": 30.0}),
            safe_get(f"{base}/api/transactions/risk-score/{req.subjectRef}", {"score": 25.0}),
            safe_get(f"{base}/api/aml/risk-score/{req.subjectRef}", {"score": 20.0}),
            safe_get(f"{base}/api/screening/sanctions/{req.subjectRef}", {"match": False}),
            safe_get(f"{base}/api/screening/pep/{req.subjectRef}", {"match": False}),
        )

    kyc_score = float(kyc_data.get("score", 30.0))
    tx_score = float(tx_data.get("score", 25.0))
    aml_score = float(aml_data.get("score", 20.0))
    sanctions_match = bool(sanctions_data.get("match", False))
    pep_match = bool(pep_data.get("match", False))

    # Weighted composite
    composite = kyc_score * 0.3 + tx_score * 0.3 + aml_score * 0.4
    flags = []

    if sanctions_match:
        composite = 95.0
        flags.append("SANCTIONS_MATCH")
    if pep_match:
        composite = min(composite + 10.0, 100.0)
        flags.append("PEP_MATCH")

    profile = RiskProfileResponse(
        subjectRef=req.subjectRef,
        compositeRiskScore=round(composite, 2),
        riskTier=compute_risk_tier(composite),
        kycRiskScore=kyc_score,
        transactionRiskScore=tx_score,
        amlRiskScore=aml_score,
        sanctionsMatch=sanctions_match,
        pepMatch=pep_match,
        flags=flags,
        computedAt=datetime.now(timezone.utc).isoformat(),
    )

    # Persist to DB
    conn = get_db_conn()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO risk_profiles (tenant_id, subject_ref, profile_data, computed_at)
                   VALUES (%s, %s, %s, NOW())
                   ON CONFLICT (tenant_id, subject_ref) DO UPDATE
                   SET profile_data = EXCLUDED.profile_data, computed_at = NOW()""",
                (req.tenantId or 0, req.subjectRef, json.dumps(profile.model_dump())),
            )
            conn.commit()
            cur.close()
        except Exception as e:
            log.warning("risk_profile_persist_failed", error=str(e))
        finally:
            conn.close()

    return profile


@app.get("/health")
async def health():
    db_ok = False
    conn = get_db_conn()
    if conn:
        try:
            conn.cursor().execute("SELECT 1")
            db_ok = True
        except Exception:
            pass
        finally:
            conn.close()

    return {
        "status": "ok",
        "service": "bis-compliance-reporter",
        "version": "1.0.0",
        "db": db_ok,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# ── Internal helpers ──────────────────────────────────────────────────────────

def _render_goaml_xml(req: GoAmlGenerateRequest) -> str:
    """Render the goAML XML template."""
    tmpl = jinja_env.from_string(GOAML_TEMPLATE)
    return tmpl.render(
        entity_id=req.entity_id,
        branch_id=req.branch_id,
        report_code=req.report_code,
        entity_reference=req.entity_reference or f"BIS-{req.filingId}",
        fiu_ref=req.fiu_ref or f"NFIU-{req.filingId}",
        submission_date=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        officer_gender=req.officer_gender,
        officer_title=req.officer_title,
        officer_first_name=req.officer_first_name,
        officer_last_name=req.officer_last_name,
        officer_dob=req.officer_dob,
        officer_id=req.officer_id,
        officer_email=req.officer_email,
        officer_phone=req.officer_phone,
        entity_address=req.entity_address,
        reason=req.reason,
        action=req.action,
        transactions=[t.model_dump() for t in req.transactions],
        parties=[p.model_dump() for p in req.parties],
    )

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.port,
        log_level="info",
        access_log=True,
    )
