/**
 * PAW Plans Control Port
 *
 * @fileoverview Console plan-file verbs, applied in the daemon: scaffold a
 * `*.swarm.mjs` from the template, delete one. Names are kebab-case gated and
 * delete paths refuse traversal or a wrong suffix, so the port only ever
 * touches plan files under the served root. Filesystem failures answer 500.
 *
 * @module @paw/daemon/plansControl
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ControlPort, ControlResult } from '../domain/control.js';
import { planNameValid, planPathFor, planTemplate, safePlanPath } from '../domain/plans.js';

/**
 * Injectable filesystem seams, for tests.
 *
 * @interface PlansControlSeams
 * @property {(path: string) => boolean} [exists] - Whether path exists.
 * @property {(path: string) => void} [mkdir] - Create directory, recursive.
 * @property {(path: string, content: string) => void} [write] - Write file.
 * @property {(path: string) => void} [remove] - Delete file.
 */
export interface PlansControlSeams {
  exists?(path: string): boolean;
  mkdir?(path: string): void;
  write?(path: string, content: string): void;
  remove?(path: string): void;
}

/**
 * Build 422, carry refusal reason.
 *
 * @param {string} reason - Refusal reason.
 * @returns {ControlResult} The result.
 */
function refuse(reason: string): ControlResult {
  return { status: 422, body: { ok: false, reason } };
}

/**
 * Run effect, mapping a thrown filesystem error to a 500 result.
 *
 * @param {() => ControlResult} effect - The effect.
 * @returns {ControlResult} Its result, or 500 with the message.
 */
function attempt(effect: () => ControlResult): ControlResult {
  try {
    return effect();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { ok: false, reason: message } };
  }
}

/**
 * Control port a `--control` console exposes over plan files: create from
 * template, delete.
 *
 * @param {string | (() => string)} root - Repository the console serves, or getter for the scope it currently holds.
 * @param {PlansControlSeams} [seams] - Injectable filesystem seams.
 * @returns {ControlPort} Registered writes.
 */
export function plansControl(
  root: string | (() => string),
  seams: PlansControlSeams = {},
): ControlPort {
  const currentRoot = typeof root === 'function' ? root : (): string => root;
  const exists = seams.exists ?? existsSync;
  const mkdir = seams.mkdir ?? ((path: string): void => void mkdirSync(path, { recursive: true }));
  const write = seams.write ?? ((path: string, content: string): void => writeFileSync(path, content, 'utf8'));
  const remove = seams.remove ?? unlinkSync;
  return {
    handlers: {
      'POST /api/plans': async ({ body }) => {
        const name = typeof body.name === 'string' ? body.name : '';
        if (!planNameValid(name)) {
          return refuse('plan name must be kebab-case: a-z, 0-9, dashes, 64 chars max');
        }
        const plan = planPathFor(name);
        const target = resolve(currentRoot(), plan);
        if (exists(target)) {
          return refuse(`plan already exists: ${plan}`);
        }
        return attempt(() => {
          mkdir(dirname(target));
          write(target, planTemplate(name));
          return { status: 201, body: { ok: true, plan } };
        });
      },
      'DELETE /api/plans': async ({ query, body }) => {
        const asked = typeof body.plan === 'string' ? body.plan : (query?.get('plan') ?? '');
        if (asked === '') {
          return refuse('plan is required');
        }
        const plan = safePlanPath(asked);
        if (plan === null) {
          return refuse(`not a deletable plan path: ${asked}`);
        }
        const target = resolve(currentRoot(), plan);
        if (!exists(target)) {
          return { status: 404, body: { ok: false, reason: `no such plan: ${plan}` } };
        }
        return attempt(() => {
          remove(target);
          return { status: 200, body: { ok: true, plan } };
        });
      },
    },
  };
}
