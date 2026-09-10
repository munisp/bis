# Explainable Investigation Scoring Policy

BIS assessment scores are **evidence-grounded decision support only**. They are not credit scores and must not independently determine employment, tenancy, insurance, credit, government benefit, immigration, law-enforcement action, or any other consequential outcome.

## Required policy controls

Each tenant must use an active, approved version of an `investigation_score_policies` record. A policy contains at most 20 uniquely named non-sensitive factors, a base score, a maximum total factor weight of 100, minimum coverage, minimum confidence, and evidence-age limit. The administrator who creates a draft policy cannot activate it; a different administrator must approve the active version.

The platform rejects the following factor classes: biometric data, race, ethnicity, religion, gender, disability, health, political opinion, union membership, and sexual orientation. Raw biometric output is governed by the biometric review workflow and can never be a scoring input.

## Calculation

For each approved current evidence item, BIS calculates:

```text
contribution = direction × policy weight × source confidence × evidence freshness
freshness    = clamp((expiry − calculation time) / (expiry − observation time), 0, 1)
score        = clamp(round(base score + sum(contribution)), 0, 100)
```

Coverage is the fraction of policy weight for which usable evidence exists. Confidence and freshness are weighted averages. Withdrawn, contradicted, expired, inactive-source, unauthorized-purpose, or sensitive-factor evidence is excluded.

An assessment is `insufficient_evidence` when coverage or confidence is below its approved policy threshold. It is `manual_review_required` whenever unresolved evidence contradictions exist. Only a sufficiently covered, sufficiently confident, contradiction-free assessment becomes `decision_support_only`.

## Explainability and audit

Each assessment retains the policy ID, input-set SHA-256 digest, evidence IDs, factor direction, configured weight, confidence, freshness, contribution, and reason codes. Scores expire, and the maintenance worker opens a freshness review rather than treating a stale score as current. An assessment/review override requires a linked human review, a separate administrator, and a rationale of at least 20 characters. All events are tenant-scoped and append-only.

## Operational requirements

Only an active source that is authorized for the supplied purpose may provide evidence. Licensed and government-authorized sources require an active, unexpired `data_provider_authorizations` record that is scoped to the tenant or explicitly global. Monitoring remains disabled until a matching subject consent and provider authorization exist. The maintenance job updates only local expiry/review state; it does not invoke a provider.

Before production use, each policy must have documented rationale, validation results, calibration evidence, monitoring thresholds, review sampling, adverse-impact evaluation where applicable, and counsel approval for its jurisdiction and use case.
