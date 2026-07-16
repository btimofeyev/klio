"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";

export function AdjustmentHistoryAction({ proposalId, status, undoStatus }: { proposalId: string; status: string; undoStatus: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "undone" || undoStatus === "undone") return <b><Check size={12} />Undone</b>;
  if (status !== "applied" || undoStatus !== "available") return <b>Applied</b>;

  async function undo() {
    setWorking(true);
    setError(null);
    const response = await fetch(`/api/adjustments/${proposalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "undo" }),
    });
    const result = await response.json() as { error?: string };
    setWorking(false);
    if (!response.ok) return setError(result.error ?? "This change can no longer be undone safely.");
    router.refresh();
  }

  return <span className="activity-adjustment-action">
    <button type="button" onClick={() => void undo()} disabled={working}><RotateCcw size={12} />{working ? "Undoing…" : "Undo change"}</button>
    {error ? <small role="alert">{error}</small> : null}
  </span>;
}
