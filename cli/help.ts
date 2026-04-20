/**
 * @fileoverview Help text and ASCII logo for the PAW CLI.
 *
 * @module .github/PAW/cli/help
 */

/**
 * ANSI colour codes for terminal output.
 */
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
} as const;

/**
 * ASCII logo for the PAW CLI.
 */
export const LOGO = `${C.cyan}
  ╔═══════════════════════╗
  ║   🐾  PAW CLI  v1.0  ║
  ╚═══════════════════════╝${C.reset}
`;

/**
 * Print the full help text to stdout.
 */
export function printHelp(): void {
  console.log(`
${C.cyan}paw${C.reset} — Portable Agentic Workflows CLI

${C.yellow}VIOLATIONS${C.reset}
  paw violations ls          List unresolved violations
  paw violations prune       Resolve all stale violations
  paw violations resolve <f> Resolve violations for a specific file

${C.yellow}DATABASE${C.reset}
  paw db stats               Show table row counts
  paw db reset               Drop and recreate all tables

${C.yellow}SYSTEM${C.reset}
  paw sync                   Regenerate hooks.json via adapter layer
  paw status                 Show surface config and hook registration

${C.yellow}ALIASES${C.reset}
  paw v                      → violations ls
  paw st                     → status

${C.dim}Run from project root:
  npx tsx --tsconfig .paw/tsconfig.json .github/PAW/cli/paw.ts <command>${C.reset}
`);
}
