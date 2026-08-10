/**
 * PAW Console Live Event Application
 *
 * @fileoverview The twin of {@link hydrate}, for the wire that arrives a slice at
 * a time. `hydrate` maps a whole snapshot into {@link ConsoleData}; this maps one
 * topic's new value onto the data already held, and it is the only place a live
 * frame is allowed to change console state.
 *
 * Two rules, and both are the anti-corruption layer doing its job.
 *
 * **A slice replaces, never merges.** Every payload on this wire is the full new
 * value of its slice, so there is no patching, no deep merge, and no way to end
 * up holding half of an old plan and half of a new one. `hello` replaces
 * everything by going through `hydrate`, which is also where the producer's
 * per-member arrays are checked against its own member count.
 *
 * **A topic the console has no arm for changes nothing.** `error` and `log` are
 * carried by the wire and are not console *data*; they are surfaced elsewhere.
 * Returning the input unchanged is the correct answer for them, and it means a
 * future topic added on the daemon side cannot corrupt an older console.
 *
 * @module @paw/gui/application/applyLiveEvent
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type {
  AttachState,
  BudgetSummary,
  DoctorReport,
  HostInfo,
  HostProcess,
  LiveEnvelope,
  PawSnapshot,
  PlanSlice,
  PlansSlice,
  RunProgress,
} from '@paw/core';
import type { ConsoleData } from '../domain/console.types.js';
import { hydrate } from './hydrateSnapshot.js';

/**
 * Fold one live frame into the console's data.
 *
 * @param {ConsoleData} data - What the console currently holds.
 * @param {LiveEnvelope} event - The frame.
 * @returns {ConsoleData} The new data, or the same object when nothing changed.
 */
export function applyLiveEvent(data: ConsoleData, event: LiveEnvelope): ConsoleData {
  switch (event.topic) {
    case 'hello':
      return hydrate(event.data as PawSnapshot);

    case 'host':
      return { ...data, host: event.data as HostInfo };

    case 'processes':
      return { ...data, processes: event.data as readonly HostProcess[] };

    case 'plans': {
      const slice = event.data as PlansSlice;
      return { ...data, plans: slice.plans, configPath: slice.configPath };
    }

    case 'attach': {
      // A landed (re)scope reports the repository the daemon now serves; a
      // request in flight, refused, or failed leaves the console where it is.
      const attach = event.data as AttachState;
      const scoped = attach.status === 'idle' || attach.status === 'unconfigured';
      return scoped && attach.path !== null ? { ...data, root: attach.path } : data;
    }

    case 'planDetail': {
      const slice = event.data as PlanSlice;
      return {
        ...data,
        selectedPlan: slice.selectedPlan,
        plan: {
          name: slice.planName,
          role: slice.planRole,
          total: slice.memberTotal,
          source: slice.planSource,
          highlightLine: slice.highlightLine,
          briefs: slice.briefs,
          slugs: slice.slugs,
        },
        checks: slice.planFindings,
      };
    }

    case 'doctor':
      return { ...data, doctor: event.data as DoctorReport };

    case 'run':
      return { ...data, run: event.data as RunProgress };

    case 'budget':
      return { ...data, budget: event.data as BudgetSummary };

    default:
      return data;
  }
}
