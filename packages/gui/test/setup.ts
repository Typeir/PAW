/**
 * PAW GUI Test Setup
 *
 * @fileoverview Unmounts every rendered tree between tests. Testing Library
 * registers its own cleanup only when a test runner exposes globals, and this
 * suite imports what it uses, so the teardown is wired explicitly — a leaked
 * tree would leave document-level key listeners from one test firing in the
 * next.
 *
 * @module @paw/gui/test/setup
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});
