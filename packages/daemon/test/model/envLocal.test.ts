/**
 * @fileoverview Covers {@link parseDeepseekEnv}: the pure parse of a `.env.local`
 * body into the `DEEPSEEK_*` name/value pairs a live herd's egress reads. Quotes
 * are stripped, non-matching and blank lines are ignored, and CRLF is handled —
 * the fs walk and the `process.env` write stay in the excluded shell, so only
 * this parsing carries logic worth testing.
 *
 * @module @paw/daemon/test/model/envLocal
 */

import { describe, expect, it } from 'vitest';
import { parseDeepseekEnv } from '../../src/infrastructure/model/envLocal.js';

describe('parseDeepseekEnv', () => {
  it('reads DEEPSEEK_ names and strips surrounding quotes', () => {
    expect(parseDeepseekEnv('DEEPSEEK_KEY=sk-plain')).toEqual([['DEEPSEEK_KEY', 'sk-plain']]);
    expect(parseDeepseekEnv('DEEPSEEK_KEY="sk-dquoted"')).toEqual([['DEEPSEEK_KEY', 'sk-dquoted']]);
    expect(parseDeepseekEnv("DEEPSEEK_BASE_URL='http://x'")).toEqual([['DEEPSEEK_BASE_URL', 'http://x']]);
  });

  it('ignores blank, commented, and non-DEEPSEEK lines, across CRLF', () => {
    const body = ['# a comment', '', 'OTHER_KEY=nope', 'DEEPSEEK_MODEL=deepseek-chat', '  '].join('\r\n');
    expect(parseDeepseekEnv(body)).toEqual([['DEEPSEEK_MODEL', 'deepseek-chat']]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseDeepseekEnv('')).toEqual([]);
  });
});
