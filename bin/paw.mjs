#!/usr/bin/env node
/**
 * PAW CLI Launcher
 *
 * @fileoverview `paw` until a published binary exists: `node bin/paw.mjs <command>`.
 *
 * @module @paw/bin/paw
 */

import { launch } from './launch.mjs';

await launch('cli');
