'use client';

import { useState, useEffect, use } from 'react';
import { supabase } from '@/lib/supabase';
import {
  User,
  Shield,
  AlertTriangle,
  History,
  ChevronLeft,
  Calendar,
  ExternalLink,
  Trash2,
  Link as LinkIcon,
  Baby,
  Clock,
  ArrowUpCircle,
  MessageSquare,
  Pencil,
  Send,
  MessageCircle,
  ClipboardCheck,
  UserPlus,
  Flag,
  CheckCircle,
  Circle,
  Route,
  X,
  RotateCcw,
  MinusCircle,
  AtSign
} from 'lucide-react';
import Link from 'next/link';
import { Person, PlayerAccount, Strike, StrikeViolation, LeadershipLog, Clan, Rule, MemberNote, OnboardingEvent, OnboardingEventType } from '@/types/database';
import { babyDaysLeft } from '@/lib/babies';
import { expiryOf } from '@/lib/strikes/status';
import { buildDossiers, type StrikeWithContext } from '@/lib/strikes/dossier';
import { PIPELINE, deriveOnboardingStatus, MAX_ENGAGEMENT_ATTEMPTS } from '@/lib/onboarding';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import Toast, { ToastState } from '@/components/ui/Toast';
import { useRouter } from 'next/navigation';

type FullPerson = Person & {
  player_accounts: (PlayerAccount & { clan: Clan })[];
  strikes: (Strike & { rule: Rule | null, strike_violations: StrikeViolation[] })[];
  activity_logs: LeadershipLog[];
  member_notes: MemberNote[];
  onboarding_events: OnboardingEvent[];
};

// Maps the icon-name strings declared in the onboarding PIPELINE to lucide components,
// keeping the pipeline definition (src/lib/onboarding.ts) free of React imports.
const STEP_ICONS: Record<string, any> = {
  MessageCircle, ClipboardCheck, LinkIcon, UserPlus, Flag, Send, CheckCircle, ArrowUpCircle,
};

const EVENT_LABELS: Record<OnboardingEventType, string> = {
  engagement_attempt: 'Engagement attempt',
  rules_passed: 'War rules passed',
  linked_accounts_checked: 'Linked accounts checked',
  additional_account_registered: 'Additional account registered',
  assigned_clan: 'Clan assigned',
  invited_discord: 'Invited to Discord',
  joined_discord: 'Joined Discord',
  discord_waived: 'No Discord',
  promoted_elder: 'Promoted to Elder',
};

export default function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [person, setPerson] = useState<FullPerson | null>(null);
  const [loggerNames, setLoggerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [babyTrialDays, setBabyTrialDays] = useState(4);
  const [familyClans, setFamilyClans] = useState<Clan[]>([]);
  const [currentUserTag, setCurrentUserTag] = useState<string | null>(null);
  const [myPersonId, setMyPersonId] = useState<string | null>(null);
  // author player_tag -> person_id, so alts of an author can be granted edit/delete controls.
  const [authorPersons, setAuthorPersons] = useState<Record<string, string | null>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  // Baby comment thread state
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // In-flight guards for onboarding-step and player-removal mutations.
  const [recordingEvent, setRecordingEvent] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Discord-link editor state (persons.discord_user_id — for @-mentions in strike webhooks).
  const [editingDiscord, setEditingDiscord] = useState(false);
  const [discordDraft, setDiscordDraft] = useState('');
  const [savingDiscord, setSavingDiscord] = useState(false);

  // Modal state
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    type: 'player' as 'player' | 'person',
    tag: '',
    title: '',
    message: ''
  });

  useEffect(() => {
    fetchPerson();
  }, [id]);

  useEffect(() => {
    // Family clans populate the clan-assignment dropdown (no hardcoded 9.1 / Mini).
    supabase.from('clans').select('*').eq('active', true).order('display_order')
      .then(({ data }) => setFamilyClans((data as Clan[]) || []));
  }, []);

  useEffect(() => {
    // Identify the acting leader (and their persona) so we can show edit/delete on comments
    // authored by them or any of their alts (same person_id).
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setCurrentUserTag(d?.user?.player_tag ?? null);
        setMyPersonId(d?.user?.person_id ?? null);
      })
      .catch(() => {});
  }, []);

  async function fetchPerson() {
    setLoading(true);
    try {
      const { data: pData, error: pError } = await supabase
        .from('persons')
        .select(`
          *,
          player_accounts (
            *,
            clan:clans (*)
          ),
          strikes (
            *,
            rule:rules (*),
            strike_violations (*)
          ),
          activity_logs:leadership_logs (*),
          member_notes (*),
          onboarding_events (*)
        `)
        .eq('id', id)
        .single();

      if (pError) throw pError;
      setPerson(pData as FullPerson);

      const { data: trialSetting } = await supabase.from('settings').select('value').eq('key', 'baby_trial_days').single();
      const parsedTrial = parseInt(String(trialSetting?.value ?? ''), 10);
      if (Number.isFinite(parsedTrial) && parsedTrial > 0) setBabyTrialDays(parsedTrial);

      // Resolve player_tags (strike loggers + baby-comment authors) to display names.
      const loggerTags = Array.from(new Set([
        ...((pData as FullPerson)?.strikes || []).map(s => s.logged_by),
        ...((pData as FullPerson)?.member_notes || []).map(c => c.author_tag),
        ...((pData as FullPerson)?.onboarding_events || []).map(e => e.actor_tag),
      ].filter(Boolean) as string[]));
      if (loggerTags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, person_id, in_game_name, person:persons (display_name)')
          .in('player_tag', loggerTags);
        const map: Record<string, string> = {};
        const persons: Record<string, string | null> = {};
        for (const l of (loggers as any[]) || []) {
          map[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
          persons[l.player_tag] = l.person_id ?? null;
        }
        setLoggerNames(map);
        setAuthorPersons(persons);
      }
    } catch (err) {
      console.error('Error fetching person:', err);
    } finally {
      setLoading(false);
    }
  }

  // Patch only the onboarding-events slice of `person`, so recording a step never rebuilds the
  // whole profile. This lets a leader tick several steps in a row with instant feedback.
  function updateEvents(updater: (list: OnboardingEvent[]) => OnboardingEvent[]) {
    setPerson(p => (p ? { ...p, onboarding_events: updater(p.onboarding_events || []) } : p));
  }

  async function recordOnboardingEvent(
    eventType: OnboardingEventType,
    opts?: { outcome?: 'replied' | 'ignored'; clanId?: string }
  ) {
    if (recordingEvent) return;
    setRecordingEvent(true);
    // Optimistic: show the event immediately, persist in the background, reconcile on response.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: OnboardingEvent = {
      id: tempId,
      person_id: id,
      event_type: eventType,
      actor_tag: currentUserTag,
      outcome: opts?.outcome ?? null,
      clan_id: opts?.clanId ?? null,
      account_tag: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    updateEvents(list => [...list, optimistic]);
    try {
      const res = await fetch(`/api/onboarding/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, outcome: opts?.outcome, clanId: opts?.clanId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to record action');
      const saved = await res.json();
      updateEvents(list => list.map(e => (e.id === tempId ? saved : e)));
    } catch (err: any) {
      updateEvents(list => list.filter(e => e.id !== tempId));
      setToast({ type: 'error', message: err.message || 'Error recording action' });
    } finally {
      setRecordingEvent(false);
    }
  }

  async function deleteOnboardingEvent(eventId: string) {
    if (deletingEvent) return;
    setDeletingEvent(true);
    // Optimistic removal with revert on failure. Temp (unsaved) rows aren't deletable.
    let removed: OnboardingEvent | undefined;
    updateEvents(list => {
      removed = list.find(e => e.id === eventId);
      return list.filter(e => e.id !== eventId);
    });
    try {
      const res = await fetch(`/api/onboarding/${id}?eventId=${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to remove action');
    } catch (err: any) {
      if (removed) updateEvents(list => [...list, removed!]);
      setToast({ type: 'error', message: err.message || 'Error removing action' });
    } finally {
      setDeletingEvent(false);
    }
  }

  // Set, change, or clear this persona's Discord link (persons.discord_user_id). Pass '' to unlink.
  async function saveDiscordId(value: string) {
    if (savingDiscord) return;
    setSavingDiscord(true);
    try {
      const res = await fetch(`/api/persons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_user_id: value.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save Discord ID');
      const saved = await res.json();
      setPerson(p => (p ? { ...p, discord_user_id: saved.discord_user_id } : p));
      setEditingDiscord(false);
      setToast({ type: 'success', message: saved.discord_user_id ? 'Discord linked.' : 'Discord unlinked.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Error saving Discord ID' });
    } finally {
      setSavingDiscord(false);
    }
  }

  async function handleAddComment() {
    const body = newComment.trim();
    if (!body) return;
    setPostingComment(true);
    try {
      const res = await fetch('/api/members/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: id, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add comment');
      setNewComment('');
      fetchPerson();
      setToast({ type: 'success', message: 'Note added.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Error adding comment' });
    } finally {
      setPostingComment(false);
    }
  }

  async function handleSaveEdit(commentId: string) {
    const body = editDraft.trim();
    if (!body) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/members/notes/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save');
      setEditingCommentId(null);
      setEditDraft('');
      fetchPerson();
      setToast({ type: 'success', message: 'Note updated.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Error saving comment' });
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    try {
      const res = await fetch(`/api/members/notes/${commentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete');
      fetchPerson();
      setToast({ type: 'success', message: 'Note deleted.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Error deleting comment' });
    } finally {
      setDeletingCommentId(null);
    }
  }

  async function handleRemovePlayer() {
    if (removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(confirmConfig.tag)}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmConfig({ ...confirmConfig, isOpen: false });
        if (person?.player_accounts.length === 1) {
            router.push('/dashboard/members');
        } else {
            fetchPerson();
        }
      }
    } catch (err) { alert('Error removing player'); }
    finally { setRemoving(false); }
  }

  async function handleUnlinkPlayer(tag: string) {
      try {
          const { error } = await supabase.from('player_accounts').update({ person_id: null }).eq('player_tag', tag);
          if (error) throw error;
          if (person?.player_accounts.length === 1) {
              await supabase.from('persons').delete().eq('id', id);
              router.push('/dashboard/members');
          } else {
              fetchPerson();
          }
      } catch (err) { alert('Error unlinking player'); }
  }

  if (loading) return <p className="text-muted">Loading profile...</p>;
  if (!person) return <p className="text-danger">Person not found.</p>;

  return (
    <div>
      <Link href="/dashboard/members" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
        <ChevronLeft size={16} /> Back to Registry
      </Link>

      <div className="profile-grid">
        {/* Left Column: Person Info & Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={32} color="var(--color-cta)" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{person.display_name}</h1>
                <p className="text-muted" style={{ fontSize: '0.8rem' }}>Member since {new Date(person.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {person.is_baby && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--radius-md)' }}>
                <span className="baby-badge">
                  <Baby size={12} /> BABY
                  <span className="baby-badge-count">
                    <Clock size={11} /> {(() => { const d = babyDaysLeft(person.baby_started_at, babyTrialDays); return d > 0 ? `${d}d left` : 'trial ended'; })()}
                  </span>
                </span>
                <span className="text-muted" style={{ fontSize: '0.7rem', textAlign: 'right' }}>
                  Promotion is automatic on in-game Elder promotion
                </span>
              </div>
            )}

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
               <h3 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                 <AtSign size={15} /> Discord
               </h3>
               {editingDiscord ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                   <input
                     autoFocus
                     value={discordDraft}
                     onChange={e => setDiscordDraft(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') saveDiscordId(discordDraft); if (e.key === 'Escape') setEditingDiscord(false); }}
                     placeholder="Discord user ID (17–20 digits)"
                     inputMode="numeric"
                     className="input"
                     style={{ fontSize: '0.8rem' }}
                   />
                   <p className="text-muted" style={{ fontSize: '0.68rem', margin: 0 }}>
                     Discord → User Settings → Advanced → Developer Mode, then right-click the member → Copy User ID.
                   </p>
                   <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                     <button onClick={() => saveDiscordId(discordDraft)} disabled={savingDiscord} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingDiscord ? 'Saving...' : 'Save'}</button>
                     <button onClick={() => setEditingDiscord(false)} disabled={savingDiscord} className="btn btn-outline" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                   </div>
                 </div>
               ) : (
                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                   {person.discord_user_id ? (
                     <span style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-success)' }}>
                       <CheckCircle size={13} /> Linked <span className="text-muted" style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>({person.discord_user_id})</span>
                     </span>
                   ) : (
                     <span className="text-muted" style={{ fontSize: '0.8rem' }}>Not linked — strikes won&apos;t @-mention this member.</span>
                   )}
                   <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                     <button onClick={() => { setDiscordDraft(person.discord_user_id || ''); setEditingDiscord(true); }} className="btn btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem' }}>{person.discord_user_id ? 'Change' : 'Link'}</button>
                     {person.discord_user_id && (
                       <button onClick={() => saveDiscordId('')} disabled={savingDiscord} className="btn btn-outline" style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem', color: 'var(--color-danger)' }}>Unlink</button>
                     )}
                   </div>
                 </div>
               )}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)' }}>
               <h3 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>Linked Accounts</h3>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                 {person.player_accounts.map(acc => (
                   <div key={acc.player_tag} style={{ 
                     padding: 'var(--space-md)', 
                     background: 'rgba(255,255,255,0.02)', 
                     borderRadius: 'var(--radius-md)',
                     border: '1px solid rgba(255,255,255,0.05)'
                   }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <span style={{ fontWeight: '700' }}>{acc.in_game_name}</span>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <button onClick={() => handleUnlinkPlayer(acc.player_tag)} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Unlink Account"><LinkIcon size={14} /></button>
                            <button onClick={() => setConfirmConfig({ isOpen: true, type: 'player', tag: acc.player_tag, title: 'Remove Account', message: `Permanently delete ${acc.in_game_name} from registry?` })} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete Account"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }} className="text-muted">
                        <span>{acc.player_tag} • TH{acc.th_level}</span>
                        <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>{acc.clan.display_name}</span>
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        </div>

        {/* Right Column: History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
           {/* Onboarding Timeline — a single inline checklist. Each row is either done (who/when)
               or pending with its own action button. Recording is allowed regardless of baby /
               graduated status, so a leader can backfill the checklist even after sync has already
               auto-promoted the member from an in-game Elder promotion. Any active leader (any role)
               may mark a step, and undo their own. The card lingers for ONBOARDING_RETENTION_DAYS
               after graduation so a leader who missed a step before the auto-promotion still has a
               window to backfill, then retires to keep permanent-member profiles clean. */}
           {(() => {
             const events = [...(person.onboarding_events || [])].sort(
               (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
             );
             const status = deriveOnboardingStatus(events);
             // Show the card for members with an onboarding lifecycle — babies, or anyone with
             // recorded events. Legacy permanent members (no events) stay clean. After graduation the
             // baby phase has ended (is_baby=false), so we keep the card for a 30-day backfill window
             // measured from the promoted_elder event (sync always writes it on auto-promotion), then
             // retire it. Non-baby members with events but no promotion never auto-retire.
             const ONBOARDING_RETENTION_DAYS = 30;
             const promotedAt = events.find(e => e.event_type === 'promoted_elder')?.created_at;
             const retired =
               !!promotedAt &&
               Date.now() - new Date(promotedAt).getTime() > ONBOARDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
             if (!person.is_baby && (events.length === 0 || retired)) return null;

             // Clan assignment only becomes relevant once additional accounts have been registered.
             const hasAdditional = events.some(e => e.event_type === 'additional_account_registered');
             // "No Discord" waiver: skips both Discord steps rather than leaving them pending.
             const waiveEvent = events.find(e => e.event_type === 'discord_waived') || null;
             const discordWaived = !!waiveEvent;
             const clanName = (cid: string | null) => familyClans.find(c => c.id === cid)?.display_name || 'clan';
             const canRemove = (ev: OnboardingEvent) =>
               !ev.id.startsWith('temp-') &&           // still saving — not yet removable
               ev.event_type !== 'promoted_elder' &&
               ((!!currentUserTag && ev.actor_tag === currentUserTag) ||
                (!!myPersonId && ev.actor_tag !== null && (authorPersons[ev.actor_tag] ?? null) === myPersonId));
             const actorName = (ev: OnboardingEvent) =>
               ev.actor_tag ? (loggerNames[ev.actor_tag] || (ev.actor_tag === currentUserTag ? 'You' : ev.actor_tag)) : 'System (sync)';

             // Engagement attempt as a filled pill. Tapping a removable pill clears it (no undo button);
             // colour encodes the outcome. Attribution + date live in the tooltip to avoid clutter.
             const attemptPill = (ev: OnboardingEvent) => {
               const removable = canRemove(ev);
               const replied = ev.outcome === 'replied';
               return (
                 <button
                   key={ev.id}
                   onClick={() => removable && deleteOnboardingEvent(ev.id)}
                   disabled={deletingEvent}
                   title={`${actorName(ev)} · ${new Date(ev.created_at).toLocaleDateString()}${removable ? ' · tap to remove' : ''}`}
                   style={{
                     padding: '0.28rem 0.7rem', fontSize: '0.72rem', borderRadius: 999, fontWeight: 600,
                     background: replied ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                     border: `1px solid ${replied ? 'rgba(34,197,94,0.55)' : 'rgba(245,158,11,0.55)'}`,
                     color: replied ? 'var(--color-cta)' : 'var(--color-warning)',
                     cursor: removable ? 'pointer' : 'default',
                   }}
                 >
                   {replied ? 'Replied' : 'Ignored'}
                 </button>
               );
             };

             // Outline segmented control for the NEXT attempt; selecting a side fills it into a pill.
             const attemptPicker = (n: number) => (
               <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                 <span className="text-muted" style={{ fontSize: '0.68rem' }}>Attempt {n}:</span>
                 <span style={{ display: 'inline-flex', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
                   <button onClick={() => recordOnboardingEvent('engagement_attempt', { outcome: 'replied' })} disabled={recordingEvent} style={{ padding: '0.28rem 0.7rem', fontSize: '0.72rem', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', borderRight: '1px solid rgba(255,255,255,0.15)' }}>Replied</button>
                   <button onClick={() => recordOnboardingEvent('engagement_attempt', { outcome: 'ignored' })} disabled={recordingEvent} style={{ padding: '0.28rem 0.7rem', fontSize: '0.72rem', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }}>Ignored</button>
                 </span>
               </span>
             );

             const btn = { padding: '0.35rem 0.7rem', fontSize: '0.72rem' } as const;
             const undoBtn = (ev: OnboardingEvent) => (
               <button onClick={() => deleteOnboardingEvent(ev.id)} disabled={deletingEvent} className="btn btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem' }} title="Undo this step">
                 <RotateCcw size={12} /> Undo
               </button>
             );

             // Right-hand control for a PENDING single-toggle step.
             const pendingControl = (stepKey: string) => {
               switch (stepKey) {
                 case 'rules':
                   return <button onClick={() => recordOnboardingEvent('rules_passed')} disabled={recordingEvent} className="btn btn-outline" style={btn}>Mark done</button>;
                 case 'linked':
                   return <button onClick={() => recordOnboardingEvent('linked_accounts_checked')} disabled={recordingEvent} className="btn btn-outline" style={btn}>Mark done</button>;
                 case 'additional':
                   return <button onClick={() => recordOnboardingEvent('additional_account_registered')} disabled={recordingEvent} className="btn btn-outline" style={btn}>Mark done</button>;
                 case 'assignment':
                   return (
                     <select
                       className="input"
                       value=""
                       disabled={familyClans.length === 0 || recordingEvent}
                       onChange={(e) => e.target.value && recordOnboardingEvent('assigned_clan', { clanId: e.target.value })}
                       style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem', width: 'auto', maxWidth: 160 }}
                     >
                       <option value="">Assign clan…</option>
                       {familyClans.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                     </select>
                   );
                 case 'invited':
                   return (
                     <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                       <button
                         onClick={() => recordOnboardingEvent('discord_waived')}
                         disabled={recordingEvent}
                         style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                         title="This member has no Discord — skip both Discord steps"
                       >
                         No Discord
                       </button>
                       <button onClick={() => recordOnboardingEvent('invited_discord')} disabled={recordingEvent} className="btn btn-outline" style={btn}>Mark done</button>
                     </span>
                   );
                 case 'joined':
                   return <button onClick={() => recordOnboardingEvent('joined_discord')} disabled={recordingEvent} className="btn btn-outline" style={btn}>Mark done</button>;
                 default:
                   return null;
               }
             };

             return (
               <div className="card">
                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                     <Route size={20} color="var(--color-cta)" />
                     <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Onboarding</h2>
                   </div>
                   {status.promoted ? (
                     <span className="baby-badge" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--color-cta)' }}>
                       <CheckCircle size={11} /> Graduated
                     </span>
                   ) : status.concluded ? (
                     <span className="baby-badge" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)' }}>
                       <X size={11} /> Concluded
                     </span>
                   ) : person.is_baby ? (
                     <span className="baby-badge"><Baby size={11} /> In progress</span>
                   ) : null}
                 </div>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                   {PIPELINE.map(step => {
                     // Interlink: hide clan assignment until additional accounts exist.
                     if (step.key === 'assignment' && !hasAdditional) return null;

                     const stepEvents = events.filter(e => step.eventTypes.includes(e.event_type));
                     const isEngagement = step.key === 'engagement';
                     const isPromoted = step.key === 'promoted';
                     // Discord steps are "skipped" (not pending, not done) when the member has no Discord.
                     const waivedSkip = (step.key === 'invited' || step.key === 'joined') && discordWaived && stepEvents.length === 0;
                     const done = isEngagement ? status.replied : stepEvents.length > 0;
                     const Icon = STEP_ICONS[step.icon] || Circle;
                     const primary = stepEvents[stepEvents.length - 1];

                     // Skipped Discord row: muted "No Discord" state, with Undo on the first row.
                     if (waivedSkip) {
                       return (
                         <div key={step.key} style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start', padding: 'var(--space-sm) 0' }}>
                           <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                             <MinusCircle size={13} color="var(--color-muted)" />
                           </div>
                           <div style={{ flex: 1, minWidth: 0 }}>
                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', minHeight: 24 }}>
                               <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-muted)' }}>
                                 {step.label}<span className="text-muted" style={{ fontSize: '0.72rem', fontWeight: 400 }}> · No Discord</span>
                               </span>
                               {step.key === 'invited' && waiveEvent && canRemove(waiveEvent) && undoBtn(waiveEvent)}
                             </div>
                             {step.key === 'invited' && waiveEvent && (
                               <div style={{ fontSize: '0.68rem', marginTop: '2px' }} className="text-muted">
                                 {actorName(waiveEvent)} · {new Date(waiveEvent.created_at).toLocaleDateString()}
                               </div>
                             )}
                           </div>
                         </div>
                       );
                     }

                     // Right-hand slot: keep it consistent — pending shows the action, done shows Undo
                     // (in the SAME place), so marking a step never makes its control disappear.
                     // Engagement renders its attempts as pills below the label (they wrap), so its
                     // header slot stays empty; every other step keeps action/Undo in the slot.
                     let slot: any = null;
                     if (isPromoted) {
                       slot = done ? null : <span className="text-muted" style={{ fontSize: '0.68rem' }}>auto on in-game promotion</span>;
                     } else if (!isEngagement) {
                       slot = done ? (primary && canRemove(primary) ? undoBtn(primary) : null) : pendingControl(step.key);
                     }

                     return (
                       <div key={step.key} style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-start', padding: 'var(--space-sm) 0' }}>
                         <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: done ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${done ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.1)'}` }}>
                           {done ? <CheckCircle size={13} color="var(--color-cta)" /> : <Icon size={13} color="var(--color-muted)" />}
                         </div>
                         <div style={{ flex: 1, minWidth: 0 }}>
                           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', minHeight: 24 }}>
                             <span style={{ fontSize: '0.85rem', fontWeight: 600, color: done ? 'var(--color-text)' : 'var(--color-muted)' }}>
                               {step.label}
                               {step.key === 'assignment' && done && primary && (
                                 <span className="text-muted" style={{ fontSize: '0.72rem', fontWeight: 400 }}> · {clanName(primary.clan_id)}</span>
                               )}
                               {isEngagement && status.attemptsUsed > 0 && !status.replied && (
                                 <span className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 400 }}> · {status.attemptsUsed}/{MAX_ENGAGEMENT_ATTEMPTS}</span>
                               )}
                             </span>
                             {slot}
                           </div>
                           {isEngagement ? (
                             /* Attempts as filled pills (tap to clear) + a segmented picker for the next
                                attempt. Clearing a pill drops below 3, so 'concluded' is never a dead end. */
                             <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                               {stepEvents.map(ev => attemptPill(ev))}
                               {!status.replied && !status.concluded && stepEvents.length < MAX_ENGAGEMENT_ATTEMPTS && attemptPicker(stepEvents.length + 1)}
                               {status.concluded && (
                                 <span className="text-muted" style={{ fontSize: '0.7rem' }}>concluded — no reply after {MAX_ENGAGEMENT_ATTEMPTS} attempts</span>
                               )}
                             </div>
                           ) : (
                             /* Single attribution line for other steps (Undo lives in the slot). */
                             primary && (
                               <div style={{ fontSize: '0.68rem', marginTop: '2px' }} className="text-muted">
                                 {actorName(primary)} · {new Date(primary.created_at).toLocaleDateString()}
                               </div>
                             )
                           )}
                         </div>
                       </div>
                     );
                   })}
                 </div>
               </div>
             );
           })()}

           {/* Member Notes (comment thread) — available for every member; baby-phase notes carry forward */}
           {(
             <div className="card">
               <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                   <MessageSquare size={20} color="var(--color-cta)" />
                   <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Notes (exceptional)</h2>
                 </div>
                 {person.is_baby && (
                   <span className="baby-badge">
                     <Baby size={11} /> Baby trial
                   </span>
                 )}
               </div>

               <div style={{ marginBottom: person.member_notes.length ? 'var(--space-lg)' : 0 }}>
                 <textarea
                   className="input"
                   rows={2}
                   placeholder="Add a note about this member..."
                   value={newComment}
                   onChange={(e) => setNewComment(e.target.value)}
                   style={{ resize: 'vertical' }}
                 />
                 <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                   <button onClick={handleAddComment} disabled={postingComment || !newComment.trim()} className="btn btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}>
                     <Send size={14} /> {postingComment ? 'Posting...' : 'Post Note'}
                   </button>
                 </div>
               </div>

               {person.member_notes.length === 0 ? (
                 <p className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center' }}>No notes yet.</p>
               ) : (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                   {[...person.member_notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(c => {
                     // The acting user owns a note if it's from their account, or from an alt
                     // that shares their persona (same person_id) — mirrors the API guard.
                     const authorPid = authorPersons[c.author_tag] ?? null;
                     const mine =
                       (!!currentUserTag && c.author_tag === currentUserTag) ||
                       (!!myPersonId && authorPid !== null && authorPid === myPersonId);
                     const edited = c.updated_at && c.updated_at !== c.created_at;
                     return (
                       <div key={c.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid rgba(34, 197, 94, 0.4)' }}>
                         {editingCommentId === c.id ? (
                           <div>
                             <textarea className="input" rows={2} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} style={{ resize: 'vertical' }} />
                             <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                               <button onClick={() => { setEditingCommentId(null); setEditDraft(''); }} className="btn btn-outline" style={{ border: 'none', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                               <button onClick={() => handleSaveEdit(c.id)} disabled={savingEdit || !editDraft.trim()} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingEdit ? 'Saving...' : 'Save'}</button>
                             </div>
                           </div>
                         ) : (
                           <>
                             <p style={{ fontSize: '0.85rem', margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{c.body}</p>
                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
                               <span style={{ fontSize: '0.7rem' }} className="text-muted">
                                 {loggerNames[c.author_tag] || c.author_tag} • {new Date(c.created_at).toLocaleDateString()}{edited ? ' (edited)' : ''}
                               </span>
                               {mine && (
                                 <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                   <button onClick={() => { setEditingCommentId(c.id); setEditDraft(c.body); }} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Edit"><Pencil size={13} /></button>
                                   <button onClick={() => handleDeleteComment(c.id)} disabled={deletingCommentId === c.id} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
                                 </div>
                               )}
                             </div>
                           </>
                         )}
                       </div>
                     );
                   })}
                 </div>
               )}
             </div>
           )}

           {/* Strike History — grouped per ACCOUNT: each of the member's accounts is judged on its own
               strikes (own count / colour / war-eligibility / removal-at-3), never combined. */}
           {(() => {
             const now = new Date();
             const nameByTag = new Map(person.player_accounts.map(a => [a.player_tag, a.in_game_name]));
             const dossiers = buildDossiers(person.strikes as unknown as StrikeWithContext[], now);
             const levelColor: Record<string, string> = { clear: 'var(--color-muted)', green: 'var(--color-cta)', orange: 'var(--color-warning)', red: 'var(--color-danger)' };
             return (
               <div className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                    <AlertTriangle size={20} className="text-warning" />
                    <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Strike History</h2>
                  </div>
                  {dossiers.length === 0 ? (
                    <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No strikes on record.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
                      {dossiers.map(dos => {
                        const status = dos.status;
                        const accountName = nameByTag.get(dos.accountTag) || dos.inGameName;
                        return (
                          <div key={dos.accountTag}>
                            {/* Per-account status header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700 }}>{accountName}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '1.8rem', height: '1.8rem', borderRadius: '50%', background: levelColor[status.level], color: '#111', fontWeight: 800, fontSize: '0.9rem' }}>{status.activeCount}</span>
                                <span className="text-muted" style={{ fontSize: '0.75rem' }}>active</span>
                                {status.removalFlagged && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'var(--color-danger)', color: '#fff', borderRadius: '10px', fontWeight: 700 }}>REMOVAL</span>}
                                {!status.warEligible && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', borderRadius: '10px', fontWeight: 700 }}>WAR-INELIGIBLE</span>}
                                {status.eligibleForElderRestoration && <span style={{ fontSize: '0.62rem', padding: '2px 8px', background: 'rgba(34,197,94,0.12)', color: 'var(--color-cta)', borderRadius: '10px', fontWeight: 700 }}>RESTORE ELDER</span>}
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                              {dos.strikes.map(s => {
                                const active = new Date(expiryOf(s.issued_at)).getTime() > now.getTime();
                                return (
                                  <div key={s.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${!active ? 'var(--color-muted)' : s.leadership_approved ? 'var(--color-cta)' : 'var(--color-warning)'}`, opacity: active ? 1 : 0.65 }}>
                                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                       <span style={{ fontWeight: '600' }}>{s.rule?.name || 'General strike'}</span>
                                       <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                         <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 700, background: active ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--color-warning)' : 'var(--color-muted)' }}>{active ? 'ACTIVE' : 'EXPIRED'}</span>
                                         <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(s.issued_at).toLocaleDateString()}</span>
                                       </span>
                                     </div>
                                     {(s.strike_violations || []).length > 0 && (
                                       <ul style={{ margin: '8px 0', paddingLeft: '1.1rem', fontSize: '0.82rem', lineHeight: 1.5 }}>
                                         {s.strike_violations!.map(v => <li key={v.id}>{v.description}</li>)}
                                       </ul>
                                     )}
                                     <div style={{ fontSize: '0.7rem' }} className="text-muted">
                                       Logged by {loggerNames[s.logged_by] || s.logged_by} • expires {new Date(expiryOf(s.issued_at)).toLocaleDateString()}
                                       {s.leadership_approved ? ' • trust restored' : ''}
                                       {s.removal_at ? ' • marked removed' : ''}
                                     </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
               </div>
             );
           })()}

           {/* Activity History */}
           <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <History size={20} color="var(--color-cta)" />
                <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Leadership Activity</h2>
              </div>
              {person.activity_logs.length === 0 ? (
                <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No related activity logs.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {person.activity_logs.map(log => (
                    <div key={log.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                         <span style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.7rem', color: 'var(--color-cta)' }}>{log.category}</span>
                         <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(log.logged_at).toLocaleDateString()}</span>
                       </div>
                       <p style={{ fontSize: '0.85rem', margin: '4px 0' }}>{log.description}</p>
                    </div>
                  ))}
                </div>
              )}
           </div>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        onConfirm={handleRemovePlayer}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isLoading={removing}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
