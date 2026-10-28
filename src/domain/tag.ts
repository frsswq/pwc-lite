const tagPattern = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N}._-]{0,63}$/u;

/** Normalizes a tag to lower case, or returns null when it is not a valid tag. */
export const parseTag = (text: string): string | null => {
  const tag = text.trim().toLowerCase();

  return tagPattern.test(tag) ? tag : null;
};
