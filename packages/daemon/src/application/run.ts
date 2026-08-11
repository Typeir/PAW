/**
 * PAW Daemon Run Reporting
 *
 * @fileoverview Map dispatch results and events to console run progress and
 * meter token usage. `dispatchSwarm` reports each member done or skipped.
 * Token count happens here; `meterPort` wraps the model port and sums input
 * and output tokens. Console spend meter counts tokens sent and received.
 * `spendUsd` stays zero; the price list does not cross this boundary.
 *
 * @module @paw/daemon/run
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  BudgetSummary,
  DispatchEvent,
  DispatchResult,
  MemberView,
  ModelPort,
  RunProgress,
} from '@paw/core';

/**
 * Model port. Count what pass through.
 *
 * @interface MeteredPort
 * @property {ModelPort} port - Port to hand dispatcher.
 * @property {() => BudgetSummary} usage - Tokens counted so far.
 */
export interface MeteredPort {
  readonly port: ModelPort;
  usage(): BudgetSummary;
}

/**
 * Wrap model port. Count every completion usage. Errors are not swallowed;
 * a failed `complete` call propagates to the dispatcher.
 *
 * @param {ModelPort} inner - Port doing real work.
 * @returns {MeteredPort} Metered port and running total.
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
 * Track a run while it runs.
 *
 * Live tracker reports the same fields from the same events the dispatcher
 * emits. Member state `running` from start until settle. Totals are direct
 * counts. Without live progress, a long run against a real provider shows
 * nothing for minutes and looks identical to a hung run.
 *
 * @interface RunTracker
 * @property {(event: DispatchEvent) => RunProgress} apply - Fold one dispatch event, return run as now stand.
 * @property {() => RunProgress} progress - Run as now stand.
 */
export interface RunTracker {
  apply(event: DispatchEvent): RunProgress;
  progress(): RunProgress;
}

/**
 * Track a run. Members move into the settled or running set.
 *
 * @param {string} id - Run id.
 * @param {string} startedAt - Run start timestamp.
 * @returns {RunTracker} Tracker.
 */
export function trackRun(id: string, startedAt: string): RunTracker {
  const settled = new Map<number, MemberView>();
  const running = new Map<number, MemberView>();
  let confirmed = 0;

  /**
   * Run as now stand, members in plan order.
   *
   * @returns {RunProgress} Progress.
   */
  const progress = (): RunProgress => {
    const members = [...settled.values(), ...running.values()].sort(
      (a, b) => a.member - b.member,
    );
    const done = [...settled.values()].filter((m) => m.state === 'done').length;
    return {
      id,
      startedAt,
      skipped: settled.size - done,
      done,
      running: running.size,
      failed: 0,
      confirmed,
      members,
    };
  };

  return {
    progress,
    apply: (event: DispatchEvent): RunProgress => {
      if (event.phase === 'started') {
        running.set(event.member, {
          member: event.member,
          key: event.key,
          state: 'running',
          level: null,
        });
        return progress();
      }
      running.delete(event.member);
      if (event.outcome !== undefined) {
        settled.set(event.member, {
          member: event.member,
          key: event.key,
          state: event.outcome.state,
          level: null,
        });
        if (event.outcome.content !== undefined) {
          confirmed += 1;
        }
      }
      return progress();
    },
  };
}

/**
 * Map finished dispatch to run progress. `running` and `failed` zero; batch
 * dispatch is done by the time it returns. If any member fails, the whole run
 * throws. `confirmed` counts members with content in the return.
 *
 * @param {DispatchResult} result - Dispatch result.
 * @param {string} id - Run id.
 * @param {string} startedAt - Run start timestamp.
 * @returns {RunProgress} Run as console show it.
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
