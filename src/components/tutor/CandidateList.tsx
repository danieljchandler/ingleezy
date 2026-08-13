import { CandidateCard, type CandidateData } from "./CandidateCard";

interface CandidateListProps {
  candidates: CandidateData[];
  audioUrl: string | null;
  onUpdate: (id: string, updates: Partial<CandidateData>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function CandidateList({ candidates, audioUrl, onUpdate, onApprove, onReject }: CandidateListProps) {
  const pending = candidates.filter(c => c.status === "pending");
  const approved = candidates.filter(c => c.status === "approved");
  const rejected = candidates.filter(c => c.status === "rejected");

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{candidates.length} candidates</span>
        <span>·</span>
        <span className="text-primary font-medium">{approved.length} approved</span>
        <span>·</span>
        <span>{rejected.length} rejected</span>
        <span>·</span>
        <span>{pending.length} pending</span>
      </div>

      {/* Pending first */}
      {pending.map(c => (
        <CandidateCard
          key={c.id}
          candidate={c}
          audioUrl={audioUrl}
          onUpdate={onUpdate}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}

      {/* Approved */}
      {approved.length > 0 && pending.length > 0 && (
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-2">Approved</div>
      )}
      {approved.map(c => (
        <CandidateCard
          key={c.id}
          candidate={c}
          audioUrl={audioUrl}
          onUpdate={onUpdate}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}

      {/* Rejected */}
      {rejected.length > 0 && (
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-2">Rejected</div>
      )}
      {rejected.map(c => (
        <CandidateCard
          key={c.id}
          candidate={c}
          audioUrl={audioUrl}
          onUpdate={onUpdate}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </div>
  );
}
