/** DiceBear HTTP API — keep version in one place for upgrades. */
const DICEBEAR_AVATAAARS =
  'https://api.dicebear.com/9.x/avataaars/svg';

/**
 * Stable avatar URL from a seed (display name or email local-part).
 * Encodes the seed so characters like & ? # do not break the query string.
 */
export function buildDicebearAvatarUrl(seed) {
  const s = String(seed ?? 'user').trim() || 'user';
  return `${DICEBEAR_AVATAAARS}?seed=${encodeURIComponent(s)}`;
}

export function emailLocalPart(email) {
  if (!email || typeof email !== 'string') return 'user';
  const local = email.split('@')[0];
  return local && local.trim() ? local.trim() : 'user';
}
