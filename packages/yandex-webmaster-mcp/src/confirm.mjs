/**
 * Explicit confirmation for the irreversible tool in this server.
 *
 * `delete-host` had nothing standing between a mistaken tool call and a site
 * disappearing from Webmaster: no confirmation, and — unlike Metrika's
 * `delete-counter` — not even the word "irreversible" in its description. The
 * token this server asks for is a single Webmaster scope that grants reads and
 * writes together, so there is no accidental 403 to fall back on either.
 *
 * The check is therefore explicit: the tool refuses unless the caller passes
 * `confirm: true`, and the refusal is decided before the request is built, so a
 * mistaken call costs nothing and touches no host.
 *
 * The shape here deliberately mirrors `yandex-metrika-mcp/src/confirm.mjs`.
 * The packages are published to npm separately and ship only their own
 * `src/*.mjs`, so they cannot import from one another — a shared module would
 * simply be missing from the tarball at runtime. What is shared is the rule,
 * and it is spelled out in both places rather than smuggled across a boundary
 * the published packages do not have.
 */

/** Description of the `confirm` parameter, shown to the model in the tool schema. */
export const CONFIRM_PARAM_DESCRIPTION =
  'Must be exactly true to actually delete. Omit it (or pass false) and the tool refuses without calling the Webmaster API.';

/**
 * True only for a literal boolean `true`.
 *
 * Deliberately strict: a string `"true"`, `1` or `"yes"` is someone guessing at
 * the protocol rather than confirming a deletion, and deleting on a guess is
 * exactly the failure this module exists to prevent.
 *
 * @param {unknown} confirm
 * @returns {boolean}
 */
export function isConfirmed(confirm) {
  return confirm === true;
}

/**
 * The text the model sees when it calls `delete-host` without confirmation.
 *
 * It names the host, says plainly that nothing happened, and spells out the
 * exact call that would proceed — a refusal that does not say how to comply
 * just gets retried blindly.
 *
 * @param {string|undefined|null} hostId
 * @returns {string}
 */
export function deleteHostRefusal(hostId) {
  const id = hostId === undefined || hostId === null || hostId === '' ? '(none given)' : hostId;
  return [
    'Refused: `delete-host` requires explicit confirmation.',
    '',
    `Removing host ${id} from Yandex Webmaster is irreversible — the site's verification, its accumulated` +
      ' indexing and search-query history, and its sitemap and important-URL settings go with it. Adding the same' +
      ' site back creates a fresh host that must be verified again and starts with no history.',
    '',
    'Nothing was sent to the Webmaster API — no host was touched.',
    '',
    `To go ahead, call \`delete-host\` again with host_id ${id} and \`confirm: true\`.` +
      ' To check which site this host ID stands for first, call `get-host-info` or `list-hosts`.',
  ].join('\n');
}

/**
 * Build the `delete-host` handler around whatever performs the DELETE.
 *
 * The deletion function is injected so the refusal path can be tested for what
 * matters most: that it never reaches the network.
 *
 * @param {(hostId: string) => Promise<unknown>} deleteHost
 */
export function createDeleteHostHandler(deleteHost) {
  return async ({ host_id, confirm }) => {
    if (!isConfirmed(confirm)) {
      return {
        content: [{ type: 'text', text: deleteHostRefusal(host_id) }],
        isError: true,
      };
    }
    const data = await deleteHost(host_id);
    const result = { content: [{ type: 'text', text: `Host ${host_id} deleted.` }] };
    // The DELETE answers 204 with an empty body, so there is usually nothing
    // structured to hand back; only attach it when the API actually said something.
    if (data !== undefined && data !== null) result.structuredContent = data;
    return result;
  };
}
