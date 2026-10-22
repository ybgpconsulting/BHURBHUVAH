import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();
const USER_ROLES = ['owner', 'manager'];
type LeadType = 'market_area' | 'business_partner' | 'opt_in_consumer';
type ContactPermission = 'opted_in' | 'public_business' | 'unknown' | 'opted_out';
type VerificationStatus = 'verified' | 'needs_review' | 'rejected';

function clean(value: unknown, maxLength = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
function parsePermission(value: unknown): ContactPermission {
  return value === 'opted_in' || value === 'public_business' || value === 'opted_out' ? value : 'unknown';
}
function safeTokenEqual(expected: string, actual: string): boolean {
  if (!expected || expected.length < 32 || expected.length !== actual.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i += 1) result |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return result === 0;
}
const requireAutomation = async (c: any, next: () => Promise<void>) => {
  const header = c.req.header('Authorization') || '';
  const actual = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = c.env.AUTOMATION_API_TOKEN || '';
  if (!safeTokenEqual(expected, actual)) return c.json({ error: 'Unauthorized automation request' }, 401);
  await next();
};
async function audit(c: any, leadId: string, action: string, actorType: 'user' | 'automation', actorId: string | null, details: Record<string, unknown> = {}) {
  await c.env.DB.prepare(
    'INSERT INTO market_research_audit (id, lead_id, action, actor_type, actor_id, details_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), leadId, action, actorType, actorId, JSON.stringify(details)).run();
}
async function insertLead(c: any, input: Record<string, unknown>, source: 'manual' | 'n8n') {
  const leadType = clean(input.lead_type, 40) as LeadType;
  const displayName = clean(input.display_name, 180);
  const segment = clean(input.segment, 100);
  const city = clean(input.city, 100) || 'Noida';
  const area = clean(input.area, 150);
  const sourceUrl = clean(input.source_url, 2000);
  const evidenceSummary = clean(input.evidence_summary, 3000);
  const permission = parsePermission(input.contact_permission);
  const phone = clean(input.phone, 40);
  const email = clean(input.email, 200);
  const consentEvidence = clean(input.consent_evidence, 1000);
  const externalReference = clean(input.external_reference, 180) || null;
  if (!['market_area', 'business_partner', 'opt_in_consumer'].includes(leadType)) return { error: 'Invalid lead_type' as const };
  if (!displayName || !segment || !sourceUrl || !validUrl(sourceUrl) || evidenceSummary.length < 20) {
    return { error: 'Name, segment, a valid source URL and at least 20 characters of evidence are required' as const };
  }
  if (leadType === 'opt_in_consumer' && phone && (permission !== 'opted_in' || !consentEvidence)) {
    return { error: 'Consumer phone numbers require explicit opt-in and consent evidence' as const };
  }
  if (permission === 'opted_in' && (!phone || !consentEvidence)) {
    return { error: 'Opted-in contacts need a phone number and consent evidence' as const };
  }
  if (externalReference) {
    const match = await c.env.DB.prepare('SELECT id FROM market_research_leads WHERE external_reference = ?')
      .bind(externalReference).first<{ id: string }>();
    if (match) return { id: match.id, duplicate: true };
  }
  const duplicate = await c.env.DB.prepare(
    'SELECT id FROM market_research_leads WHERE lower(display_name) = lower(?) AND source_url = ? LIMIT 1',
  ).bind(displayName, sourceUrl).first<{ id: string }>();
  if (duplicate) return { id: duplicate.id, duplicate: true };
  const id = crypto.randomUUID();
  await c.env.DB.prepare([
    'INSERT INTO market_research_leads',
    '(id, lead_type, display_name, organization, segment, city, area, source_url, source_title,',
    'evidence_summary, phone, email, contact_permission, consent_evidence, external_reference, created_by_source)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ].join(' ')).bind(
    id, leadType, displayName, clean(input.organization, 180) || null, segment, city, area || null,
    sourceUrl, clean(input.source_title, 250) || null, evidenceSummary, phone || null, email || null,
    permission, consentEvidence || null, externalReference, source,
  ).run();
  await audit(c, id, 'lead_created', source === 'n8n' ? 'automation' : 'user',
    source === 'n8n' ? null : (c.get('user')?.id || null), { lead_type: leadType, segment, source_url: sourceUrl });
  return { id, duplicate: false };
}

app.get('/leads', requireAuth, requireRole(...USER_ROLES), async (c) => {
  try {
    const q = clean(c.req.query('q'), 100);
    const verification = clean(c.req.query('verification_status'), 40);
    const approval = clean(c.req.query('approval_status'), 40);
    const type = clean(c.req.query('lead_type'), 40);
    let sql = 'SELECT * FROM market_research_leads WHERE 1=1';
    const values: unknown[] = [];
    if (q) {
      sql += ' AND (display_name LIKE ? OR organization LIKE ? OR area LIKE ? OR segment LIKE ?)';
      const like = '%' + q + '%';
      values.push(like, like, like, like);
    }
    if (['pending', 'verified', 'needs_review', 'rejected'].includes(verification)) {
      sql += ' AND verification_status = ?'; values.push(verification);
    }
    if (['pending', 'approved', 'rejected'].includes(approval)) {
      sql += ' AND approval_status = ?'; values.push(approval);
    }
    if (['market_area', 'business_partner', 'opt_in_consumer'].includes(type)) {
      sql += ' AND lead_type = ?'; values.push(type);
    }
    sql += ' ORDER BY created_at DESC LIMIT 250';
    const { results } = await c.env.DB.prepare(sql).bind(...values).all();
    return c.json({ data: results });
  } catch (error) {
    console.error('Market research list failed', error);
    return c.json({ error: 'Could not load market research leads. Apply database migrations first.' }, 500);
  }
});

app.post('/leads', requireAuth, requireRole(...USER_ROLES), async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON body' }, 400);
    const result = await insertLead(c, body as Record<string, unknown>, 'manual');
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result, result.duplicate ? 200 : 201);
  } catch (error) {
    console.error('Manual market lead create failed', error);
    return c.json({ error: 'Could not create market research lead' }, 500);
  }
});

app.get('/agent/pending', requireAutomation, async (c) => {
  try {
    const rawLimit = Number(c.req.query('limit') || '25');
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25;
    const { results } = await c.env.DB.prepare(
      'SELECT id, lead_type, display_name, organization, segment, city, area, source_url, source_title, evidence_summary, created_at FROM market_research_leads WHERE verification_status = ? ORDER BY created_at ASC LIMIT ?',
    ).bind('pending', limit).all();
    return c.json({ data: results });
  } catch (error) {
    console.error('Automation pending leads query failed', error);
    return c.json({ error: 'Could not load pending leads' }, 500);
  }
});

app.post('/agent/intake', requireAutomation, async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON body' }, 400);
    const result = await insertLead(c, body as Record<string, unknown>, 'n8n');
    if ('error' in result) return c.json({ error: result.error }, 400);
    return c.json(result, result.duplicate ? 200 : 201);
  } catch (error) {
    console.error('Automation lead intake failed', error);
    return c.json({ error: 'Could not accept research lead' }, 500);
  }
});

app.post('/agent/verify', requireAutomation, async (c) => {
  try {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
    const id = clean(body.lead_id, 80);
    const status = clean(body.verification_status, 40) as VerificationStatus;
    const score = Number(body.verification_score);
    const summary = clean(body.verification_summary, 3000);
    const flags = Array.isArray(body.verification_flags)
      ? body.verification_flags.slice(0, 20).map((flag) => clean(flag, 300)).filter(Boolean) : [];
    if (!id || !['verified', 'needs_review', 'rejected'].includes(status)
      || !Number.isInteger(score) || score < 0 || score > 100 || summary.length < 10) {
      return c.json({ error: 'lead_id, a valid verification status, score 0-100 and a meaningful summary are required' }, 400);
    }
    const lead = await c.env.DB.prepare('SELECT id FROM market_research_leads WHERE id = ?').bind(id).first<{ id: string }>();
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    await c.env.DB.prepare(
      'UPDATE market_research_leads SET verification_status = ?, verification_score = ?, verification_summary = ?, verification_flags = ?, last_verified_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).bind(status, score, summary, JSON.stringify(flags), new Date().toISOString(), id).run();
    await audit(c, id, 'ai_verification_completed', 'automation', null, {
      verification_status: status, verification_score: score, verification_flags: flags,
    });
    return c.json({ success: true, lead_id: id, verification_status: status, verification_score: score });
  } catch (error) {
    console.error('Automation verification failed', error);
    return c.json({ error: 'Could not save verification result' }, 500);
  }
});

app.post('/leads/:id/decision', requireAuth, requireRole(...USER_ROLES), async (c) => {
  try {
    const id = clean(c.req.param('id'), 80);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const decision = clean(body?.decision, 20);
    const notes = clean(body?.reviewer_notes, 2000);
    if (!body || !['approve', 'reject'].includes(decision)) return c.json({ error: 'Decision must be approve or reject' }, 400);
    const lead = await c.env.DB.prepare(
      'SELECT id, verification_status FROM market_research_leads WHERE id = ?',
    ).bind(id).first<{ id: string; verification_status: string }>();
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    if (decision === 'approve' && lead.verification_status !== 'verified' && notes.length < 10) {
      return c.json({ error: 'Add reviewer notes (at least 10 characters) to override an incomplete AI verification.' }, 400);
    }
    const approvalStatus = decision === 'approve' ? 'approved' : 'rejected';
    const user = c.get('user');
    await c.env.DB.prepare(
      'UPDATE market_research_leads SET approval_status = ?, reviewer_notes = ?, approved_by = ?, approved_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).bind(approvalStatus, notes || null, decision === 'approve' ? user.id : null,
      decision === 'approve' ? new Date().toISOString() : null, id).run();
    await audit(c, id, decision === 'approve' ? 'human_approved' : 'human_rejected', 'user', user.id, {
      reviewer_notes: notes, verification_status: lead.verification_status,
    });
    return c.json({ success: true, id, approval_status: approvalStatus });
  } catch (error) {
    console.error('Market lead decision failed', error);
    return c.json({ error: 'Could not save review decision' }, 500);
  }
});

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\\s]*[=+\\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
app.get('/export/approved.csv', requireAuth, requireRole(...USER_ROLES), async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT display_name, phone, area, segment, source_url, contact_permission, consent_evidence FROM market_research_leads WHERE approval_status = ? AND contact_permission = ? AND phone IS NOT NULL AND trim(phone) != ? ORDER BY approved_at DESC',
    ).bind('approved', 'opted_in', '').all<Record<string, unknown>>();
    const headers = ['Name', 'Phone', 'Area', 'Segment', 'Consent_Status', 'Source_URL', 'Consent_Evidence'];
    const lines = [headers, ...results.map((row) => [
      row.display_name, row.phone, row.area, row.segment, row.contact_permission, row.source_url, row.consent_evidence,
    ])].map((row) => row.map(csvCell).join(','));
    return new Response(lines.join('\\r\\n') + '\\r\\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bhurbhuvah-approved-opt-in-contacts.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Approved contacts export failed', error);
    return c.json({ error: 'Could not export approved contacts' }, 500);
  }
});

export default app;
