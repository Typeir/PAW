/**
 * PAW GUI Demo Snapshot — Types
 *
 * @fileoverview The demo dataset is authored as plain ESM because the build
 * script runs it directly on Node; this declares what it produces, so the
 * console's own contract is type-checked against it and a demo that drifts from
 * {@link PawSnapshot} fails the build rather than the page.
 *
 * @module @paw/gui/demo/spellLore
 */

import type { PawSnapshot } from '@paw/core';

/**
 * Build the snapshot the self-contained page ships with.
 *
 * @returns {PawSnapshot} The demo snapshot.
 */
export declare function demoSnapshot(): PawSnapshot;
