'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle,
  Plus,
  Info,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  FileText,
  Copy,
  Check,
  RotateCcw,
  ClipboardCheck,
  UserMinus,
  Clock,
  Swords,
} from 'lucide-react';
import {
  buildDossiers,
  buildWorklist,
  type StrikeWithContext,
  type AccountDossier,
} from '@/lib/strikes/dossier';
import { expiryOf } from '@/lib/strikes/status';
import { useStrikeStore } from '@/lib/stores/strikeStore';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClan } from '@/lib/ClanContext';

const DISCORD_LIMIT = 2000;
const INGAME_LIMIT = 256;

// Green=1, Orange=2, Red>=3 active strikes; grey when clear.
const LEVEL_COLOR: Record<string, string> = {
  clear: 'var(--color-muted)',
  green: 'var(--color-cta)',
  orange: 'var(--color-warning)',
  red: 'var(--color-danger)',
};

// One line describing a strike: its rule plus the folded violation descriptions.
function offenceLine(s: StrikeWithContext): string {
  const rule = s.rule?.name?.trim();
  const descs = (s.strike_violations || []).map((v) => v.description?.trim()).filter(Boolean);
  const detail = descs.join('; ');
  return rule ? (detail ? `${rule} — ${detail}` : rule) : detail || 'War rule violation';
}

function accountLabel(s: StrikeWithContext): string {
  return s.player_account?.in_game_name || s.player_account_tag || 'Unknown account';
}

// Discord variant: rich markdown grouped by member, closing on the three-strikes notice.
function buildDiscordSummary(items: StrikeWithContext[]): string {
  const byMember = new Map<string, string[]>();
  for (const s of items) {
    const name = s.person?.display_name || accountLabel(s);
    if (!byMember.has(name)) byMember.set(name, []);
    byMember.get(name)!.push(offenceLine(s));
  }
  const lines: string[] = ['## ⚔️ War Rule Violations', '', 'The following players received a strike:', ''];
  for (const [name, offences] of byMember) {
    lines.push(`**${name}**`);
    for (const o of offences) lines.push(`> • ${o}`);
    lines.push('');
  }
  lines.push(
    'Every player gets only **three strikes** within any three-month period before being removed from the clan. ' +
      'Each player named above must now own it, apologise, and commit to not repeating it. ' +
      '__You will not be included in war again until that commitment is made.__',
  );
  return lines.join('\n');
}

// In-game variant: one compact plain-text paragraph for the 256-char clan-mail cap.
function buildIngameSummary(items: StrikeWithContext[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const s of items) {
    const name = accountLabel(s);
    if (!seen.has(name)) { seen.add(name); names.push(name); }
  }
  const list = names.length ? names.join(', ') : '—';
  return `The following players received a war strike: ${list}. ` +
    `You will not be included in war again until you apologise and promise not to repeat it.`;
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function dateToNoonIso(date: string): string {
  return new Date(`${date}T12:00`).toISOString();
}
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

type WorklistKey =
  | 'all'
  | 'unresolved'
  | 'eligibleForElderRestoration'
  | 'removalFlagged'
  | 'expiringSoon';

export default function StrikesPage() {
  const { selectedClanId } = useClan();

  // Server data + mutations live in the store; a mutation updates just the affected strike, so
  // approving trust no longer re-fetches and flashes the whole page.
  const strikes = useStrikeStore((s) => s.strikes);
  const loading = useStrikeStore((s) => s.loading);
  const reviewItems = useStrikeStore((s) => s.reviewItems);
  const rules = useStrikeStore((s) => s.rules);
  const accounts = useStrikeStore((s) => s.accounts);
  const actingReviewId = useStrikeStore((s) => s.actingReviewId);
  const fetchData = useStrikeStore((s) => s.fetchData);
  const loadIdentity = useStrikeStore((s) => s.loadIdentity);
  const logStrikeAction = useStrikeStore((s) => s.logStrike);
  const actOnReviewAction = useStrikeStore((s) => s.actOnReview);
  const deleteStrikeAction = useStrikeStore((s) => s.deleteStrike);

  // Review queue UI-local toggle.
  const [reviewOpen, setReviewOpen] = useState(true);

  const [showLogModal, setShowLogModal] = useState(false);
  const [worklistFilter, setWorklistFilter] = useState<WorklistKey>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Confirmation modal (delete strike).
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, id: '', title: '', message: '' });
  const [deletingStrike, setDeletingStrike] = useState(false);

  // Log-strike modal state.
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedRule, setSelectedRule] = useState('');
  const [description, setDescription] = useState('');
  const [backdate, setBackdate] = useState(false);
  const [issuedAt, setIssuedAt] = useState('');
  const [logging, setLogging] = useState(false);

  // Removal editor (per strike): rejoin date draft.
  const [rejoinDrafts, setRejoinDrafts] = useState<Record<string, string>>({});

  // Notes state.
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  // Summary builder.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [summaryTab, setSummaryTab] = useState<'discord' | 'ingame'>('discord');
  const [discordText, setDiscordText] = useState('');
  const [ingameText, setIngameText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadIdentity(); }, [loadIdentity]);
  useEffect(() => { fetchData(selectedClanId); }, [selectedClanId, fetchData]);

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filter') as WorklistKey | null;
    if (f && ['unresolved', 'eligibleForElderRestoration', 'removalFlagged', 'expiringSoon'].includes(f)) {
      setWorklistFilter(f);
    }
  }, []);

  // Clan-scope the strike list; keep clan-less (manual) strikes visible under any filter.
  const scopedStrikes = useMemo(
    () => strikes.filter((s) => selectedClanId === 'all' || !s.clan_id || s.clan_id === selectedClanId),
    [strikes, selectedClanId],
  );

  const now = new Date();
  const dossiers = useMemo(() => buildDossiers(scopedStrikes, now), [scopedStrikes]);
  const worklist = useMemo(() => buildWorklist(dossiers, now), [dossiers]);

  const visibleDossiers = useMemo(() => {
    if (worklistFilter === 'all') return dossiers;
    const bucket = worklist[worklistFilter];
    const tags = new Set(bucket.map((d) => d.accountTag));
    return dossiers.filter((d) => tags.has(d.accountTag));
  }, [dossiers, worklist, worklistFilter]);

  function handleSelectAccount(tag: string) {
    setSelectedAccount(tag);
    setSelectedPerson(accounts.find((a) => a.player_tag === tag)?.person?.id || '');
  }

  async function handleLogStrike(e: React.FormEvent) {
    e.preventDefault();
    if (logging) return;
    setLogging(true);
    const ok = await logStrikeAction(
      {
        personId: selectedPerson,
        playerTag: selectedAccount,
        ruleId: selectedRule || null,
        description,
        issuedAt: backdate && issuedAt ? dateToNoonIso(issuedAt) : null,
      },
      selectedClanId,
    );
    setLogging(false);
    if (ok) {
      setShowLogModal(false);
      setSelectedPerson('');
      setSelectedAccount('');
      setSelectedRule('');
      setDescription('');
      setBackdate(false);
      setIssuedAt('');
    }
  }

  async function deleteStrike() {
    if (deletingStrike) return;
    setDeletingStrike(true);
    const ok = await deleteStrikeAction(confirmConfig.id);
    setDeletingStrike(false);
    if (ok) setConfirmConfig((c) => ({ ...c, isOpen: false }));
  }

  // Summary drawer.
  useEffect(() => {
    if (!showSummary) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSummary(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSummary]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function openSummary() {
    const items = scopedStrikes.filter((s) => selectedIds.has(s.id));
    if (!items.length) return;
    setDiscordText(buildDiscordSummary(items));
    setIngameText(buildIngameSummary(items));
    setSummaryTab('discord');
    setCopied(false);
    setShowSummary(true);
  }
  function regenerateActive() {
    const items = scopedStrikes.filter((s) => selectedIds.has(s.id));
    if (summaryTab === 'discord') setDiscordText(buildDiscordSummary(items));
    else setIngameText(buildIngameSummary(items));
  }
  async function copyActive() {
    try {
      await navigator.clipboard.writeText(summaryTab === 'discord' ? discordText : ingameText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Could not copy to clipboard');
    }
  }

  const selectedRuleData = rules.find((r) => r.id === selectedRule);
  const activeText = summaryTab === 'discord' ? discordText : ingameText;
  const activeLimit = summaryTab === 'discord' ? DISCORD_LIMIT : INGAME_LIMIT;
  const overLimit = activeText.length > activeLimit;

  const WORKLIST_CARDS: { key: Exclude<WorklistKey, 'all'>; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'unresolved', label: 'War-Ineligible', icon: <Swords size={18} />, color: 'var(--color-danger)' },
    { key: 'eligibleForElderRestoration', label: 'Restore to Elder', icon: <CheckCircle size={18} />, color: 'var(--color-cta)' },
    { key: 'removalFlagged', label: 'Flag for Removal', icon: <UserMinus size={18} />, color: 'var(--color-danger)' },
    { key: 'expiringSoon', label: 'Expiring Soon', icon: <Clock size={18} />, color: 'var(--color-muted)' },
  ];

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Strike Log</h1>
          <p className="text-muted">Track rule violations, restore trust, and enforce the three-strike standard.</p>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-outline"
            onClick={openSummary}
            disabled={selectedIds.size === 0}
            title={selectedIds.size === 0 ? 'Select one or more strikes first' : 'Generate a Discord / in-game discipline notice'}
            style={{ whiteSpace: 'nowrap', opacity: selectedIds.size === 0 ? 0.5 : 1, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer' }}
          >
            <FileText size={18} /> Generate Summary{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
          <button className="btn btn-primary" onClick={() => setShowLogModal(true)} style={{ whiteSpace: 'nowrap' }}>
            <Plus size={20} /> Log Strike
          </button>
        </div>
      </div>

      {/* Leadership worklist — actionable buckets; click to filter the dossier list below. */}
      <div className="strike-worklist-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
        {WORKLIST_CARDS.map((c) => {
          const count = worklist[c.key].length;
          const active = worklistFilter === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setWorklistFilter(active ? 'all' : c.key)}
              className="card"
              style={{
                textAlign: 'left', cursor: 'pointer', padding: 'var(--space-md)',
                borderLeft: `3px solid ${c.color}`,
                outline: active ? `2px solid ${c.color}` : 'none', outlineOffset: '-1px',
                opacity: count === 0 && !active ? 0.55 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: c.color, marginBottom: '4px' }}>
                {c.icon}
                <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>{count}</span>
              </div>
              <span className="text-muted" style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{c.label}</span>
            </button>
          );
        })}
      </div>

      {worklistFilter !== 'all' && (
        <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-md)' }}>
          Filtered to <strong>{WORKLIST_CARDS.find((c) => c.key === worklistFilter)?.label}</strong> —{' '}
          <button onClick={() => setWorklistFilter('all')} style={{ background: 'transparent', color: 'var(--color-cta)', cursor: 'pointer', textDecoration: 'underline' }}>show all</button>
        </p>
      )}

      {/* Review queue — auto-detected judgement violations (hit-up) awaiting a decision. */}
      {reviewItems.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '4px solid var(--color-warning)' }}>
          <button
            onClick={() => setReviewOpen((o) => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontWeight: 700, width: '100%' }}
          >
            <ClipboardCheck size={18} className="text-warning" />
            Needs Review
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-warning)', color: '#111', borderRadius: '10px', fontWeight: 700 }}>{reviewItems.length}</span>
            <ChevronRight size={16} style={{ marginLeft: 'auto', transform: reviewOpen ? 'rotate(90deg)' : 'none', transition: 'transform 200ms ease' }} />
          </button>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            Auto-detected but flagged as judgement calls. Confirm to fold into the war&apos;s strike, or dismiss.
          </p>
          {reviewOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
              {reviewItems.map((r) => (
                <div key={r.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: '2px' }}>
                      <strong>{r.person?.display_name || r.member_name || r.player_account_tag}</strong>
                      {r.rule?.name && <span style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'rgba(245,158,11,0.15)', color: 'var(--color-warning)', borderRadius: '10px', fontWeight: 700 }}>{r.rule.name}</span>}
                      {r.war_label && <span className="text-muted" style={{ fontSize: '0.65rem' }}>{r.war_label}</span>}
                    </div>
                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>{r.description}</p>
                    <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                      {r.member_name} ({r.player_account_tag}){r.occurred_at ? ` • ${new Date(r.occurred_at).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <button className="btn btn-primary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.75rem' }} disabled={actingReviewId === r.id} onClick={() => actOnReviewAction(r.id, 'confirm', selectedClanId)}>
                      <Check size={15} /> Confirm
                    </button>
                    <button className="btn btn-outline" style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)', padding: '0.4rem 0.9rem', fontSize: '0.75rem' }} disabled={actingReviewId === r.id} onClick={() => actOnReviewAction(r.id, 'dismiss', selectedClanId)}>
                      <X size={15} /> Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player dossiers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading strikes...</p>
        ) : visibleDossiers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">No strikes match this view.</p>
          </div>
        ) : (
          visibleDossiers.map((d) => (
            <DossierCard
              key={d.accountTag}
              d={d}
              open={!!expanded[d.accountTag]}
              onToggle={() => setExpanded((p) => ({ ...p, [d.accountTag]: !p[d.accountTag] }))}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              rejoinDrafts={rejoinDrafts}
              setRejoinDrafts={setRejoinDrafts}
              openNotes={openNotes}
              setOpenNotes={setOpenNotes}
              noteDrafts={noteDrafts}
              setNoteDrafts={setNoteDrafts}
              onRequestDelete={(id, name) => setConfirmConfig({ isOpen: true, id, title: 'Delete Strike', message: `Permanently remove this strike for ${name}? This cannot be undone.` })}
            />
          ))
        )}
      </div>

      {/* Log Strike Modal */}
      {showLogModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Log a Strike</h2>
              <X onClick={() => setShowLogModal(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleLogStrike} style={{ padding: 'var(--space-lg)' }}>
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>Account</label>
                <select className="input" value={selectedAccount} onChange={(e) => handleSelectAccount(e.target.value)} required>
                  <option value="">Select Account...</option>
                  {accounts.map((a) => <option key={a.player_tag} value={a.player_tag}>{a.in_game_name} ({a.player_tag}) — {a.person?.display_name}</option>)}
                </select>
                {selectedAccount && (
                  <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
                    Person: <strong style={{ color: 'var(--color-text)' }}>{accounts.find((a) => a.player_tag === selectedAccount)?.person?.display_name || '—'}</strong>
                  </p>
                )}
              </div>
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>Rule</label>
                <select className="input" value={selectedRule} onChange={(e) => setSelectedRule(e.target.value)}>
                  <option value="">No specific rule</option>
                  {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              {selectedRuleData?.logging_guidance && (
                <div style={{ padding: 'var(--space-md)', background: 'rgba(34, 197, 94, 0.05)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-md)', border: '1px solid rgba(34, 197, 94, 0.2)', display: 'flex', gap: 'var(--space-md)', fontSize: '0.85rem' }}>
                  <Info className="text-cta" size={20} />
                  <div><p style={{ fontWeight: 700, margin: 0, color: 'var(--color-cta)' }}>Logging Guidance</p><p className="text-muted" style={{ margin: 0, marginTop: '4px' }}>{selectedRuleData.logging_guidance}</p></div>
                </div>
              )}
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>Context <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
                <textarea className="input" rows={4} placeholder="Describe the violation..." value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div style={{ marginBottom: 'var(--space-lg)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={backdate} onChange={(e) => { setBackdate(e.target.checked); if (!e.target.checked) setIssuedAt(''); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  Backdate this strike
                </label>
                {backdate && (
                  <div style={{ marginTop: 'var(--space-sm)' }}>
                    <input type="date" className="input" value={issuedAt} max={toLocalDate(new Date().toISOString())} onChange={(e) => setIssuedAt(e.target.value)} required />
                    <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>The day the violation occurred. The 90-day expiry is calculated from this date.</p>
                  </div>
                )}
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={logging}>{logging ? 'Logging...' : 'Log Strike'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Summary Drawer */}
      {showSummary && (
        <>
          <div className="drawer-overlay" onClick={() => setShowSummary(false)} />
          <aside className="summary-drawer" role="dialog" aria-label="Generate discipline summary">
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Strike Summary</h2>
                <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>{selectedIds.size} strike{selectedIds.size === 1 ? '' : 's'} selected</p>
              </div>
              <X onClick={() => setShowSummary(false)} style={{ cursor: 'pointer', flexShrink: 0 }} />
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <button className={`tab-btn ${summaryTab === 'discord' ? 'active' : ''}`} onClick={() => { setSummaryTab('discord'); setCopied(false); }}>Discord</button>
              <button className={`tab-btn ${summaryTab === 'ingame' ? 'active' : ''}`} onClick={() => { setSummaryTab('ingame'); setCopied(false); }}>In-Game Mail</button>
            </div>
            <div style={{ padding: 'var(--space-lg)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 'var(--space-sm)' }}>
              <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                {summaryTab === 'discord' ? 'Markdown-formatted for Discord. Paste into your announcements channel.' : 'Plain text for Clash clan mail. Leaders/co-leaders can send once per hour.'}
              </p>
              <textarea
                className="input"
                value={activeText}
                onChange={(e) => (summaryTab === 'discord' ? setDiscordText(e.target.value) : setIngameText(e.target.value))}
                style={{ flex: 1, resize: 'none', lineHeight: 1.6, minHeight: '200px' }}
                spellCheck
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: overLimit ? 'var(--color-danger)' : 'var(--color-muted)' }}>{activeText.length} / {activeLimit}</span>
                <button onClick={regenerateActive} className="btn btn-outline" style={{ border: 'none', color: 'var(--color-muted)', padding: '0.4rem 0.75rem', fontSize: '0.75rem' }} title="Discard edits on this tab and rebuild from the selected strikes">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
              {overLimit && (
                <p className="text-danger" style={{ fontSize: '0.75rem', margin: 0, lineHeight: 1.5 }}>
                  {summaryTab === 'ingame'
                    ? `Over the 256-character clan-mail limit by ${activeText.length - activeLimit}. Trim the player list or shorten the wording.`
                    : `Over Discord's 2,000-character limit by ${activeText.length - activeLimit}. Shorten the text or split into two messages.`}
                </p>
              )}
            </div>
            <div style={{ padding: 'var(--space-lg)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button className="btn btn-primary" onClick={copyActive} style={{ width: '100%' }}>
                {copied ? <><Check size={18} /> Copied</> : <><Copy size={18} /> Copy {summaryTab === 'discord' ? 'Discord' : 'In-Game'} Text</>}
              </button>
            </div>
          </aside>
        </>
      )}

      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false, id: '' })}
        onConfirm={deleteStrike}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isLoading={deletingStrike}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Dossier card — one per ACCOUNT: header shows colour/level/count/eligibility (account name as title,
// the person it belongs to as subtitle); body lists each strike with its violations, a single
// trust-restoration approval, removal bookkeeping, and notes. It reads server data + mutation actions
// straight from the store; only UI-local drafts are passed.
// ------------------------------------------------------------------------------------------------

function DossierCard(props: {
  d: AccountDossier;
  open: boolean;
  onToggle: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  rejoinDrafts: Record<string, string>;
  setRejoinDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  openNotes: Record<string, boolean>;
  setOpenNotes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  noteDrafts: Record<string, string>;
  setNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRequestDelete: (id: string, name: string) => void;
}) {
  const { d, open, onToggle, selectedIds, onToggleSelect } = props;

  const loggerNames = useStrikeStore((s) => s.loggerNames);
  const savingStrikeId = useStrikeStore((s) => s.savingStrikeId);
  const savingAction = useStrikeStore((s) => s.savingAction);
  const postingNote = useStrikeStore((s) => s.postingNote);
  const deletingNoteId = useStrikeStore((s) => s.deletingNoteId);
  const onPatch = useStrikeStore((s) => s.patchStrike);
  const addNote = useStrikeStore((s) => s.addNote);
  const deleteNote = useStrikeStore((s) => s.deleteNote);
  const isAuthoredByMe = useStrikeStore((s) => s.isAuthoredByMe);

  const st = d.status;
  const color = LEVEL_COLOR[st.level];
  const activeIds = new Set(d.activeStrikes.map((s) => s.id));

  async function handleAddNote(strikeId: string) {
    const ok = await addNote(strikeId, props.noteDrafts[strikeId] || '');
    if (ok) props.setNoteDrafts((p) => ({ ...p, [strikeId]: '' }));
  }

  return (
    <div className="card" style={{ borderLeft: `4px solid ${color}`, padding: 0 }}>
      {/* Header */}
      <button
        onClick={onToggle}
        style={{ width: '100%', textAlign: 'left', background: 'transparent', cursor: 'pointer', padding: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '2rem', height: '2rem', borderRadius: '50%', background: color, color: '#111', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>
          {st.activeCount}
        </span>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{d.inGameName}</h3>
            {st.removalFlagged && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'var(--color-danger)', color: '#fff', borderRadius: '10px', fontWeight: 700 }}>REMOVAL</span>}
            {!st.warEligible && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', borderRadius: '10px', fontWeight: 700 }}>WAR-INELIGIBLE</span>}
            {st.eligibleForElderRestoration && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(34,197,94,0.12)', color: 'var(--color-cta)', borderRadius: '10px', fontWeight: 700 }}>RESTORE ELDER</span>}
          </div>
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {d.displayName} • {st.activeCount} active {st.activeCount === 1 ? 'strike' : 'strikes'}
            {d.strikes.length > st.activeCount ? ` • ${d.strikes.length - st.activeCount} expired` : ''}
            {st.nextExpiry ? ` • next expires in ${daysUntil(st.nextExpiry)}d` : ''}
          </span>
        </div>
        <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease', color: 'var(--color-muted)' }} />
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '0 var(--space-lg) var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {d.strikes.map((s, i) => {
            const active = activeIds.has(s.id);
            const saving = savingStrikeId === s.id;
            const notesOpen = !!props.openNotes[s.id];
            const notes = [...(s.strike_notes || [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return (
              <div key={s.id} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', padding: 'var(--space-md)', border: '1px solid rgba(255,255,255,0.05)', opacity: active ? 1 : 0.65 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selectedIds.has(s.id)}
                    title="Select for summary"
                    onClick={() => onToggleSelect(s.id)}
                    style={{ marginTop: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', flexShrink: 0, borderRadius: 'var(--radius-sm)', border: selectedIds.has(s.id) ? '2px solid var(--color-cta)' : '2px solid var(--color-muted)', background: selectedIds.has(s.id) ? 'var(--color-cta)' : 'transparent', color: '#fff', cursor: 'pointer' }}
                  >
                    {selectedIds.has(s.id) && <Check size={13} strokeWidth={3} />}
                  </button>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.9rem' }}>Strike #{d.strikes.length - i}</strong>
                      <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--color-warning)' : 'var(--color-muted)' }}>
                        {active ? 'ACTIVE' : 'EXPIRED'}
                      </span>
                      {s.war_source !== 'manual' && <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)', textTransform: 'uppercase' }}>{s.war_source}</span>}
                      {s.origin === 'auto' && <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)' }}>AUTO</span>}
                    </div>
                    <p style={{ fontSize: '0.85rem', margin: '4px 0 0', lineHeight: 1.5 }}>
                      <span className="text-muted">Rule: </span><strong>{s.rule?.name || 'General violation'}</strong>
                    </p>
                    {/* Folded violations */}
                    {(s.strike_violations || []).length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem', fontSize: '0.82rem', lineHeight: 1.5 }}>
                        {s.strike_violations!.map((v) => (
                          <li key={v.id} style={{ color: 'var(--color-text)' }}>
                            {v.description}
                            {v.occurred_at ? <span className="text-muted"> — {new Date(v.occurred_at).toLocaleDateString()}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', marginTop: '6px' }}>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Issued {new Date(s.issued_at).toLocaleDateString()}</span>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Expires {new Date(expiryOf(s.issued_at)).toLocaleDateString()}</span>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>By {loggerNames[s.logged_by] || s.logged_by}</span>
                      {s.war_label && <span className="text-muted" style={{ fontSize: '0.7rem' }}>{s.war_label}</span>}
                    </div>
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ border: 'none', color: 'var(--color-danger)', padding: '0.35rem 0.7rem', fontSize: '0.72rem' }}
                    onClick={() => props.onRequestDelete(s.id, d.displayName)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>

                {/* Trust restoration — a single leader approval clears the demotion / war-ineligibility intent. */}
                <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    {s.leadership_approved ? (
                      <>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--color-cta)', fontWeight: 600 }}>
                          <CheckCircle size={15} /> Trust restored{s.approved_by ? ` by ${loggerNames[s.approved_by] || s.approved_by}` : ''}
                        </span>
                        <button className="btn btn-outline" style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)', padding: '0.3rem 0.7rem', fontSize: '0.72rem' }} disabled={saving} onClick={() => onPatch(s.id, { leadershipApproved: false }, 'reopen')}>
                          {saving && savingAction === 'reopen' ? 'Reopening...' : 'Reopen'}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-primary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.75rem' }} disabled={saving} onClick={() => onPatch(s.id, { leadershipApproved: true }, 'approve')}>
                        <ClipboardCheck size={15} /> {saving && savingAction === 'approve' ? 'Approving...' : 'Approve trust restoration'}
                      </button>
                    )}
                  </div>
                  <p className="text-muted" style={{ fontSize: '0.68rem', margin: '6px 0 0', lineHeight: 1.5 }}>
                    Approval clears the demotion / war-ineligibility intent. It does <strong>not</strong> remove the strike — only the 90-day expiry does.
                  </p>
                </div>

                {/* Removal (third strike) */}
                <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  {s.removal_at ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 600 }}>
                        <UserMinus size={15} /> Marked removed {new Date(s.removal_at).toLocaleDateString()}
                        {s.rejoin_at ? ` • may rejoin ${new Date(s.rejoin_at).toLocaleDateString()}` : ''}
                      </span>
                      <button className="btn btn-outline" style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)', padding: '0.3rem 0.7rem', fontSize: '0.72rem' }} disabled={saving} onClick={() => onPatch(s.id, { markRemoved: false }, 'removal')}>
                        {saving && savingAction === 'removal' ? 'Undoing...' : 'Undo'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                      <input
                        type="date"
                        className="input"
                        value={props.rejoinDrafts[s.id] || ''}
                        onChange={(e) => props.setRejoinDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                        style={{ width: 'auto', padding: '0.35rem 0.5rem', fontSize: '0.78rem' }}
                        title="Optional earliest rejoin date"
                      />
                      <button
                        className="btn btn-outline"
                        style={{ border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}
                        disabled={saving}
                        onClick={() => onPatch(s.id, { markRemoved: true, rejoinAt: props.rejoinDrafts[s.id] ? dateToNoonIso(props.rejoinDrafts[s.id]) : null }, 'removal')}
                      >
                        <UserMinus size={15} /> {saving && savingAction === 'removal' ? 'Marking...' : 'Mark removed'}
                      </button>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Records the intent — the in-game kick stays manual.</span>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <button onClick={() => props.setOpenNotes((p) => ({ ...p, [s.id]: !p[s.id] }))} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                    <MessageSquare size={15} /> Notes {notes.length > 0 ? `(${notes.length})` : ''}
                    <ChevronDown size={14} style={{ transform: notesOpen ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
                  </button>
                  {notesOpen && (
                    <div style={{ marginTop: 'var(--space-md)' }}>
                      {notes.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                          {notes.map((n) => {
                            const mine = isAuthoredByMe(n.author_tag);
                            const edited = n.updated_at && n.updated_at !== n.created_at;
                            return (
                              <div key={n.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' }}>
                                <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>{loggerNames[n.author_tag] || n.author_tag} • {new Date(n.created_at).toLocaleDateString()}{edited ? ' (edited)' : ''}</span>
                                  {mine && (
                                    <button onClick={() => deleteNote(s.id, n.id)} disabled={deletingNoteId === n.id} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
                        <textarea className="input" rows={1} placeholder="Add a progress note..." value={props.noteDrafts[s.id] || ''} onChange={(e) => props.setNoteDrafts((p) => ({ ...p, [s.id]: e.target.value }))} style={{ resize: 'vertical', flex: 1 }} />
                        <button onClick={() => handleAddNote(s.id)} disabled={postingNote === s.id || !(props.noteDrafts[s.id] || '').trim()} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          <Send size={14} /> {postingNote === s.id ? 'Posting...' : 'Post'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
