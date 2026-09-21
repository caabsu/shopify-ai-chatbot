import { DraftQuality } from '@/components/tickets/DraftQuality';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { AutopilotPlan } from '@/lib/types';

export function QualityEvidence({ plan }: { plan: AutopilotPlan }) {
  const quality = plan.analysis.quality_assessment;
  return <><h3 className="os-section-heading">Independent quality pass</h3>{quality ? <><DraftQuality review={quality.jev} /><p className="os-message-content">{quality.summary}</p>{quality.checks.map((check, index) => <div className="os-evidence-row" key={`${check.name}-${index}`}>{check.passed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<div><strong>{check.name.replace(/_/g, ' ')}</strong><p>{check.detail}</p></div></div>)}<p className="mt-3 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{quality.model || 'Verifier unavailable'} · {new Date(quality.checked_at).toLocaleString()}</p></> : <div className="os-notice">This earlier draft has not passed the new independent verification. It remains available for manual review.</div>}</>;
}
