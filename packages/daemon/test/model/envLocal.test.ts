/**
 * @fileoverview Cover {@link parseDeepseekEnv}: pure parse of `.env.local`
 * body into `DEEPSEEK_*` name/value pairs read at launch. Strip quotes, ignore
 * non-matching and blank lines, handle CRLF — file walk and `process.env` write
 * run outside this module, so only the parse logic is tested here.
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
