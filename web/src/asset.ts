/**
 * Prefixes a public file with the path the app is served from.
 *
 * The site lives under /brick-like-this-online/ rather than at the root of the
 * domain, so a bare "/logo.png" points a level above the app and misses. Vite
 * rewrites the absolute URLs it can see — in index.html and in stylesheets —
 * but a path written as a string in TypeScript is only a string to it, so
 * those come through here instead.
 *
 * BASE_URL is whatever `base` is set to in the Vite config and always ends in
 * a slash, hence stripping the leading one off the argument. It is "/" when the
 * app is served from the root, which leaves these paths exactly as they were.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
