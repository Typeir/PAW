/**
 * PAW GUI Demo Snapshot
 *
 * @fileoverview The dataset the self-contained page ships with: the mockup's
 * `spell-lore` swarm, shaped as the exact {@link PawSnapshot} `pawd` serves, so
 * the static artifact and the live console run the same code over the same
 * contract. It is a demo and says so — the daemon reads idle, the host carries
 * no pid, and the process table is empty, because a page with no daemon behind
 * it has no host to report. What is real here is the plan: 393 members, the
 * level branch that decides what each is told, and the briefs and slugs
 * pre-rendered exactly as the daemon would render them.
 *
 * @module @paw/gui/demo/spellLore
 */

const NAMED = [
  ['flame-jet', 'Flame Jet', 0], ['spark', 'Spark', 0], ['ember-dart', 'Ember Dart', 1],
  ['frost-touch', 'Frost Touch', 2], ['stone-skin', 'Stone Skin', 3], ['gust', 'Gust', 2],
  ['blizzard-barrier', 'Blizzard Barrier', 6], ['chain-lightning', 'Chain Lightning', 6],
  ['wall-of-thorns', 'Wall of Thorns', 5], ['banishment', 'Banishment', 4], ['haste', 'Haste', 3],
  ['fireball', 'Fireball', 3], ['counterspell', 'Counterspell', 3], ['polymorph', 'Polymorph', 4],
  ['disintegrate', 'Disintegrate', 6], ['sunburst', 'Sunburst', 8], ['meteor-swarm', 'Meteor Swarm', 9],
  ['time-stop', 'Time Stop', 9], ['wish', 'Wish', 10],
];

const TOTAL = 393;

const PREAMBLE =
  '[preamble — Berserk / FromSoftware / Beksiński tone; dry, visceral, SHORT;\n' +
  ' describe the EFFECT, not mechanics; no entity-linking, no lore drops.]';

/**
 * The plan module's source, as the console shows it.
 */
const PLAN_SOURCE = `import { listSpells, parseSpell, needsLore } from './spellData.mjs';
import { readFileSync } from 'node:fs';

const PREAMBLE = readFileSync('…/lore.preamble.md', 'utf8');
const spells   = listSpells('src/content/en/spells'); // 393

// eight-way branch — a cantrip and an apex spell are told different things
const levelGuide = (lvl) =>
  lvl === 0  ? 'One direct sentence: "you conjure a flame".'
  : lvl <= 2 ? 'Straightforward physical effect.'
  : lvl <= 6 ? 'A potent effect that reshapes matter at scale.'
  : lvl <= 9 ? 'Cataclysmic — a magical ICBM. Apocalyptic scope.'
  :            'Apex: excise reality, teleport a castle miles.';

export default {
  name: 'spell-lore', role: 'lore.author',
  args: { spells, preamble: PREAMBLE },
  members: (a) => a.spells.length,

  brief: (a, m, n) => {
    const s = parseSpell(a.spells[m]);
    return \`You are member \${m + 1} of \${n}, a lore author.
\${a.preamble}
Level guidance: \${levelGuide(s.level)}
SPELL "\${s.title}" — replace ONLY the italic line.
Return { loreDescription } or {} to skip.\`;
  },

  skip: (a, m) => !needsLore(a.spells[m]), // already authored → 0 calls
  key : (a, m) => a.spells[m].slug,        // resume, like processedSlugs[]
};`;

/**
 * The level guidance a member is given, the plan's eight-way branch.
 *
 * @param {number} level - The spell's level.
 * @returns {string} The guidance line.
 */
function levelGuide(level) {
  if (level === 0) {
    return 'One direct sentence: "you conjure a flame".';
  }
  if (level <= 2) {
    return 'Straightforward physical effect.';
  }
  if (level <= 6) {
    return 'A potent effect that reshapes matter at scale.';
  }
  if (level <= 9) {
    return 'Cataclysmic — a magical ICBM. Apocalyptic scope.';
  }
  return 'Apex: excise reality, teleport a castle miles.';
}

/**
 * The plan's 393 spells: the named ones first, then filler that keeps the same
 * shape so every member renders a real brief.
 *
 * @returns {Array<{slug: string, title: string, level: number}>} The spells.
 */
function spells() {
  return Array.from({ length: TOTAL }, (_v, i) => {
    const named = NAMED[i];
    if (named) {
      return { slug: named[0], title: named[1], level: named[2] };
    }
    const seed = NAMED[i % NAMED.length];
    return { slug: `${seed[0]}-${i}`, title: `${seed[1]} ${i}`, level: (i * 7) % 11 };
  });
}

/**
 * Render one member's brief exactly as the plan's `brief(args, member, total)`
 * would.
 *
 * @param {{slug: string, title: string, level: number}} spell - The member's spell.
 * @param {number} member - The zero-based member index.
 * @returns {string} The brief.
 */
function brief(spell, member) {
  return [
    `You are member ${member + 1} of ${TOTAL}, a lore author.`,
    PREAMBLE,
    `Level guidance: ${levelGuide(spell.level)}`,
    `SPELL "${spell.title}" — replace ONLY the italic line.`,
    'Return { loreDescription } or {} to skip.',
  ].join('\n');
}

const ROLES = [
  ['lore.author', 'deepseek-chat'], ['lore.judge', 'deepseek-reasoner'],
  ['edit.apply', 'deepseek-chat'], ['review.graze', 'deepseek-chat'],
  ['review.judge', 'deepseek-reasoner'],
].map(([role, boundTo]) => ({
  role,
  optional: false,
  boundTo,
  satisfaction: { ok: true, reasons: [] },
  blocking: false,
}));

ROLES.push({
  role: 'memory.draft',
  optional: true,
  boundTo: null,
  satisfaction: null,
  blocking: false,
});

const VIOLATIONS = [
  {
    id: 1,
    filePath: 'src/lib/db/orm/entities/MonsterEntity.ts',
    rule: 'mikroorm-typed',
    message: '@PrimaryKey() missing an explicit type.',
    indirectFix: false,
  },
  {
    id: 2,
    filePath: 'src/app/[locale]/search/page.tsx',
    rule: 'no-color-literal',
    message: 'Hex colour outside globals.scss.',
    indirectFix: false,
  },
  {
    id: 3,
    filePath: 'scripts/metadata/taggingUtils.ts',
    rule: 'jsdoc-exports',
    message: 'Exported function needs a test in a sibling file.',
    indirectFix: true,
  },
];

/**
 * Build the demo snapshot.
 *
 * @returns {object} A `PawSnapshot` for the static page.
 */
export function demoSnapshot() {
  const list = spells();
  const members = list.slice(0, 19).map((spell, i) => ({
    member: i,
    key: spell.slug,
    state: i < 17 ? 'done' : i === 17 ? 'running' : 'failed',
    level: spell.level,
    ...(i === 18 ? { note: 'timeout after 30s' } : {}),
  }));

  return {
    host: {
      pid: 0,
      ppid: 0,
      uptimeSec: 0,
      rssBytes: 0,
      hostname: '(no daemon)',
      platform: 'static',
      release: 'artifact',
      cpus: 0,
      node: '(not running)',
      cwd: '(no daemon)',
    },
    processes: [],
    configPath: '.paw/config.json',
    plans: ['plans/spell-lore.swarm.mjs'],
    selectedPlan: 'plans/spell-lore.swarm.mjs',
    planName: 'spell-lore',
    planRole: 'lore.author',
    memberTotal: TOTAL,
    planSource: PLAN_SOURCE,
    highlightLine: 11,
    briefs: list.map(brief),
    slugs: list.map((spell) => spell.slug),
    doctor: { ok: true, config: [], roles: ROLES },
    planFindings: [
      { check: 'count', ok: true },
      { check: 'total-brief', ok: true },
      { check: 'purity', ok: true },
      { check: 'file-conflict', ok: true },
    ],
    run: {
      id: '15-40-02',
      startedAt: '2026-08-05T15-40-02',
      skipped: 374,
      done: 17,
      running: 1,
      failed: 1,
      confirmed: 17,
      members,
    },
    budget: { spendUsd: 0.03, tokensIn: 41280, tokensOut: 9130 },
    violations: VIOLATIONS,
    daemon: {
      live: false,
      uptimeLabel: '—',
      pid: 0,
      socket: '(none)',
      rssMb: 0,
      proto: 'v1',
      storeWriters: 1,
    },
    chrome: { gates: 11, keys: 1 },
  };
}
