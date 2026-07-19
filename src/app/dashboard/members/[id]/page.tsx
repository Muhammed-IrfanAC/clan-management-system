'use client';

import { useState, useEffect, use } from 'react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemberDossierStore } from '@/lib/stores/memberDossierStore';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import Toast from '@/components/ui/Toast';
import PersonCard from '@/components/members/dossier/PersonCard';
import OnboardingTimeline from '@/components/members/dossier/OnboardingTimeline';
import MemberNotes from '@/components/members/dossier/MemberNotes';
import StrikeHistory from '@/components/members/dossier/StrikeHistory';
import ActivityHistory from '@/components/members/dossier/ActivityHistory';

export default function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const loading = useMemberDossierStore((s) => s.loading);
  const person = useMemberDossierStore((s) => s.person);
  const toast = useMemberDossierStore((s) => s.toast);
  const setToast = useMemberDossierStore((s) => s.setToast);
  const removing = useMemberDossierStore((s) => s.removing);
  const fetchPerson = useMemberDossierStore((s) => s.fetchPerson);
  const loadIdentity = useMemberDossierStore((s) => s.loadIdentity);
  const loadFamilyClans = useMemberDossierStore((s) => s.loadFamilyClans);
  const removePlayer = useMemberDossierStore((s) => s.removePlayer);
  const unlinkPlayer = useMemberDossierStore((s) => s.unlinkPlayer);

  // Confirm-delete modal is UI-local: the trigger lives in PersonCard, the modal renders here.
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, tag: '', title: '', message: '' });

  useEffect(() => {
    fetchPerson(id);
  }, [id, fetchPerson]);

  useEffect(() => {
    loadIdentity();
    loadFamilyClans();
  }, [loadIdentity, loadFamilyClans]);

  async function handleRemovePlayer() {
    const { ok, navigateAway } = await removePlayer(confirmConfig.tag);
    if (!ok) return;
    setConfirmConfig((c) => ({ ...c, isOpen: false }));
    if (navigateAway) router.push('/dashboard/members');
  }

  async function handleUnlink(tag: string) {
    const { ok, navigateAway } = await unlinkPlayer(tag);
    if (ok && navigateAway) router.push('/dashboard/members');
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
          <PersonCard
            onRequestRemove={(tag, inGameName) =>
              setConfirmConfig({ isOpen: true, tag, title: 'Remove Account', message: `Permanently delete ${inGameName} from registry?` })
            }
            onUnlink={handleUnlink}
          />
        </div>

        {/* Right Column: History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          <OnboardingTimeline />
          <MemberNotes />
          <StrikeHistory />
          <ActivityHistory />
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((c) => ({ ...c, isOpen: false }))}
        onConfirm={handleRemovePlayer}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isLoading={removing}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
