type TurnCandidate = { status: string; conversation_id: string | null };

export function selectLatestWorkspaceTurn<T extends TurnCandidate, U extends TurnCandidate>(latest: T | null, latestConversationTurn: U | null): T | U | null {
  if (latest && (["queued", "running", "awaiting_parent", "failed"].includes(latest.status) || latest.conversation_id === null)) return latest;
  return latestConversationTurn ?? latest;
}
