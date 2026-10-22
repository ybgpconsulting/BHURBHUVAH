# BhurBhuvah Market Research and Lead Approval — Phase 1

## Scope

This phase adds a source-backed market-research queue to the existing BhurBhuvah app. It does not send WhatsApp messages and does not run automatic web discovery by itself. n8n performs the scheduled research and verification workflows and posts results to the authenticated Worker endpoints. The dashboard is the human decision gate; the existing WA Campaigner extension remains the sender.

## First-run deployment checklist

1. Review this branch and run the repository checks locally.
2. Apply migration 0004_market_research.sql to the staging D1 database only.
3. Generate a dedicated automation bearer token with at least 32 random bytes. Keep it in a password manager. Do not commit it, put it in frontend code, or paste it into prompts.
4. Set the token on the staging Worker using Wrangler's secret prompt: npx wrangler secret put AUTOMATION_API_TOKEN --env staging.
5. Add the same token as a protected credential in n8n. Send it as Authorization: Bearer <token>. Use the staging Worker URL in n8n; do not connect n8n to production while testing.
6. Build and test the Research and Verification workflows described below with synthetic examples first.
7. Log into BhurBhuvah as an owner or manager and open /market-research.
8. Test export with a synthetic, explicitly opted-in record and confirm that unknown, public-business-only, and opted-out contacts are excluded.

## Agent 1 — Market Researcher

### Goal

Create a daily, evidence-based report of relevant opportunities for BhurBhuvah in areas the business can actually serve. Do not guess personal identities, scrape phone numbers from private groups, infer household A2 milk consumption, or treat a premium residential area as proof of individual purchase intent.

### Suggested n8n workflow

Manual Trigger for testing; after testing, replace or supplement it with a Schedule Trigger.
Then: set service geography and research questions → use an approved web-search provider → ask the LLM to produce structured candidate records → parse and validate JSON → loop over candidates → POST each candidate to the Worker endpoint /api/market-research/agent/intake → log accepted/duplicate/rejected items.

Search tracks:
- Market areas: A2 milk demand signals, home-delivery suitability, density of apartments, and whether BhurBhuvah's delivery route can serve that area.
- Business partners: publicly listed A2 milk shops, organic grocery stores, local dairies, wellness businesses or other plausible referral partners. Treat partnerships as hypotheses until confirmed.
- Explicit public intent: public requests that directly ask for A2 milk availability or a supplier. Save the page URL and exact relevant evidence; do not copy unnecessary personal details.
- Competitor intelligence: public product range, delivery areas, published prices, stated positioning, trial offers and channels. Record the date checked and URL.

Use a configurable service-area allowlist before collecting candidates. Do not assume every part of Noida is serviceable. Prioritize source quality and observable evidence over the number of candidates.

### Researcher system prompt

You are the BhurBhuvah Market Researcher. Your job is to find and summarize verifiable market opportunities for a local A2 cow and buffalo milk delivery business. Work only from public pages or data supplied with permission. Each factual claim must have a source URL and a concise evidence summary. Distinguish facts from hypotheses. Never invent a source, price, address, phone number, product, customer intention or consent status. Do not infer that an identifiable person consumes or wants A2 milk unless they explicitly stated this in a relevant public context and outreach would still need a separate permission review. Prefer area-level demand and public business leads. Do not scrape private groups or build personal phone lists. Return valid JSON records matching the schema in this document. If source evidence is unavailable or contradictory, omit the candidate or mark the uncertainty clearly.

### Intake record schema

Each lead is sent to /api/market-research/agent/intake as JSON:
{
  "lead_type": "market_area | business_partner | opt_in_consumer",
  "display_name": "Concise area, business or opted-in lead label",
  "organization": "Optional organization or null",
  "segment": "A2 demand | dairy retailer | referral partner | other specific segment",
  "city": "Noida",
  "area": "Sector or locality, if evidenced",
  "source_url": "https://source.example/path",
  "source_title": "Page title",
  "evidence_summary": "At least 20 characters describing what the source actually supports",
  "phone": null,
  "email": null,
  "contact_permission": "unknown | public_business | opted_in | opted_out",
  "consent_evidence": null,
  "external_reference": "Stable source URL or provider result identifier"
}

Do not send a phone number for a consumer unless explicit opt-in is documented. The API rejects consumer phone records without opt-in and consent evidence. Research records must include source_url and evidence_summary.

## Agent 2 — Independent Verification Analyst

### Suggested n8n workflow

Schedule Trigger or Manual Trigger → GET /api/market-research/agent/pending?limit=25 → for each record, fetch the cited public page or use the search provider to corroborate it → compare claims to the source → score evidence quality → POST the result to /api/market-research/agent/verify → log outcomes and failed checks.

The verification agent must independently inspect the original source where possible. Repeating the researcher's evidence summary is not verification. If the source is inaccessible, stale, misleading or fails to substantiate the claim, set status to needs_review or rejected and explain why. Never add invented evidence to achieve a high score.

### Verification prompt and score

Return one status: verified, needs_review, or rejected; one integer score from 0 to 100; a short plain-language summary; and an array of explicit flags.

Suggested score:
- Direct evidence that supports the opportunity: 0–30
- Fit with approved service geography and delivery capacity: 0–25
- Explicit purchase intent or business relevance: 0–25
- Recency of evidence: 0–10
- Source reliability and traceability: 0–10

These dimensions should be adapted to the record category. A market-area record may score on geographic demand evidence; a business-partner record may score on relevance of its published services. Never use demographic stereotypes as proof of individual demand. Score is a triage aid, not consent. A high score never grants permission to send a message.

POST to /api/market-research/agent/verify with:
{
  "lead_id": "existing record UUID",
  "verification_status": "verified | needs_review | rejected",
  "verification_score": 0,
  "verification_summary": "What was checked and what the sources support",
  "verification_flags": ["Source inaccessible", "Service area unconfirmed"]
}

The endpoints require a dedicated Bearer token, configured only as a Worker secret and protected n8n credential. The read endpoint returns only unverified research fields, not customer-management records.

## Human approval dashboard

Path: /market-research

Owner or manager can:
- Search and filter by type, verification status and decision status.
- Review the source URL, evidence, verification summary, score and flags.
- Approve or reject a record with a recorded reviewer decision.
- Add a reason if overriding a non-rejected verification recommendation.
- Download a CSV to use with the existing WA Campaigner extension.

A lead rejected by verification cannot be approved until stronger evidence is added and verification is run again. Research approval is not the same as permission to send promotional WhatsApp messages.

## Sender export

The button “Export for WhatsApp sender” downloads bhurbhuvah-approved-opt-in-contacts.csv. The file includes Name and Phone columns plus area, segment, consent status and evidence fields. It contains only records that are both human-approved and marked opted_in with a non-empty phone and consent evidence. Records marked unknown, public_business or opted_out are excluded.

This is deliberate for the first release: public source discovery or human approval does not create WhatsApp opt-in. Confirm that the contact has agreed to receive relevant messages before exporting it to the sender. Keep suppression and consent records up to date.

Manual handoff:
1. Open the Market Research page and review leads.
2. Export the approved opt-in CSV.
3. Load that file into the existing Chrome extension.
4. Review the message and the recipient list before starting a campaign.
5. In phase 2, import the extension's CSV activity logs and add incoming-reply processing.

## Current automation API

All endpoints are relative to the BhurBhuvah Worker base URL.

- GET /api/market-research/agent/pending?limit=25 — service credential; returns pending verification records.
- POST /api/market-research/agent/intake — service credential; creates a new evidence-backed research record or returns a duplicate result.
- POST /api/market-research/agent/verify — service credential; writes the verification result.
- GET /api/market-research/leads — authenticated owner/manager dashboard.
- POST /api/market-research/leads — authenticated owner/manager manual intake.
- POST /api/market-research/leads/:id/decision — authenticated owner/manager human decision.
- GET /api/market-research/export/approved.csv — authenticated owner/manager, explicit-opt-in records only.

The global Worker authentication middleware runs for every request. Automation endpoints use a separate bearer token and do not grant access to the existing customer, subscription, payment or delivery APIs.

## Phase 1 acceptance tests

- Migration works on local and staging D1 without touching production.
- Owner/manager can open the dashboard; delivery-partner role cannot.
- Non-authenticated dashboard/API requests are rejected.
- Duplicate source/external references do not create repeated records.
- Missing source URLs, unsupported lead categories and weak evidence are rejected.
- A verification result requires a valid status, score and summary.
- A rejected lead cannot be approved.
- Decision history is written to market_research_audit.
- CSV export contains only human-approved opted-in contacts with consent evidence and phone.
- CSV formula-injection characters are neutralized.
- n8n calls with a missing or incorrect token are rejected.
- No real messages are sent by this phase.
