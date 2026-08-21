/**
 * Explicit confirmation for the one irreversible tool in this server.
 *
 * `delete-counter` used to be guarded by two things, only one of them on
 * purpose: the word "Irreversible" in its description, and — by accident — the
 * 403 that a `metrika:read` token produced. The default OAuth scope now asks
 * for `metrika:write` as well, so that setup succeeds the first time instead of
 * failing much later at the moment of use. That removed the accidental guard,
 * and a description a model may or may not read is not a guard at all.
 *
 * So the check is explicit here: the tool refuses unless the caller passes
 * `confirm: true`, and the refusal is decided before any request is built, so a
 * mistaken call costs nothing and touches no counter.
 */

/** Description of the `confirm` parameter, shown to the model in the tool schema. */
export const CONFIRM_PARAM_DESCRIPTION =
  'Must be exactly true to actually delete. Omit it (or pass false) and the tool refuses without calling the Metrika API.';

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
 * The text the model sees when it calls `delete-counter` without confirmation.
 *
 * It names the counter, says plainly that nothing happened, and spells out the
 * exact call that would proceed — a refusal that does not say how to comply
 * just gets retried blindly.
 *
 * @param {number|string|undefined|null} counterId
 * @returns {string}
 */
export function deleteCounterRefusal(counterId) {
  const id = counterId === undefined || counterId === null || counterId === '' ? '(none given)' : counterId;
  return [
    'Refused: `delete-counter` requires explicit confirmation.',
    '',
    `Deleting counter ${id} is irreversible — the counter and every statistic it has collected are gone for good.` +
      ' Yandex cannot restore them, and creating a new counter for the same site does not bring the history back.',
    '',
    'Nothing was sent to the Metrika API — no counter was touched.',
    '',
    `To go ahead, call \`delete-counter\` again with counter_id ${id} and \`confirm: true\`.` +
      ' To check which site this counter belongs to first, call `get-counter`.',
  ].join('\n');
}

/**
 * Build the `delete-counter` handler around whatever performs the DELETE.
 *
 * The deletion function is injected so the refusal path can be tested for what
 * matters most: that it never reaches the network.
 *
 * @param {(counterId: number) => Promise<unknown>} deleteCounter
 */
export function createDeleteCounterHandler(deleteCounter) {
  return async ({ counter_id, confirm }) => {
    if (!isConfirmed(confirm)) {
      return {
        content: [{ type: 'text', text: deleteCounterRefusal(counter_id) }],
        isError: true,
      };
    }
    const data = await deleteCounter(counter_id);
    return {
      content: [{ type: 'text', text: `Counter ${counter_id} deleted successfully.` }],
      structuredContent: data,
    };
  };
}
