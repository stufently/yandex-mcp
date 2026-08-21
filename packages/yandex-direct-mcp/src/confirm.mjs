/**
 * Explicit confirmation for the irreversible tools in this server.
 *
 * Direct is the one package where a mistaken tool call spends real money. Three
 * families of tools cannot be undone through the API they are called with:
 *
 *   delete_*  — the entity and the statistics attached to it are gone; `add_*`
 *               creates a new entity with a new ID, not the old one back.
 *   update_*  — fields are overwritten in place. Direct exposes no revision
 *               history, so the previous ad text, budget or strategy is simply
 *               unrecoverable once the call succeeds.
 *   set_*     — bids and bid modifiers, i.e. the numbers that decide what the
 *               account spends per click. Same overwrite, with a price tag.
 *
 * Suspend/resume, archive/unarchive and add_* are deliberately NOT here: each
 * has an inverse tool in this same server that puts the account back the way it
 * was, so they are changes, not losses.
 *
 * As in Metrika's `delete-counter`, the refusal is decided before any request is
 * built, so a mistaken call costs nothing — no entity touched, no bid moved, no
 * API units burned.
 *
 * The shape here deliberately mirrors `yandex-metrika-mcp/src/confirm.mjs`.
 * The packages are published to npm separately and ship only their own
 * `src/*.mjs`, so they cannot import from one another — a shared module would
 * simply be missing from the tarball at runtime. What is shared is the rule,
 * and it is spelled out in each package rather than smuggled across a boundary
 * the published packages do not have.
 */

/** Description of the `confirm` parameter, shown to the model in the tool schema. */
export const CONFIRM_PARAM_DESCRIPTION =
  'Must be exactly true to actually apply this change. Omit it (or pass false) and the tool refuses without calling the Direct API.';

/**
 * True only for a literal boolean `true`.
 *
 * Deliberately strict: a string `"true"`, `1` or `"yes"` is someone guessing at
 * the protocol rather than confirming an irreversible change to a live
 * advertising account, and acting on a guess is exactly the failure this module
 * exists to prevent.
 *
 * @param {unknown} confirm
 * @returns {boolean}
 */
export function isConfirmed(confirm) {
  return confirm === true;
}

/**
 * Short, safe description of what a call would have hit.
 *
 * Never throws: it runs on the refusal path, where the arguments may well be
 * malformed — that is one of the reasons the call is being refused.
 *
 * @param {unknown} ids
 * @returns {string}
 */
export function describeIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return '(no IDs given)';
  const shown = ids.slice(0, 10).join(', ');
  return ids.length > 10 ? `${ids.length} IDs: ${shown}, …` : `IDs: ${shown}`;
}

/**
 * Same, for the tools that take their payload as a JSON string.
 *
 * @param {unknown} json raw `items_json` / `bids_json` / `modifiers_json`
 * @returns {string}
 */
export function describeItems(json) {
  if (typeof json !== 'string' || json.trim() === '') return '(no items given)';
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return '(items_json is not valid JSON)';
  }
  if (!Array.isArray(parsed)) return '(items are not a JSON array)';
  if (parsed.length === 0) return '(empty item list)';
  const ids = parsed
    .map((item) => item?.Id ?? item?.KeywordId ?? item?.CampaignId ?? item?.AdGroupId)
    .filter((id) => id !== undefined && id !== null);
  const idPart = ids.length > 0 ? ` (${describeIds(ids)})` : '';
  return `${parsed.length} item${parsed.length === 1 ? '' : 's'}${idPart}`;
}

/**
 * The text the model sees when it calls a guarded tool without confirmation.
 *
 * It names the tool and the target, states why the change cannot be taken back,
 * says plainly that nothing was sent, and spells out the exact call that would
 * proceed — a refusal that does not say how to comply just gets retried blindly.
 *
 * @param {object} spec
 * @param {string} spec.tool tool name, e.g. `delete_campaigns`
 * @param {string} spec.target what the call would have hit, from describeIds/describeItems
 * @param {string} spec.consequence one sentence on why this cannot be undone
 * @param {string} spec.repeat the arguments to repeat, e.g. `the same ids`
 * @param {string} [spec.inspect] read-only tool that shows the current state first
 * @returns {string}
 */
export function destructiveRefusal({ tool, target, consequence, repeat, inspect }) {
  const lines = [
    `Refused: \`${tool}\` requires explicit confirmation.`,
    '',
    `Target — ${target}. ${consequence}`,
    '',
    'Nothing was sent to the Yandex Direct API — no campaign, ad, keyword or bid was touched,' +
      ' and no API units were spent.',
    '',
    `To go ahead, call \`${tool}\` again with ${repeat} and \`confirm: true\`.`,
  ];
  if (inspect) lines.push(`To see the current state first, call \`${inspect}\`.`);
  return lines.join('\n');
}

/**
 * Wrap a tool handler so it refuses unless `confirm: true` was passed.
 *
 * `perform` is injected rather than called directly so the refusal path can be
 * tested for what matters most: that it never reaches the network.
 *
 * @param {object} spec see {@link destructiveRefusal}; `target` is a function of the arguments
 * @param {string} spec.tool
 * @param {(args: Record<string, unknown>) => string} spec.target
 * @param {string} spec.consequence
 * @param {string} spec.repeat
 * @param {string} [spec.inspect]
 * @param {(args: Record<string, unknown>) => Promise<unknown>} perform
 */
export function requireConfirmation(spec, perform) {
  return async (args) => {
    const params = args ?? {};
    if (!isConfirmed(params.confirm)) {
      return {
        content: [
          {
            type: 'text',
            text: destructiveRefusal({ ...spec, target: spec.target(params) }),
          },
        ],
        isError: true,
      };
    }
    return perform(params);
  };
}

/**
 * MCP annotations every guarded tool in this package carries.
 *
 * The client sees the risk before the call, instead of having to read it out of
 * the description — which is precisely the guard that failed for `delete-counter`.
 *
 * @param {string} title
 */
export function destructiveAnnotations(title) {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };
}
