-- Market research opportunities and human-reviewed outreach eligibility.
-- Personal consumer contact data is exportable only after explicit opt-in is recorded.
CREATE TABLE IF NOT EXISTS market_research_leads (
  id TEXT PRIMARY KEY,
  lead_type TEXT NOT NULL CHECK (lead_type IN ('market_area', 'business_partner', 'opt_in_consumer')),
  display_name TEXT NOT NULL,
  organization TEXT,
  segment TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Noida',
  area TEXT,
  source_url TEXT NOT NULL,
  source_title TEXT,
  evidence_summary TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  contact_permission TEXT NOT NULL DEFAULT 'unknown'
    CHECK (contact_permission IN ('opted_in', 'public_business', 'unknown', 'opted_out')),
  consent_evidence TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'needs_review', 'rejected')),
  verification_score INTEGER CHECK (verification_score IS NULL OR (verification_score >= 0 AND verification_score <= 100)),
  verification_summary TEXT,
  verification_flags TEXT NOT NULL DEFAULT '[]',
  last_verified_at TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  reviewer_notes TEXT,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  external_reference TEXT,
  created_by_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (created_by_source IN ('manual', 'n8n')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_leads_approval ON market_research_leads(approval_status, verification_status);
CREATE INDEX IF NOT EXISTS idx_market_leads_type_area ON market_research_leads(lead_type, city, area);
CREATE INDEX IF NOT EXISTS idx_market_leads_consent ON market_research_leads(contact_permission);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_leads_external_reference
  ON market_research_leads(external_reference) WHERE external_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_research_audit (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES market_research_leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'automation')),
  actor_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_research_audit_lead ON market_research_audit(lead_id, created_at);
