/**
 * Transient Yandex Direct API error codes.
 *
 * Direct signals these with HTTP 200 and an `error` object in the body, so a
 * status-based retry never sees them — they have to be retried by the JSON-RPC
 * caller instead.
 *
 *   52   — the OAuth server did not respond
 *   1000 — internal server error
 *   1001 — service temporarily unavailable
 *   1002 — service temporarily unavailable, try again later
 *
 * All four say the call failed, none says whether it was applied first.
 */
export const RETRYABLE_ERROR_CODES = new Set([52, 1000, 1001, 1002]);

/**
 * @param {unknown} errorCode value of `error.error_code` from a Direct response
 * @returns {boolean}
 */
export function isRetryableDirectError(errorCode) {
  const code = Number(errorCode);
  return Number.isInteger(code) && RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Whether a Direct method may be replayed after an AMBIGUOUS failure.
 *
 * Only read methods may. A transient error tells us the call did not succeed,
 * not that the server declined to act — a failed `campaigns.add` may well have
 * created the campaign before the connection broke. Direct offers no
 * idempotency key, so replaying a mutating call risks duplicate campaigns, ads,
 * or bid changes in a live account. A failed write is reported to the caller
 * instead, which is recoverable; a silently duplicated one is not.
 *
 * An unambiguous rejection (HTTP 429) is replayed regardless — see apiRequest.
 *
 * @param {string} method JSON-RPC method name, e.g. "get" or "add"
 * @returns {boolean}
 */
export function isRetrySafeMethod(method) {
  return typeof method === 'string' && /^get([A-Z]|$)/.test(method);
}

/**
 * Human-readable message for a Direct error object.
 * @param {{error_code?: unknown, error_string?: string, error_detail?: string, request_id?: string}} e
 * @returns {string}
 */
export function formatDirectError(e) {
  const detail = e.error_detail ? ` ${e.error_detail}` : '';
  return (
    `Yandex Direct API error ${e.error_code}: ${e.error_string}.${detail}` + ` (request_id: ${e.request_id || 'N/A'})`
  );
}
