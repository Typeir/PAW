/**
 * PAW Daemon Run Reporting
 *
 * @fileoverview Turns a real dispatch into what the console shows. Core's
 * `dispatchSwarm` reports each member as `done` or `skipped` and throws away the
 * model's usage on the way out, so token counts are gathered here by metering
 * the port the run actually calls — the console's spend meter is then a count of
 * what was really sent and received, not an estimate. Nothing is invented: a
 * plan the doctor refused reports zero members and `released: false` upstream,
 * and `spendUsd` stays zero because no price list crosses this boundary.
 *
 * @module @paw/daemon/run
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DispatchResult,
  MemberView,
  ModelPort,
  RunProgress,
} from '@paw/core';

/**
 * A model port that counts what passes through it.
 *
 * @interface MeteredPort
 * @property {ModelPort} port - The port to hand to the dispatcher.
 * @property {() => BudgetSummary} usage - The tokens counted so far.
 */
export interface MeteredPort {
  readonly port: ModelPort;
  usage(): BudgetSummary;
}

/**
 * Wrap a model port so every completion's usage is counted. Errors are not
 * swallowed — a failed call propagates to the dispatcher, which is what makes a
 * broken run visible instead of merely cheap.
 *
 * @param {ModelPort} inner - The port doing the real work.
 * @returns {MeteredPort} The metered port and its running total.
 */
export function meterPort(inner: ModelPort): MeteredPort {
  let tokensIn = 0;
  let tokensOut = 0;
  return {
    port: {
      complete: async (request) => {
        const response = await inner.complete(request);
        tokensIn += response.inputTokens;
        tokensOut += response.outputTokens;
        return response;
      },
    },
    usage: () => ({ spendUsd: 0, tokensIn, tokensOut }),
  };
}

/**
 * Map a finished dispatch to the console's run progress. `running` and `failed`
 * are zero because a batch dispatch is over by the time it returns: a member
 * either completed or the whole run threw. `confirmed` counts the members that
 * came back with content — output actually captured, which is the number an
 * operator is watching.
 *
 * @param {DispatchResult} result - The dispatch result.
 * @param {string} id - The run id.
 * @param {string} startedAt - The run's start timestamp.
 * @returns {RunProgress} The run as the console shows it.
 */
export function toRunProgress(
  result: DispatchResult,
  id: string,
  startedAt: string,
): RunProgress {
  const members: MemberView[] = result.outcomes.map((outcome) => ({
    member: outcome.member,
    key: outcome.key,
    state: outcome.state,
    level: null,
  }));
  const done = members.filter((m) => m.state === 'done').length;
  return {
    id,
    startedAt,
    skipped: members.length - done,
    done,
    running: 0,
    failed: 0,
    confirmed: result.outcomes.filter((o) => o.content !== undefined).length,
    members,
  };
}
