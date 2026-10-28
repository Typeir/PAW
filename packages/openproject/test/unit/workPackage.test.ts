/**
 * @fileoverview Cover {@link recordOf}: a full work package, a root with optional links absent,
 * story points as the rollup field, a parent link that names no work package, a non-string
 * display id, and the refusal for an element without id, subject, or updatedAt.
 *
 * @module @paw/openproject/test/unit/workPackage
 */

import { describe, expect, it } from 'vitest';
import { recordOf, taskId } from '../../src/domain/workPackage.js';
import { workPackage } from './fixtures.js';

const BASE = 'http://localhost:18080';

describe('recordOf', () => {
  it('maps a story under a feature with every field the work model reads', () => {
    const wp = workPackage(40, 'Pay with card', {
      parent: 39,
      type: 'User story',
      status: 'In progress',
      sprint: 'Sprint 1',
      assignee: 'Ada',
      storyPoints: 5,
      updatedAt: '2026-10-28T14:12:29.596Z',
    });
    expect(recordOf(wp, BASE)).toEqual({
      ok: true,
      record: {
        id: 'op-40',
        title: 'Pay with card',
        parent: 'op-39',
        updatedAt: '2026-10-28T14:12:29.596Z',
        fields: {
          source: 'openproject',
          sourceId: 40,
          url: 'http://localhost:18080/work_packages/40',
          updatedAt: '2026-10-28T14:12:29.596Z',
          displayId: '40',
          type: 'User story',
          status: 'In progress',
          project: 'Checkout',
          sprint: 'Sprint 1',
          assignee: 'Ada',
          points: 5,
        },
      },
    });
  });

  it('maps a root with no parent, sprint, assignee, or story points', () => {
    const parsed = recordOf(workPackage(38, 'Checkout epic', { type: 'Epic' }), BASE);
    expect(parsed.ok && parsed.record.parent).toBeNull();
    expect(parsed.ok && parsed.record.fields).toEqual({
      source: 'openproject',
      sourceId: 38,
      url: 'http://localhost:18080/work_packages/38',
      updatedAt: '2026-10-28T14:12:22.200Z',
      displayId: '38',
      type: 'Epic',
      status: 'New',
      project: 'Checkout',
    });
  });

  it('ignores a parent link that names no work package and a non-string display id', () => {
    const wp = workPackage(41, 'Odd links');
    const odd = { ...wp, displayId: 41, _links: { ...(wp._links as object), parent: { href: '/api/v3/projects/4' } } };
    const parsed = recordOf(odd, BASE);
    expect(parsed.ok && parsed.record.parent).toBeNull();
    expect(parsed.ok && 'displayId' in parsed.record.fields).toBe(false);
  });

  it('reads no links when _links is absent', () => {
    const parsed = recordOf({ id: 7, subject: 'Bare', updatedAt: '2026-10-28T14:00:00Z' }, BASE);
    expect(parsed).toEqual({
      ok: true,
      record: {
        id: 'op-7',
        title: 'Bare',
        parent: null,
        updatedAt: '2026-10-28T14:00:00Z',
        fields: {
          source: 'openproject',
          sourceId: 7,
          url: 'http://localhost:18080/work_packages/7',
          updatedAt: '2026-10-28T14:00:00Z',
        },
      },
    });
  });

  it('refuses an element without a numeric id, a subject, and updatedAt', () => {
    for (const element of [null, [], { id: '1', subject: 'x', updatedAt: 'y' }, { id: 1, updatedAt: 'y' }, { id: 1, subject: 'x' }]) {
      const parsed = recordOf(element, BASE);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.reason).toMatch(/^work package without a numeric id, subject, and updatedAt: /);
    }
  });
});

describe('taskId', () => {
  it('prefixes the OpenProject id', () => {
    expect(taskId(12)).toBe('op-12');
  });
});
