export function streamedTerminalMessage(text: string, current = "") {
  const match = /"message"\s*:\s*"/.exec(text);
  if (!match) return current;

  let encoded = "";
  let escaped = false;
  for (let index = match.index + match[0].length; index < text.length; index += 1) {
    const character = text[index]!;
    if (escaped) {
      encoded += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') return decodeJsonString(encoded) ?? current;
    encoded += character;
  }

  // A trailing escape or incomplete unicode sequence is not safe to display
  // until the provider sends the rest of that JSON string.
  if (escaped) return current;
  return decodeJsonString(encoded) ?? current;
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return null;
  }
}
