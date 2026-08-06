/**
 * Demo swarm plan
 *
 * @fileoverview A fixture plan the CLI E2E loads by path: two members, each
 * editing one distinct file, with a per-member brief that interpolates the
 * arglist. Exercises `paw swarm doctor|show|run` end to end. Plain `.mjs` because
 * a plan is code the CLI imports, not a config it parses.
 */

/** @type {import('@paw/core').SwarmPlan<{ files: string[] }>} */
const plan = {
  name: 'demo',
  role: 'edit.apply',
  args: { files: ['docs/one.mdx', 'docs/two.mdx'] },
  members: (args) => args.files.length,
  brief: (args, member, members) =>
    `You are member ${member + 1} of ${members}.\nEdit ${args.files[member]}.`,
  expectFiles: (args, member) => args.files[member],
  key: (args, member) => args.files[member],
};

export default plan;
