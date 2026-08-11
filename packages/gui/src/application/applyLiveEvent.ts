/**
 * PAW Console Live Event Application
 *
 * @fileoverview Twin of {@link hydrate}, for wire come slice by slice.
 * `hydrate` map whole snapshot into {@link ConsoleData}; this map one topic
 * new value onto data already hold. Only place live frame can change console
 * state.
 *
 * Two rules. Both be anti-corruption layer do its job.
 *
 * **Slice replace, never merge.** Every payload on this wire be full new value
 * of its slice. No patching, no deep merge, no way to end up hold half old plan
 * and half new one. `hello` replace everything by go through `hydrate`, which
 * also check the producer per-member arrays against own member count.
 *
 * **Topic console have no arm for change nothing.** `error` and `log` carried
 * by wire, not console *data*; surface elsewhere. Return input unchanged for
 * them. Future topic on daemon side cannot corrupt older console.
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
 * Fold one live frame into console data.
 *
 * @param {ConsoleData} data - Console hold now.
 * @param {LiveEnvelope} event - The frame.
 * @returns {ConsoleData} New data, or same object when nothing change.
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
      // Landed (re)scope report repo daemon now serve. Request in flight,
      // refused, or failed leave console where it be.
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
