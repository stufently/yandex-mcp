/**
 * Yandex OAuth scopes for the Metrika API.
 *
 * The server exposes both read tools and write tools (`create-counter`,
 * `delete-counter`). A token minted with only `metrika:read` cannot run the
 * write tools: Yandex rejects them with HTTP 403 at the moment of use, long
 * after the user believed setup was finished. So the auth helper asks for the
 * write scope too, and the user can narrow it back down deliberately.
 */

export const READ_SCOPE = 'metrika:read';
export const WRITE_SCOPE = 'metrika:write';

/** Scopes requested by `index.mjs auth` unless YANDEX_METRIKA_SCOPE overrides them. */
export const DEFAULT_SCOPES = [READ_SCOPE, WRITE_SCOPE];

/** Tools that Yandex refuses without WRITE_SCOPE. */
export const WRITE_TOOLS = ['create-counter', 'delete-counter'];

/**
 * Normalize a scope override into a deduplicated, space-separated string.
 *
 * Accepts space- or comma-separated input so that both `metrika:read
 * metrika:write` and `metrika:read,metrika:write` work. Empty/blank input falls
 * back to DEFAULT_SCOPES rather than requesting an empty scope, which Yandex
 * would silently widen to the app's full registered set.
 *
 * @param {string|undefined|null} raw
 * @returns {string}
 */
export function resolveScopes(raw) {
  const parts = String(raw ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const chosen = parts.length > 0 ? parts : DEFAULT_SCOPES;
  return [...new Set(chosen)].join(' ');
}

/**
 * True when the granted scope string is missing the write scope.
 * @param {string} scopes
 */
export function isReadOnly(scopes) {
  return !resolveScopes(scopes).split(' ').includes(WRITE_SCOPE);
}

/**
 * Extra guidance appended to a 403 so the cause is obvious.
 *
 * Yandex answers a scope problem and a genuine permission problem with the same
 * status, so this names both possibilities instead of asserting one.
 *
 * @param {number} status
 * @returns {string}
 */
export function scopeHint(status) {
  if (status !== 403) return '';
  return (
    ` This usually means the token lacks the \`${WRITE_SCOPE}\` scope` +
    ` (tools: ${WRITE_TOOLS.join(', ')}) — re-run the \`auth\` command to mint a token with it,` +
    ' or check that the account actually owns this counter.'
  );
}
