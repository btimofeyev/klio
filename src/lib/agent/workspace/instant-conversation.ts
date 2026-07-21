const greetingPattern = /^(?:(?:hello|hi|hey|hiya|howdy)(?:\s+there)?|good\s+(?:morning|afternoon|evening))[!.?\s]*$/i;
const thanksPattern = /^(?:thanks|thank\s+you|many\s+thanks|thanks\s+(?:a\s+lot|so\s+much))[!.?\s]*$/i;
const identityPattern = /^(?:who|what)\s+are\s+you[?.!\s]*$/i;
const capabilityPattern = /^(?:(?:what|how)\s+can\s+you\s+(?:do|help)|help|what\s+do\s+you\s+do)[?.!\s]*$/i;
const wellbeingPattern = /^(?:how\s+are\s+you|how(?:'|’)s\s+it\s+going)[?.!\s]*$/i;

/**
 * Resolve only context-free social messages here. Anything that could refer
 * to family records or request a mutation must continue through the bounded
 * workspace agent.
 */
export function instantConversationReply(request: string) {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 120) return null;
  if (greetingPattern.test(normalized)) return "Hello! What would you like help with today?";
  if (thanksPattern.test(normalized)) return "You’re welcome. I’m here whenever you’re ready.";
  if (identityPattern.test(normalized)) return "I’m Klio, your family’s homeschool workspace assistant.";
  if (capabilityPattern.test(normalized)) return "I can help organize the week, work with lessons and practice, review learning records, and answer questions about your family workspace.";
  if (wellbeingPattern.test(normalized)) return "I’m ready to help. What would you like to work on?";
  return null;
}
