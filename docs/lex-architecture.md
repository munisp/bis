# Law Enforcement Extension (LEX) — Architecture Design

**Document type:** Technical Architecture Proposal  
**System:** Background Intelligence System (BIS)  
**Version:** 1.0 — Phase 41  
**Author:** Manus AI  
**Date:** March 2026

---

## 1. Executive Summary

The Law Enforcement Extension (LEX) is a proposed module within BIS that allows **third-party agencies** — including Nigerian law enforcement units that operate primarily on paper — to submit criminal and incident reports directly into the BIS case management system. LEX is designed to bridge the gap between analogue field operations and digital intelligence workflows, while maintaining rigorous **validation, chain-of-custody, and anti-fabrication controls** to ensure that only credible, corroborated submissions influence BIS case outcomes.

This document covers the submission model, identity and agency verification, multi-layer validation architecture, data ingestion pipeline, and the governance framework that governs how LEX reports are treated relative to internally generated BIS cases.

---

## 2. Problem Statement

### 2.1 The Paper-First Reality of Nigerian Law Enforcement

Nigerian law enforcement agencies — including the Nigeria Police Force (NPF), the Economic and Financial Crimes Commission (EFCC), the Independent Corrupt Practices Commission (ICPC), and state-level security services — conduct the majority of their investigative and incident documentation work on paper. Occurrence books, arrest reports, charge sheets, and witness statements are physically signed, stamped, and filed. Digital infrastructure is sparse, inconsistent, and rarely interoperable.

This creates a structural gap: BIS analysts may be investigating a subject who is simultaneously under active police investigation, but neither party knows. Criminal intelligence that could accelerate a compliance case sits in a physical folder at a police station. Conversely, BIS risk profiles that could assist a prosecution are invisible to the arresting officer.

### 2.2 The Fabrication Risk

Opening a digital submission channel to external agencies introduces a significant **integrity risk**. Without controls, a bad actor could:

- Submit fabricated incident reports to artificially inflate a subject's risk score.
- Use LEX submissions to harass individuals or competitors by triggering BIS investigations.
- Impersonate a legitimate law enforcement officer to lend credibility to false claims.
- Collude with an insider to launder fabricated reports through the system.

The architecture must treat every LEX submission as **untrusted by default** and require corroboration before it affects any BIS case or investigation.

---

## 3. Design Principles

The following principles govern all LEX design decisions:

| Principle | Description |
|---|---|
| **Zero trust on intake** | Every submission is unverified until it passes all validation gates. |
| **Immutable audit trail** | Every action — submission, review, approval, rejection — is permanently logged. |
| **Separation of concerns** | LEX submissions are quarantined from live BIS data until validated. |
| **Human-in-the-loop** | No LEX submission automatically modifies a case or risk score without analyst approval. |
| **Graceful degradation** | The system must work even when the submitting agency has no internet access. |
| **Privacy by design** | Personally identifiable information in submissions is encrypted at rest and access-controlled. |

---

## 4. Agency Onboarding and Identity Verification

### 4.1 Agency Registration

Before any submission can be accepted, the **agency itself** must be registered in BIS. This is a one-time, offline-initiated process:

1. The agency's commanding officer or designated data officer submits a formal request on official letterhead, including: agency name, command unit, state, the names and ranks of up to five authorised submitters, and a contact email address.
2. A BIS administrator verifies the agency's existence against the Nigeria Police Force directory, EFCC public records, or equivalent government registries.
3. Upon approval, the agency receives an **Agency Code** (e.g., `NPF-LAGOS-APAPA-001`) and a set of **Submitter Credentials** — one per named officer.

### 4.2 Submitter Identity

Each authorised submitter receives:

- A **Submitter ID** (non-guessable UUID).
- A **PIN** delivered via a separate channel (e.g., SMS to a verified phone number registered with the agency).
- An optional **physical QR code card** that encodes their Submitter ID for scanning at submission kiosks.

Submitters are not required to have email addresses or smartphones. The system is designed to work with feature phones via SMS or through a designated **LEX Submission Officer** at each agency who acts as the digital intermediary.

### 4.3 Credential Rotation and Revocation

Credentials are valid for 12 months and must be renewed by the agency's commanding officer. Any credential can be revoked instantly by a BIS administrator. Revocation is logged and all pending submissions from the revoked submitter are placed in a "suspended" queue pending review.

---

## 5. Submission Channels

LEX supports three submission channels, ordered from most to least digital:

### 5.1 Web Portal (Preferred)

A dedicated, mobile-optimised web portal at `/lex/submit` accepts structured form submissions. The form is designed for low-bandwidth environments (no images required, progressive enhancement, works on 2G). Fields are pre-validated client-side to reduce round trips.

The portal supports:

- Incident type selection (arrest, seizure, witness statement, court order, intelligence tip).
- Subject identification (name, NIN if known, phone, address, physical description).
- Incident narrative (free text, up to 5,000 characters).
- Supporting document upload (photos of physical documents, up to 5 files, 5 MB each).
- GPS coordinates (auto-populated from device if available, manual entry otherwise).
- Submitter authentication via Submitter ID + PIN.

### 5.2 SMS Gateway

For agencies with no internet access, a structured SMS format is supported:

```
LEX [SubmitterID] [PIN] [IncidentType] [SubjectName] [NIN/Phone] [Narrative (max 160 chars)]
```

The SMS gateway parses incoming messages, validates the Submitter ID and PIN, and creates a draft LEX submission flagged as "SMS — requires document follow-up". The submitter receives a confirmation SMS with a **Reference Code** they can use to attach documents later via the portal or by physical mail.

### 5.3 Physical Submission (Offline)

For agencies that cannot use either channel, BIS provides a **standardised LEX paper form** (Form LEX-01). The form includes:

- A unique pre-printed barcode tied to the issuing agency.
- Fields for all required incident data.
- A signature block for the submitting officer and a countersignature block for their supervisor.

Completed forms are physically delivered to a designated BIS intake point (or scanned and emailed by the agency's administrative officer). A BIS data entry operator digitises the form, attaches a scan, and creates the LEX submission on behalf of the officer. The operator's ID is recorded alongside the original submitter's ID.

---

## 6. The LEX Submission Data Model

LEX submissions are stored in a dedicated `lex_submissions` table, **separate from the main `cases` table**, until validated.

```
lex_submissions
├── id                  (PK)
├── submissionRef       (e.g. LEX-2026-0042)
├── agencyCode          (FK → lex_agencies)
├── submitterId         (FK → lex_submitters)
├── channel             (web | sms | physical)
├── incidentType        (arrest | seizure | witness_statement | court_order | intel_tip)
├── subjectName
├── subjectNin
├── subjectPhone
├── subjectAddress
├── narrative           (encrypted at rest)
├── gpsLat / gpsLng
├── incidentDate
├── documents           (JSON array of S3 keys)
├── status              (pending | under_review | validated | rejected | escalated)
├── validationScore     (0–100, computed)
├── validationNotes     (JSON, per-check results)
├── reviewedBy          (FK → users, BIS analyst)
├── reviewedAt
├── linkedCaseId        (FK → cases, set after validation)
├── rejectionReason
├── createdAt
└── updatedAt
```

---

## 7. Multi-Layer Validation Architecture

This is the most critical component of LEX. Every submission passes through **five validation layers** before a BIS analyst can approve it for case linkage.

### Layer 1 — Structural Validation (Automated, Instant)

Checks that the submission is technically complete:

- Submitter ID and PIN are valid and not revoked.
- Required fields (incident type, subject name, narrative) are present.
- Narrative is at least 50 characters (filters out accidental or test submissions).
- Incident date is not in the future and not more than 5 years in the past.
- If documents are attached, they pass virus scanning and format validation.

**Outcome:** Pass/Fail. Failures are returned to the submitter immediately with a specific error code.

### Layer 2 — Identity Cross-Check (Automated, Near-Instant)

If the submission includes a subject NIN or BVN, BIS queries its existing identity data:

- Does the NIN/BVN exist in BIS's identity database?
- Is the subject already linked to an active BIS investigation or case?
- Does the subject appear on any sanctions or PEP list?

This layer does **not** validate the submission — it enriches it. The results are attached as `validationNotes` and surfaced to the reviewing analyst. A subject who is already under BIS investigation is a positive corroboration signal; a subject with no prior BIS history is neutral.

### Layer 3 — Geospatial Plausibility (Automated)

If GPS coordinates are provided:

- Are the coordinates within Nigeria? (Bounding box check.)
- Does the stated incident location match the submitting agency's jurisdiction? (A Lagos police unit submitting an incident in Kano is flagged for review.)
- If multiple submissions from the same agency reference the same GPS point within 24 hours, they are flagged as potentially duplicated.

### Layer 4 — Duplicate and Velocity Detection (Automated)

- Has the same submitter submitted more than 5 reports in the last 24 hours? (Velocity spike — flagged.)
- Does this submission share >80% text similarity with another submission from the same agency in the last 30 days? (Potential duplicate or copy-paste fabrication — flagged.)
- Has the same subject NIN/phone been submitted by more than 3 different agencies in the last 7 days? (Coordinated targeting — escalated to BIS supervisor.)

Text similarity is computed using a simple trigram overlap algorithm that runs entirely in-process with no external dependency.

### Layer 5 — Human Review (Manual, Required)

No LEX submission can be linked to a BIS case without explicit approval from a **BIS analyst** (role: `analyst` or above). The analyst review interface presents:

- The full submission with all enrichment data from Layers 1–4.
- A **Validation Score** (0–100) computed from the automated layers, with a breakdown.
- A side-by-side view of any existing BIS case or investigation linked to the subject.
- The submitting officer's submission history (how many submissions, how many validated, how many rejected).
- A map view of the incident location.

The analyst can:

- **Validate** — approve the submission and link it to an existing or new BIS case.
- **Reject** — reject with a mandatory reason code.
- **Request clarification** — send a structured query back to the submitting agency (via SMS or portal notification).
- **Escalate** — refer to a supervisor for a second opinion.

**Validation Score thresholds:**

| Score | Analyst Action Required |
|---|---|
| 80–100 | Recommended for approval; analyst can approve with one click |
| 50–79 | Standard review required |
| 20–49 | Enhanced review required; supervisor co-sign recommended |
| 0–19 | Automatic hold; supervisor must approve before analyst can act |

---

## 8. Anti-Fabrication Controls

Beyond the five validation layers, LEX implements the following specific anti-fabrication measures:

### 8.1 Supervisor Countersignature

All physical (Form LEX-01) submissions require a countersignature from the submitting officer's direct supervisor. The supervisor's name and rank are recorded. BIS does not verify the countersignature cryptographically, but its presence creates a **chain of accountability** within the submitting agency — if a submission is later found to be fabricated, the supervisor is also implicated.

### 8.2 Document Authenticity Signals

When documents are uploaded (photos of physical forms, court orders, etc.):

- **EXIF metadata** is extracted and stored: device model, timestamp, GPS coordinates embedded in the photo. A photo taken at a different time or place than the stated incident is flagged.
- **LLM-assisted OCR review**: the document is OCR'd and an LLM prompt checks whether the content is internally consistent with the submission narrative. Inconsistencies are surfaced as a flag, not an automatic rejection.
- **Duplicate image detection**: perceptual hashing detects if the same image has been submitted in a previous LEX submission (potentially reused across fabricated reports).

### 8.3 Submitter Reputation Score

Each submitter accumulates a **Reputation Score** based on their submission history:

- +10 for each validated submission.
- −20 for each rejected submission (fabrication or error).
- −5 for each submission that required clarification.
- −30 for any submission flagged as coordinated targeting.

Submitters with a Reputation Score below 0 are automatically placed in enhanced review. Submitters below −50 are suspended pending agency review.

### 8.4 Agency-Level Anomaly Detection

At the agency level, BIS tracks:

- Submission volume over time (unusual spikes are flagged).
- Validation rate (agencies with <30% validation rate trigger an audit).
- Subject diversity (an agency that repeatedly submits reports on the same individual is flagged for potential harassment).

### 8.5 Immutable Audit Trail

Every action in the LEX pipeline is written to the BIS `audit_log` table with category `"lex"`. Entries cannot be deleted or modified. This log is available to BIS supervisors and, in the event of a legal challenge, can be produced as evidence of the chain of custody for any submission.

---

## 9. Integration with BIS Case Management

Once a LEX submission is validated by an analyst, it is integrated into BIS as follows:

1. A new **Case** is created (or the submission is linked to an existing case) with type `"criminal_report"` and source `"lex"`.
2. The submitting agency and officer are recorded as a **Case Stakeholder** with role `"law_enforcement"`.
3. The original submission documents are attached to the case as **Case Documents** with `confidential = true` by default.
4. A **Timeline Event** of type `"document_uploaded"` is created with a note indicating the LEX source.
5. The subject's risk score is **recalculated** using the standard `recalculateRiskScore` procedure, which now incorporates the new case data.
6. If the submission triggered any alert rules (e.g., a sanctions hit on the subject NIN), those alerts are fired normally.

Crucially, the LEX submission itself is **never deleted** — it remains in `lex_submissions` with status `"validated"` and a `linkedCaseId` pointing to the resulting case. This preserves the original, unmodified submission as a permanent record.

---

## 10. Privacy and Data Protection

LEX submissions contain sensitive personal data about individuals who may not be convicted of any offence. The following controls apply:

- **Encryption at rest**: the `narrative` field and all document S3 keys are encrypted using AES-256. The encryption key is stored in the BIS secrets manager, separate from the database.
- **Access control**: only BIS analysts and above can view LEX submission details. The submitting agency cannot view how their submission was processed or what BIS case it was linked to.
- **Retention policy**: rejected LEX submissions are purged after 90 days. Validated submissions are retained for 7 years (aligned with Nigerian financial crime record-keeping requirements).
- **Right to erasure**: if a subject successfully challenges a LEX submission as fabricated, the submission is marked `"expunged"` and excluded from all queries. The original record is retained in a restricted archive for legal purposes but is invisible to normal BIS operations.

---

## 11. Implementation Roadmap

| Phase | Deliverable | Effort |
|---|---|---|
| **LEX-1** | Agency and submitter registration UI (admin panel) | 1 week |
| **LEX-2** | `lex_submissions` schema, web portal, SMS gateway stub | 2 weeks |
| **LEX-3** | Automated validation layers 1–4, validation score engine | 2 weeks |
| **LEX-4** | Analyst review UI, approval/rejection workflow | 1 week |
| **LEX-5** | Case integration, risk score recalculation, audit trail | 1 week |
| **LEX-6** | Document authenticity signals (EXIF, LLM OCR, perceptual hash) | 2 weeks |
| **LEX-7** | Submitter reputation score, agency anomaly detection | 1 week |
| **LEX-8** | Physical form (LEX-01) design, print-ready PDF generation | 1 week |
| **LEX-9** | Pilot with one agency, feedback loop, hardening | 2 weeks |

Total estimated effort: **13 weeks** for a production-ready LEX module.

---

## 12. Key Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fabricated submissions from compromised submitter credentials | Medium | High | Reputation scoring, velocity detection, human review gate |
| Coordinated targeting of a single subject by multiple agencies | Low | High | Cross-agency velocity check, supervisor escalation |
| SMS channel used for bulk spam submissions | Medium | Medium | Rate limiting (5/day/submitter), structural validation |
| EXIF metadata stripped from uploaded photos | High | Low | Flag as "no metadata" — not a rejection, but reduces validation score |
| Agency refuses to participate due to data sovereignty concerns | Medium | Medium | Data residency guarantee (all data stored in Nigerian data centre or sovereign cloud) |
| BIS analyst approves fabricated submission due to workload | Low | High | Mandatory supervisor co-sign for low-score submissions, random audit of 10% of approvals |

---

## 13. Conclusion

LEX is a pragmatic bridge between Nigeria's paper-first law enforcement reality and BIS's digital intelligence platform. By designing for the lowest common denominator — feature phones, physical forms, and offline workflows — while maintaining strict validation and anti-fabrication controls, LEX can meaningfully expand the intelligence surface available to BIS analysts without compromising the integrity of the platform.

The five-layer validation architecture, combined with submitter reputation scoring, document authenticity signals, and a mandatory human review gate, ensures that no fabricated submission can automatically damage a subject's risk profile. The immutable audit trail provides the legal defensibility required for any submission that ultimately contributes to a prosecution or regulatory action.

The recommended next step is to pilot LEX with a single agency — ideally the EFCC, which has a higher baseline of digital literacy than general police units — before rolling out to broader law enforcement partners.
