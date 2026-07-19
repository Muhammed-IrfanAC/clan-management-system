'use client';

import {
  Route,
  CheckCircle,
  Circle,
  X,
  Baby,
  RotateCcw,
  MinusCircle,
  MessageCircle,
  ClipboardCheck,
  Link as LinkIcon,
  UserPlus,
  Flag,
  Send,
  ArrowUpCircle,
} from 'lucide-react';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';
import { PIPELINE, deriveOnboardingStatus, MAX_ENGAGEMENT_ATTEMPTS } from '@/lib/onboarding';
import type { OnboardingEvent } from '@/types/database';

// Maps the icon-name strings declared in the onboarding PIPELINE to lucide components,
// keeping the pipeline definition (src/lib/onboarding.ts) free of React imports.
const STEP_ICONS: Record<string, any> = {
  MessageCircle, ClipboardCheck, LinkIcon, UserPlus, Flag, Send, CheckCircle, ArrowUpCircle,
};

const ONBOARDING_RETENTION_DAYS = 30;

// Onboarding timeline — a single inline checklist. Each row is either done (who/when) or pending
// with its own action button. Recording is allowed regardless of baby / graduated status, so a
// leader can backfill even after sync auto-promoted the member. The card lingers for
// ONBOARDING_RETENTION_DAYS after graduation, then retires to keep permanent-member profiles clean.
export default function OnboardingTimeline() {
  const person = useMemberDossierStore((s) => s.person);
  const familyClans = useMemberDossierStore((s) => s.familyClans);
  const loggerNames = useMemberDossierStore((s) => s.loggerNames);
  const currentUserTag = useMemberDossierStore((s) => s.currentUserTag);
  const recordingEvent = useMemberDossierStore((s) => s.recordingEvent);
  const deletingEvent = useMemberDossierStore((s) => s.deletingEvent);
  const recordOnboardingEvent = useMemberDossierStore((s) => s.recordOnboardingEvent);
  const deleteOnboardingEvent = useMemberDossierStore((s) => s.deleteOnboardingEvent);
  const isAuthoredByMe = useMemberDossierStore((s) => s.isAuthoredByMe);

  if (!person) return null;

  const events = [...(person.onboarding_events || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const status = deriveOnboardingStatus(events);

  // Show the card for members with an onboarding lifecycle — babies, or anyone with recorded events.
  // Legacy permanent members (no events) stay clean. After graduation, keep the card for a 30-day
  // backfill window measured from the promoted_elder event, then retire it.
  const promotedAt = events.find((e) => e.event_type === 'promoted_elder')?.created_at;
  const retired =
    !!promotedAt && Date.now() - new Date(promotedAt).getTime() > ONBOARDING_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!person.is_baby && (events.length === 0 || retired)) return null;

  // Clan assignment only becomes relevant once additional accounts have been registered.
  const hasAdditional = events.some((e) => e.event_type === 'additional_account_registered');
  // "No Discord" waiver: skips both Discord steps rather than leaving them pending.
  const waiveEvent = events.find((e) => e.event_type === 'discord_waived') || null;
  const discordWaived = !!waiveEvent;
  const clanName = (cid: string | null) => familyClans.find((c) => c.id === cid)?.display_name || 'clan';
  const canRemove = (ev: OnboardingEvent) =>
    !ev.id.startsWith('temp-') && // still saving — not yet removable
    ev.event_type !== 'promoted_elder' &&
    isAuthoredByMe(ev.actor_tag);
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
            {familyClans.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
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
        {PIPELINE.map((step) => {
          // Interlink: hide clan assignment until additional accounts exist.
          if (step.key === 'assignment' && !hasAdditional) return null;

          const stepEvents = events.filter((e) => step.eventTypes.includes(e.event_type));
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

          // Right-hand slot: keep it consistent — pending shows the action, done shows Undo (in the
          // SAME place), so marking a step never makes its control disappear. Engagement renders its
          // attempts as pills below the label, so its header slot stays empty.
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
                  /* Attempts as filled pills (tap to clear) + a segmented picker for the next attempt.
                     Clearing a pill drops below 3, so 'concluded' is never a dead end. */
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                    {stepEvents.map((ev) => attemptPill(ev))}
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
}
