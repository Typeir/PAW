/**
 * @fileoverview Cover {@link slimSectionsOf}: lift each section non-empty
 * `slim` into id→content baseline, skip section whose `slim` empty,
 * leave them to SDK. Also assert shipped {@link COPILOT_SLIM_SECTIONS}
 * loads non-empty from the sections file.
 *
 * @module @paw/daemon/test/model/copilotSystemSections
 */

import { describe, expect, it } from 'vitest';
import {
  COPILOT_SLIM_SECTIONS,
  slimSectionsOf,
  type SystemSectionEntry,
} from '../../src/infrastructure/model/copilotSystemSections.js';

describe('slimSectionsOf', () => {
  it('keys non-empty slims by id and skips empty ones', () => {
    const sections: Record<string, SystemSectionEntry> = {
      identity: { id: 'identity', slim: 'you caveman', full: 'You are ...' },
      tone: { id: 'tone', slim: '', full: '# Tone ...' },
      safety: { id: 'safety', slim: 'no leak secret', full: '<safety> ...' },
    };
    expect(slimSectionsOf(sections)).toEqual({
      identity: 'you caveman',
      safety: 'no leak secret',
    });
  });

  it('ships a non-empty slim baseline from the sections file', () => {
    expect(Object.keys(COPILOT_SLIM_SECTIONS).length).toBeGreaterThan(0);
    for (const content of Object.values(COPILOT_SLIM_SECTIONS)) {
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
