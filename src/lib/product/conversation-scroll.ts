export function completedConversationScrollTarget(input: {
  scrollHeight: number;
  clientHeight: number;
  latestOffsetTop: number;
  latestHeight: number;
}) {
  const longAnswer = input.latestHeight > input.clientHeight * .72;
  return longAnswer ? Math.max(0, input.latestOffsetTop - 12) : input.scrollHeight;
}
