/**
 * PAW GUI Test Setup
 *
 * @fileoverview Unmount every rendered tree between tests. Testing Library
 * register own cleanup only when test runner expose globals. This suite import
 * what it use, so teardown wire explicit. Leaked tree leave document-level key
 * listener from one test fire in next.
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
