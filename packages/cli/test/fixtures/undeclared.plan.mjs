/**
 * Swarm plan declaring no output
 *
 * @fileoverview Fixture plan with no `expectFiles`: the CLI E2E uses it to show
 * that a run over such a plan reports targets as unenforced rather than
 * counting every member as a pass. Named `.plan.mjs`, not `.swarm.mjs`, so it
 * stays outside plan discovery — the `ui` E2E asserts the fixture directory
 * holds exactly one discoverable plan. `swarm run` loads it by path regardless.
 */

/** @type {import('@paw/core').SwarmPlan<Record<string, never>>} */
const plan = {
  name: 'undeclared',
  role: 'edit.apply',
  args: {},
  members: 2,
  brief: (_args, member) => `You are member ${member}. Think, write nothing.`,
};

export default plan;
