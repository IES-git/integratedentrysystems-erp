/**
 * Full-page host for the spec-driven "Custom" opening builder.
 *
 * Renders the same SpecOpeningBuilder used by the Openings step, but as a full
 * page instead of a modal dialog. The estimate is created lazily on first save
 * (mirroring the template NewOpeningPage flow) so abandoning the page leaves no
 * orphan estimate record.
 */
import { useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SpecOpeningBuilder } from '@/components/estimates/wizard/SpecOpeningBuilder';
import { createManualEstimate } from '@/lib/estimates-api';
import { supabase } from '@/lib/supabase';

export default function SpecOpeningPage() {
  // estimateId may come from the URL (existing estimate) or be absent (brand-new
  // estimate); when absent it is created lazily inside resolveEstimateId.
  const { estimateId: estimateIdParam } = useParams<{ estimateId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const estimateId = estimateIdParam ?? null;
  const openingCount = parseInt(searchParams.get('count') ?? '0', 10);

  // The builder fires onSaved AND onOpenChange(false) on a successful save. This
  // flag lets onOpenChange skip its own navigation so the post-save redirect
  // (which carries the lazily-created estimate id) is not clobbered.
  const savedRef = useRef(false);

  const backUrl = useCallback(
    (id: string | null) =>
      id ? `/app/estimates/create?id=${id}&step=1` : '/app/estimates/create?step=1',
    [],
  );

  // Lazily create the estimate on first save so navigating away without saving
  // leaves no orphan record in the database.
  const resolveEstimateId = useCallback(async (): Promise<string | null> => {
    if (estimateId) return estimateId;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/login'); return null; }
    const { estimateId: newId } = await createManualEstimate(user.id);
    return newId;
  }, [estimateId, navigate]);

  return (
    <SpecOpeningBuilder
      mode="page"
      open
      estimateId={estimateId}
      resolveEstimateId={estimateId ? undefined : resolveEstimateId}
      openingCount={Number.isFinite(openingCount) ? openingCount : 0}
      onOpenChange={(next) => {
        // Called with `false` for Cancel/Back, and again right after onSaved.
        // Skip the redirect once a save has already navigated us back.
        if (!next && !savedRef.current) navigate(backUrl(estimateId));
      }}
      onSaved={(opening) => {
        savedRef.current = true;
        navigate(backUrl(opening.estimateId ?? estimateId));
      }}
    />
  );
}
