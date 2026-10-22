import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Search, RefreshCw, Download, Plus, CheckCircle2, XCircle, ExternalLink, MapPinned, Building2, Users, ShieldCheck, Clock3, AlertTriangle } from 'lucide-react';

type Lead = {
  id: string;
  lead_type: 'market_area' | 'business_partner' | 'opt_in_consumer';
  display_name: string;
  organization?: string | null;
  segment: string;
  city: string;
  area?: string | null;
  source_url: string;
  source_title?: string | null;
  evidence_summary: string;
  phone?: string | null;
  contact_permission: 'opted_in' | 'public_business' | 'unknown' | 'opted_out';
  consent_evidence?: string | null;
  verification_status: 'pending' | 'verified' | 'needs_review' | 'rejected';
  verification_score?: number | null;
  verification_summary?: string | null;
  verification_flags?: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  reviewer_notes?: string | null;
};
const typeLabels: Record<string, string> = { market_area: 'Market area', business_partner: 'Business partner', opt_in_consumer: 'Opt-in consumer' };
const verificationVariants: Record<string, 'default' | 'success' | 'warning' | 'danger'> = { pending: 'default', verified: 'success', needs_review: 'warning', rejected: 'danger' };
const approvalVariants: Record<string, 'default' | 'success' | 'danger'> = { pending: 'default', approved: 'success', rejected: 'danger' };
const initialForm = {
  lead_type: 'market_area', display_name: '', organization: '', segment: 'A2 milk demand',
  city: 'Noida', area: '', source_url: '', source_title: '', evidence_summary: '',
  phone: '', email: '', contact_permission: 'unknown', consent_evidence: '',
};

export default function MarketResearchPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [approvalFilter, setApprovalFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (verificationFilter !== 'all') params.set('verification_status', verificationFilter);
      if (approvalFilter !== 'all') params.set('approval_status', approvalFilter);
      if (typeFilter !== 'all') params.set('lead_type', typeFilter);
      const suffix = params.toString();
      const result = await api.get<{ data: Lead[] }>('/api/market-research/leads' + (suffix ? '?' + suffix : ''));
      setLeads(result.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load leads. Apply the database migration and check permissions.');
    } finally { setLoading(false); }
  }, [query, verificationFilter, approvalFilter, typeFilter]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const summary = useMemo(() => ({
    total: leads.length,
    pending: leads.filter((l) => l.approval_status === 'pending').length,
    verified: leads.filter((l) => l.verification_status === 'verified').length,
    optIn: leads.filter((l) => l.contact_permission === 'opted_in').length,
  }), [leads]);

  const saveLead = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ id: string; duplicate?: boolean }>('/api/market-research/leads', form);
      setNotice(result.duplicate ? 'This source is already in the lead list.' : 'Lead saved for independent verification.');
      setForm(initialForm); setShowForm(false); await loadLeads();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save lead'); }
    finally { setSaving(false); }
  };

  const decide = async (lead: Lead, decision: 'approve' | 'reject') => {
    setError(''); setNotice('');
    let reviewerNotes = '';
    if (decision === 'approve' && lead.verification_status !== 'verified') {
      if (lead.verification_status === 'rejected') {
        setError('This lead was rejected by verification. Add stronger source evidence and verify it again before approval.'); return;
      }
      const answer = window.prompt('Verification is incomplete. Enter your reason for overriding the AI recommendation (at least 10 characters):');
      if (answer === null) return;
      reviewerNotes = answer.trim();
      if (reviewerNotes.length < 10) { setError('Please enter a meaningful reason of at least 10 characters.'); return; }
    } else if (decision === 'reject') {
      reviewerNotes = (window.prompt('Optional review note:') || '').trim();
    }
    if (decision === 'approve' && !window.confirm(
      lead.contact_permission === 'opted_in'
        ? 'Approve this record? Export remains limited to explicit opt-ins with consent evidence.'
        : 'Approve this research record? It will not be exported to WhatsApp unless explicit opt-in and consent evidence are recorded.'
    )) return;
    try {
      await api.post('/api/market-research/leads/' + lead.id + '/decision', { decision, reviewer_notes: reviewerNotes });
      setNotice(decision === 'approve' ? 'Lead approved and decision recorded.' : 'Lead rejected and decision recorded.');
      await loadLeads();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save decision'); }
  };

  const flags = (lead: Lead): string[] => {
    try { const value = JSON.parse(lead.verification_flags || '[]'); return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []; }
    catch { return []; }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">BHURBHUAH · CUSTOMER ACQUISITION</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">AI Market Research</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">Collect source-backed market opportunities, review independent AI verification and approve records before outreach.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={loadLeads} disabled={loading}><RefreshCw size={16} className="mr-2" />Refresh</Button>
          <Button variant="secondary" onClick={() => api.download('/api/market-research/export/approved.csv', 'bhurbhuvah-approved-opt-in-contacts.csv').catch((e) => setError(e instanceof Error ? e.message : 'Export failed'))}><Download size={16} className="mr-2" />Export for WhatsApp sender</Button>
          <Button onClick={() => setShowForm(!showForm)}><Plus size={16} className="mr-2" />Add research lead</Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Visible records', value: summary.total, icon: Search },
          { label: 'Awaiting your decision', value: summary.pending, icon: Clock3 },
          { label: 'Verified by analyst', value: summary.verified, icon: ShieldCheck },
          { label: 'Opt-in recorded', value: summary.optIn, icon: Users },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm text-gray-500"><span>{card.label}</span><card.icon size={18} className="text-emerald-700" /></div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{card.value}</div>
          </div>
        ))}
      </section>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      {showForm && <form onSubmit={saveLead} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div><h3 className="text-lg font-semibold text-gray-900">Add research lead</h3><p className="text-sm text-gray-500">Every record needs an accessible source and concrete evidence. Do not infer private consumer details.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Lead category
            <select className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.lead_type} onChange={(e) => setForm({ ...form, lead_type: e.target.value })}>
              <option value="market_area">Market / residential area</option><option value="business_partner">Business / referral partner</option><option value="opt_in_consumer">Consumer who explicitly opted in</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">Name / area / business<input required className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700">Organization (optional)<input className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700">Segment<input required className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} placeholder="e.g. A2 dairy retailer" /></label>
          <label className="block text-sm font-medium text-gray-700">City<input required className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700">Area / sector<input className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700 md:col-span-2">Source URL<input required type="url" placeholder="https://..." className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700 md:col-span-2">Evidence / reason it matters<textarea required minLength={20} rows={3} className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.evidence_summary} onChange={(e) => setForm({ ...form, evidence_summary: e.target.value })} placeholder="What exactly does the cited source say? Do not infer private consumption." /></label>
          <label className="block text-sm font-medium text-gray-700">Contact permission
            <select className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.contact_permission} onChange={(e) => setForm({ ...form, contact_permission: e.target.value })}>
              <option value="unknown">Unknown / research only</option><option value="public_business">Public business contact (review required)</option><option value="opted_in">Explicit opt-in documented</option><option value="opted_out">Opted out — suppress contact</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">Phone (optional)<input type="tel" className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="block text-sm font-medium text-gray-700 md:col-span-2">Consent evidence / source of opt-in<input className="mt-1 w-full rounded-md border border-gray-300 p-2" value={form.consent_evidence} onChange={(e) => setForm({ ...form, consent_evidence: e.target.value })} placeholder="e.g. form submission ID and timestamp; required for opt-in export" /></label>
        </div>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save for verification'}</Button><Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button></div>
      </form>}

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="relative block"><Search size={16} className="absolute left-3 top-3 text-gray-400" /><input aria-label="Search leads" className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, area, segment" /></label>
          <select aria-label="Verification status" className="rounded-md border border-gray-300 p-2 text-sm" value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value)}>
            <option value="all">All verification statuses</option><option value="pending">Awaiting verification</option><option value="verified">Verified</option><option value="needs_review">Needs review</option><option value="rejected">Rejected by analyst</option>
          </select>
          <select aria-label="Approval status" className="rounded-md border border-gray-300 p-2 text-sm" value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)}>
            <option value="all">All approval statuses</option><option value="pending">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
          </select>
          <select aria-label="Lead category" className="rounded-md border border-gray-300 p-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All lead categories</option><option value="market_area">Market / residential area</option><option value="business_partner">Business partner</option><option value="opt_in_consumer">Opt-in consumer</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-500">Up to 250 matching records. AI verification never replaces your final decision.</p><span className="flex items-center gap-1 text-xs text-gray-500"><AlertTriangle size={14} /> Only explicit opt-ins export to the sender CSV</span></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-3">Opportunity &amp; source</th><th className="px-3 py-3">Evidence / analyst</th><th className="px-3 py-3">Contact gate</th><th className="px-3 py-3">Statuses</th><th className="px-3 py-3">Decision</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-500">Loading research leads…</td></tr> :
                leads.length === 0 ? <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-500">No leads match. Add a research lead or connect the n8n intake workflow.</td></tr> :
                leads.map((lead) => {
                  const verificationFlags = flags(lead);
                  const Icon = lead.lead_type === 'market_area' ? MapPinned : lead.lead_type === 'business_partner' ? Building2 : Users;
                  return <tr key={lead.id} className="align-top hover:bg-gray-50/80">
                    <td className="px-3 py-4 min-w-[220px]"><div className="flex gap-2"><Icon size={17} className="mt-0.5 shrink-0 text-emerald-700" /><div>
                      <p className="font-semibold text-gray-900">{lead.display_name}</p>
                      {lead.organization && <p className="text-xs text-gray-500">{lead.organization}</p>}
                      <p className="mt-1 text-xs text-gray-500">{[lead.area, lead.city, lead.segment].filter(Boolean).join(' · ')}</p>
                      <p className="mt-2"><Badge variant="secondary">{typeLabels[lead.lead_type] || lead.lead_type}</Badge></p>
                      <a href={lead.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-blue-700 hover:underline">{lead.source_title || 'Open evidence source'} <ExternalLink size={12} /></a>
                    </div></div></td>
                    <td className="px-3 py-4 min-w-[250px] max-w-md"><p className="text-gray-700">{lead.evidence_summary}</p>
                      {lead.verification_summary ? <p className="mt-2 text-gray-600"><strong>Analyst:</strong> {lead.verification_summary}</p> : <p className="mt-2 text-xs text-gray-400">Independent analyst has not reviewed this record.</p>}
                      {lead.verification_score !== null && lead.verification_score !== undefined && <p className="mt-1 text-xs text-gray-500">Score: {lead.verification_score}/100</p>}
                      {verificationFlags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{verificationFlags.map((flag, i) => <span key={flag + '-' + i} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{flag}</span>)}</div>}
                    </td>
                    <td className="px-3 py-4 min-w-[155px]"><Badge variant={lead.contact_permission === 'opted_in' ? 'success' : lead.contact_permission === 'opted_out' ? 'danger' : 'warning'}>{lead.contact_permission.replace('_', ' ')}</Badge>
                      {lead.phone && <p className="mt-2 text-xs text-gray-600">{lead.phone}</p>}
                      {lead.consent_evidence && <p className="mt-1 max-w-[180px] break-words text-xs text-gray-500">{lead.consent_evidence}</p>}
                    </td>
                    <td className="px-3 py-4 min-w-[145px]"><div className="space-y-2"><div><p className="mb-1 text-xs text-gray-400">Verification</p><Badge variant={verificationVariants[lead.verification_status] || 'default'}>{lead.verification_status.replace('_', ' ')}</Badge></div><div><p className="mb-1 text-xs text-gray-400">Your decision</p><Badge variant={approvalVariants[lead.approval_status] || 'default'}>{lead.approval_status}</Badge></div>
                      {lead.reviewer_notes && <p className="max-w-[160px] break-words text-xs text-gray-500">Note: {lead.reviewer_notes}</p>}</div>
                    </td>
                    <td className="px-3 py-4 min-w-[155px]">{lead.approval_status === 'pending' ? <div className="flex flex-col items-start gap-2">
                      {lead.verification_status !== 'rejected' && <Button size="sm" onClick={() => decide(lead, 'approve')}><CheckCircle2 size={14} className="mr-1" />Approve</Button>}
                      <Button size="sm" variant="danger" onClick={() => decide(lead, 'reject')}><XCircle size={14} className="mr-1" />Reject</Button>
                    </div> : <span className="text-xs text-gray-500">Decision recorded</span>}</td>
                  </tr>;
                })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-gray-500">Research and approval are separate from outreach. Public source discovery does not by itself establish permission to send promotional messages. Keep source evidence and consent records; the export excludes non-opted-in leads.</p>
    </div>
  );
}
