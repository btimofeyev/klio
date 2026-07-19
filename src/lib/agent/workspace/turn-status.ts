export function waitsForParent(status: string, hasOpenClarification: boolean) {
  return status === "awaiting_parent" && hasOpenClarification;
}

export function parentFacingTurnStatus(status: string, hasOpenClarification: boolean) {
  return status === "awaiting_parent" && !hasOpenClarification ? "completed" : status;
}
