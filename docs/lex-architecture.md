# Law Enforcement Extension (LEX) — Architecture Design

**Document type:** Technical Architecture Proposal  
**System:** Background Intelligence System (BIS)  
**Version:** 2.0 — Phase 42 (State-Scoped Jurisdiction)  
**Author:** Manus AI  
**Date:** March 2026

---

## 1. Executive Summary

The Law Enforcement Extension (LEX) is a module within BIS that allows **third-party law enforcement agencies** — including Nigerian police units, the EFCC, ICPC, and state security services — to submit criminal and incident reports directly into the BIS case management system. Every agency in LEX is **tied to a specific Nigerian state** (and optionally a Local Government Area and command unit), and every submission is validated against that geographic scope. This jurisdictional binding is the primary structural control that prevents cross-state fabrication, impersonation, and data pollution.

---

## 2. The Nigerian State Jurisdiction Model

Nigeria is divided into **36 states plus the Federal Capital Territory (FCT)**. Law enforcement in Nigeria is organised along these state lines: the Nigeria Police Force has a **State Command** in each state, with **Area Commands** and **Divisional Police Headquarters** at the LGA level. The EFCC and ICPC operate **Zonal Offices** that map to groups of states.

LEX mirrors this structure exactly. An agency registered in BIS is always associated with:

1. **State** — one of the 37 jurisdictions (36 states + FCT Abuja).
2. **LGA** — the specific Local Government Area of the command unit (optional but recommended).
3. **Command Unit** — a free-text label for the specific station or office (e.g., "Apapa Area Command", "Lagos Zonal Office").

This three-level hierarchy means that a submission from the Lagos State Command cannot be used to report an incident in Kano, and a Kano Divisional HQ cannot submit on behalf of Abuja FCT. The jurisdiction is enforced at both the **submission intake layer** and the **geospatial validation layer**.

### 2.1 The 37 Jurisdictions

| Code | State | Code | State |
|---|---|---|---|
| `AB` | Abia | `KW` | Kwara |
| `AD` | Adamawa | `LA` | Lagos |
| `AK` | Akwa Ibom | `NA` | Nasarawa |
| `AN` | Anambra | `NI` | Niger |
| `BA` | Bauchi | `OG` | Ogun |
| `BY` | Bayelsa | `ON` | Ondo |
| `BE` | Benue | `OS` | Osun |
| `BO` | Borno | `OY` | Oyo |
| `CR` | Cross River | `PL` | Plateau |
| `DE` | Delta | `RI` | Rivers |
| `EB` | Ebonyi | `SO` | Sokoto |
| `ED` | Edo | `TA` | Taraba |
| `EK` | Ekiti | `YO` | Yobe |
| `EN` | Enugu | `ZA` | Zamfara |
| `GO` | Gombe | `FC` | FCT Abuja |
| `IM` | Imo | | |
| `JI` | Jigawa | | |
| `KD` | Kaduna | | |
| `KN` | Kano | | |
| `KT` | Katsina | | |
| `KE` | Kebbi | | |
| `KO` | Kogi | | |

### 2.2 Agency Code Format

Every registered agency receives a structured **Agency Code** that encodes its jurisdiction:

```
{AgencyType}-{StateCode}-{CommandUnit}-{Sequence}

Examples:
  NPF-LA-APAPA-001      → Nigeria Police Force, Lagos, Apapa Area Command
  EFCC-FC-ABUJA-001     → EFCC, FCT Abuja, Zonal Office
  ICPC-KN-KANO-001      → ICPC, Kano, Kano Office
  NPF-RI-PORTHARCOURT-002 → NPF, Rivers State, Port Harcourt Command (2nd unit)
```

The Agency Code is immutable once assigned. If a unit is reorganised or renamed, a new code is issued and the old one is retired (not deleted).

---

## 3. Data Model

### 3.1 `lex_agencies`

```
lex_agencies
├── id                  (PK, serial)
├── agencyCode          (unique, e.g. NPF-LA-APAPA-001)
├── name                (full official name)
├── type                (npf | efcc | icpc | dss | nscdc | customs | immigration | other)
├── state               (enum: 37 Nigerian states/FCT)
├── lga                 (varchar, optional)
├── commandUnit         (varchar, e.g. "Apapa Area Command")
├── contactName         (commanding officer name)
├── contactPhone        (verified phone)
├── contactEmail        (optional)
├── status              (active | suspended | retired)
├── registeredBy        (FK → users, BIS admin who approved)
├── registeredAt
├── suspendedAt
├── suspendedReason
└── notes
```

### 3.2 `lex_submitters`

```
lex_submitters
├── id                  (PK, serial)
├── submitterId         (UUID, non-guessable)
├── agencyId            (FK → lex_agencies)
├── name
├── rank                (e.g. "Inspector", "Detective Superintendent")
├── phone               (verified, used for PIN delivery)
├── pinHash             (bcrypt hash of 6-digit PIN)
├── reputationScore     (integer, starts at 50)
├── status              (active | suspended | revoked)
├── lastSubmissionAt
├── totalSubmissions
├── validatedSubmissions
├── rejectedSubmissions
├── createdAt
└── revokedAt
```

### 3.3 `lex_submissions`

```
lex_submissions
├── id                  (PK, serial)
├── submissionRef       (e.g. LEX-2026-LA-0042)
├── agencyId            (FK → lex_agencies)
├── submitterId         (FK → lex_submitters)
├── channel             (web | sms | physical)
├── incidentType        (arrest | seizure | witness_statement | court_order | intel_tip | missing_person | homicide | fraud | cybercrime | other)
├── incidentState       (enum: 37 states — must match agency.state)
├── incidentLga         (varchar)
├── incidentAddress     (text)
├── gpsLat / gpsLng
├── incidentDate
├── subjectName
├── subjectNin
├── subjectPhone
├── subjectAddress
├── narrative           (text, encrypted at rest)
├── documents           (JSON array of S3 keys)
├── status              (pending | under_review | validated | rejected | escalated | expunged)
├── validationScore     (0–100)
├── validationNotes     (JSON: per-layer results)
├── reviewedBy          (FK → users)
├── reviewedAt
├── linkedCaseId        (FK → cases)
├── rejectionReason
├── createdAt
└── updatedAt
```

The `submissionRef` includes the **state code** (e.g., `LEX-2026-LA-0042` for Lagos), making the jurisdiction immediately visible in any reference.

---

## 4. Jurisdiction Enforcement

Jurisdiction enforcement operates at three points in the pipeline:

### 4.1 Submission Intake (Layer 1 — Structural)

When a submission arrives via the web portal or SMS:

- The system resolves the submitter's agency and reads `agency.state`.
- The submission form pre-populates `incidentState` with the agency's state and **does not allow the submitter to change it** to a different state.
- If a submitter attempts to submit via the API with a mismatched `incidentState`, the submission is rejected with error `LEX_JURISDICTION_MISMATCH`.

This is the primary control. A Lagos police officer physically cannot submit an incident in Kano through the LEX portal.

### 4.2 Geospatial Validation (Layer 3 — Automated)

If GPS coordinates are provided:

- The coordinates are reverse-geocoded to determine the Nigerian state.
- If the resolved state does not match `agency.state`, the submission is flagged with `GEOSPATIAL_JURISDICTION_MISMATCH` and the validation score is reduced by 20 points.
- The flag is surfaced to the reviewing analyst as a warning, not an automatic rejection (the GPS may be inaccurate, or the incident may be at a state border).

### 4.3 Analyst Review Queue (Layer 5 — Human)

The analyst review queue is **filtered by state by default**. A BIS analyst assigned to Lagos will see only LEX submissions from Lagos agencies. Supervisors can view all states. This prevents a single analyst from being overwhelmed by submissions from across the country and ensures that analysts with local knowledge review the submissions most relevant to their expertise.

---

## 5. Submission Channels

### 5.1 Web Portal

The portal at `/lex/submit` is a mobile-optimised form. The state field is **read-only** and pre-filled from the submitter's agency registration. The LGA field is a dropdown filtered to the agency's state.

### 5.2 SMS Gateway

The SMS format includes the state code for audit purposes, but the system ignores any state the submitter provides and uses the agency's registered state instead:

```
LEX [SubmitterID] [PIN] [IncidentType] [SubjectName] [NIN/Phone] [Narrative]
```

### 5.3 Physical Form (LEX-01)

The physical form is **pre-printed per state**. Each state has its own form variant with the state code and agency code pre-printed in the header. A Lagos form cannot be submitted as a Kano form — the barcode encodes the agency code, which encodes the state.

---

## 6. Multi-Layer Validation Architecture

Every submission passes through five layers before a BIS analyst can approve it.

| Layer | Type | Description |
|---|---|---|
| **1 — Structural** | Automated | Submitter auth, required fields, jurisdiction match, file validation |
| **2 — Identity Cross-Check** | Automated | NIN/BVN lookup against BIS identity database, existing case/investigation check |
| **3 — Geospatial** | Automated | GPS-to-state reverse geocode, jurisdiction match, duplicate location detection |
| **4 — Duplicate & Velocity** | Automated | Submitter rate limiting, text similarity, cross-agency targeting detection |
| **5 — Human Review** | Manual | BIS analyst approval, state-scoped queue, mandatory for all submissions |

### Validation Score Breakdown

| Check | Max Points | Notes |
|---|---|---|
| Structural pass | 20 | All required fields present, auth valid |
| Jurisdiction match (GPS) | 15 | GPS confirms agency's state |
| Subject NIN/BVN found in BIS | 15 | Corroborates subject identity |
| Subject linked to existing BIS case | 10 | Positive corroboration signal |
| Document attached | 10 | At least one supporting document |
| Document has valid EXIF metadata | 5 | Photo taken at plausible time/location |
| No velocity flag | 10 | Submitter not exceeding rate limits |
| No duplicate flag | 10 | No text similarity match |
| Submitter reputation ≥ 50 | 5 | Submitter has good track record |

**Total: 100 points**

### Analyst Action Thresholds

| Score | Required Action |
|---|---|
| 80–100 | One-click approval recommended |
| 50–79 | Standard analyst review |
| 20–49 | Enhanced review; supervisor co-sign recommended |
| 0–19 | Automatic hold; supervisor must unlock before analyst can act |

---

## 7. Anti-Fabrication Controls

### 7.1 State-Scoped Reputation Scoring

Each submitter's **Reputation Score** is tracked at the agency level. A submitter who moves from one agency to another (e.g., a transferred officer) starts with a fresh score at the new agency. This prevents a submitter from building reputation at one agency and exploiting it at another.

Score adjustments:

| Event | Change |
|---|---|
| Submission validated | +10 |
| Submission rejected (error) | −15 |
| Submission rejected (fabrication) | −30 |
| Submission required clarification | −5 |
| Coordinated targeting flag | −40 |

Submitters below 0 enter enhanced review. Below −50, the submitter is suspended and the agency's commanding officer is notified via SMS.

### 7.2 Cross-State Targeting Detection

If the same subject NIN or phone number is submitted by agencies in **three or more different states** within 7 days, the submissions are escalated to a BIS supervisor with a `CROSS_STATE_TARGETING` flag. This pattern is a strong signal of coordinated fabrication or harassment.

### 7.3 State-Level Agency Anomaly Detection

At the state level, BIS tracks:

- **Submission volume per state per week** — unusual spikes (>3× the 4-week average) trigger a state-level audit.
- **Validation rate per state** — states with <30% validation rate over 30 days trigger a review of all pending submissions from that state.
- **Agency-level concentration** — if one agency accounts for >60% of all LEX submissions from its state in a given week, it is flagged for review.

### 7.4 Document Authenticity

- EXIF metadata extracted from uploaded photos (timestamp, GPS, device model).
- LLM-assisted OCR consistency check: does the document content match the submission narrative?
- Perceptual hash deduplication: the same image cannot be used in two different submissions.

---

## 8. LEX Admin Panel (BIS Internal)

BIS administrators manage LEX through a dedicated admin panel with the following views:

| View | Description |
|---|---|
| **Agency Registry** | List all agencies, filterable by state, type, status. Register new agency. |
| **Submitter Management** | List submitters for a selected agency. Issue credentials, revoke, view reputation score. |
| **Submission Review Queue** | State-scoped queue of pending submissions. Validate, reject, escalate, request clarification. |
| **State Analytics** | Per-state submission volume, validation rate, top submitters, anomaly flags. |
| **Audit Log** | Full immutable log of all LEX actions, filterable by state, agency, submitter, date. |

---

## 9. Integration with BIS Case Management

When a LEX submission is validated:

1. A **Case** is created (or linked to an existing case) with type `"criminal_report"`, source `"lex"`, and jurisdiction set to the submission's state.
2. The submitting agency is added as a **Case Stakeholder** with role `"law_enforcement"` and the agency's state is recorded.
3. The submission's `incidentState` populates the case's `jurisdiction` field, enabling state-based case filtering in the main Cases list.
4. The subject's risk score is recalculated.
5. BIS analysts in the relevant state are notified via the alert system.

---

## 10. Implementation Roadmap

| Phase | Deliverable | Effort |
|---|---|---|
| **LEX-1** | Nigerian states enum, `lex_agencies`, `lex_submitters`, `lex_submissions` schema | 3 days |
| **LEX-2** | LEX admin panel: agency registry + submitter management (state filter) | 1 week |
| **LEX-3** | LEX submission portal (`/lex/submit`): state-locked form, submitter auth | 1 week |
| **LEX-4** | Automated validation layers 1–4, validation score engine | 1 week |
| **LEX-5** | Analyst review queue (state-scoped), approval/rejection workflow | 1 week |
| **LEX-6** | Case integration, risk score recalculation, audit trail | 3 days |
| **LEX-7** | Document authenticity signals (EXIF, LLM OCR, perceptual hash) | 1 week |
| **LEX-8** | Reputation scoring, cross-state targeting detection, state anomaly detection | 1 week |
| **LEX-9** | Physical form (LEX-01) per-state PDF generation | 3 days |
| **LEX-10** | Pilot with one state (recommended: Lagos or FCT Abuja) | 2 weeks |

Total estimated effort: **~10 weeks** for a production-ready state-scoped LEX module.

---

## 11. Key Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Officer submits incident from wrong state (genuine error) | High | Low | GPS flag surfaced to analyst as warning, not rejection |
| Fabricated submissions from compromised credentials | Medium | High | Reputation scoring, velocity detection, human review gate |
| Cross-state coordinated targeting | Low | High | Cross-state targeting detection, supervisor escalation |
| Agency refuses participation citing data sovereignty | Medium | Medium | Data residency guarantee; state-level data can be ring-fenced |
| Analyst approves fabricated submission | Low | High | Supervisor co-sign for low-score submissions; 10% random audit |
| State with no digital infrastructure cannot participate | High | Medium | SMS gateway + physical Form LEX-01 as fallback |

---

## 12. Conclusion

Tying LEX agencies to Nigerian states is not merely an organisational convenience — it is a **core security control**. The state binding eliminates the largest class of fabrication attacks (cross-jurisdiction impersonation), enables jurisdiction-aware analyst routing, and produces submission references that are immediately interpretable by any BIS user. The three-level hierarchy (state → LGA → command unit) mirrors how Nigerian law enforcement is actually organised, making the system intuitive for the agencies that will use it.

The recommended pilot state is **Lagos** (highest law enforcement density, best baseline digital literacy) or **FCT Abuja** (proximity to federal agencies like EFCC and ICPC). A successful pilot in one state provides the template for a national rollout.
