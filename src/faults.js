/**
 * Deterministic fault injection for the failure-boundary tests of roadmap
 * Horizon 2 item 3, whose exit criterion is that no partial receipt and no
 * unsafe ref survives an interrupted operation.
 *
 * A real interruption is a kill: the process stops between two Git mutations
 * with no unwinding, no `finally`, and no chance to tidy up. Testing that with
 * a signal and a sleep is flaky and proves nothing repeatable, so the
 * publication path names the points where an interruption would be most
 * damaging and this module turns one of them into a hard exit when the
 * environment asks for it.
 *
 * `process.exit` is deliberate rather than a thrown error: throwing would run
 * cleanup the real failure would not, and the whole question is what the
 * repository looks like when cleanup never happened.
 *
 * The hook costs one environment read per named point and is inert unless
 * `VLAB_TEST_FAULT` names that point exactly, so it cannot fire in ordinary
 * use. It is test-only scaffolding in the same spirit as the session-failure
 * switches in `src/git.js`.
 */

/** Exit code used when a fault point fires, distinct from any CliError code. */
export const FAULT_EXIT_CODE = 70;

/**
 * Stop the process here if `VLAB_TEST_FAULT` names this point. Call sites read
 * as a statement of where an interruption is survivable, so keep the names
 * stable: the tests reference them.
 */
export function faultPoint(name) {
  if (process.env.VLAB_TEST_FAULT === name) {
    process.stderr.write(`vlab: fault injected at ${name}\n`);
    process.exit(FAULT_EXIT_CODE);
  }
}
