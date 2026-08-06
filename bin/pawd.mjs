#!/usr/bin/env node
/**
 * PAW Daemon Launcher
 *
 * @fileoverview `pawd` until a published binary exists: `node bin/pawd.mjs <config> <plan>`.
 *
 * @module @paw/bin/pawd
 */

import { launch } from './launch.mjs';

await launch('daemon');
