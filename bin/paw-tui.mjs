#!/usr/bin/env node
/**
 * PAW TUI Launcher
 *
 * @fileoverview `paw-tui` until a published binary exists:
 * `node bin/paw-tui.mjs <config> <plan>`.
 *
 * @module @paw/bin/paw-tui
 */

import { launch } from './launch.mjs';

await launch('tui');
