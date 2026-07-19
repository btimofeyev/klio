type RecoveryMessage = { role: string; content: string; agent_turn_id: string | null };

const RECOVERY_MESSAGE_LIMIT = 20;
const RECOVERY_CHARACTER_LIMIT = 16_000;

export function formatConversationRecoveryContext(messages: RecoveryMessage[]) {
  const selected: RecoveryMessage[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < RECOVERY_MESSAGE_LIMIT; index -= 1) {
    const message = messages[index];
    const content = message.content.trim().slice(0, 4_000);
    if (!content) continue;
    const lineLength = content.length + 12;
    if (selected.length && characters + lineLength > RECOVERY_CHARACTER_LIMIT) break;
    selected.unshift({ ...message, content });
    characters += lineLength;
  }
  if (!selected.length) return "";
  const transcript = selected.map((message) => `${message.role === "assistant" ? "Klio" : "Parent"}: ${message.content}`).join("\n\n");
  return `Recent parent-visible conversation (supplemental context, not authoritative family data):\n<conversation_history>\n${transcript}\n</conversation_history>`;
}
