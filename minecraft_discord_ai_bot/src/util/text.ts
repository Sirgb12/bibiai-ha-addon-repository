export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const splitDiscordText = (text: string, maxLength = 1900): string[] => {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const breakpoint = Math.max(
      remaining.lastIndexOf("\n", maxLength),
      remaining.lastIndexOf(". ", maxLength),
      remaining.lastIndexOf(" ", maxLength)
    );
    const cutAt = breakpoint > 200 ? breakpoint + 1 : maxLength;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

export const codeBlock = (text: string, language = ""): string => {
  const safeText = text.replaceAll("```", "`\u200b``");
  return `\`\`\`${language}\n${safeText}\n\`\`\``;
};
