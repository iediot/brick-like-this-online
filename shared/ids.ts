/**
 * Identifiers for stored records.
 *
 * `crypto.randomUUID` is only defined in a secure context, which HTTPS and
 * localhost both are — but a phone opening the site by LAN address over plain
 * HTTP is not, and there it is simply missing. That is a strange way for team
 * setup to fail, so fall back to a random string of the same shape. Nothing
 * here is a secret; these only have to be distinct.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Version 4, variant 1 — the bits that make it a well-formed UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
