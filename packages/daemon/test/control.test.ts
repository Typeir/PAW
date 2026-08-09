/**
 * PAW Daemon Control Port Tests
 *
 * @fileoverview The write door's sanitiser, from the attacker's side: a body that
 * does not declare JSON is 415; malformed text is 400; a value that parses but is
 * not an object — a primitive, an array, `null` — is 422; an empty body is the
 * empty object; a real object passes. The content-type match tolerates a charset
 * but nothing broader. So `control.ts` reaches 100% and every refusal is pinned.
 *
 * @module @paw/daemon/test/control
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import { describe, expect, it } from 'vitest';
import { isWriteMethod, parseControlBody } from '../src/domain/control.js';

const JSON_CT = 'application/json';

describe('isWriteMethod', () => {
  it('is true for the write verbs and false for reads and preflight', () => {
    expect(['POST', 'PUT', 'DELETE'].every(isWriteMethod)).toBe(true);
    expect(['GET', 'OPTIONS', 'HEAD', 'PATCH'].some(isWriteMethod)).toBe(false);
  });
});

describe('parseControlBody', () => {
  it('refuses a missing content type with 415', () => {
    expect(parseControlBody('{}', undefined)).toEqual({
      ok: false,
      status: 415,
      message: 'content-type must be application/json',
    });
  });

  it('refuses a non-json content type with 415', () => {
    expect(parseControlBody('a=1', 'application/x-www-form-urlencoded').ok).toBe(false);
  });

  it('accepts application/json with a charset parameter', () => {
    expect(parseControlBody('{"a":1}', 'application/json; charset=utf-8')).toEqual({
      ok: true,
      body: { a: 1 },
    });
  });

  it('reads an empty body as the empty object', () => {
    expect(parseControlBody('   ', JSON_CT)).toEqual({ ok: true, body: {} });
  });

  it('reads an empty body as the empty object even with no content type', () => {
    expect(parseControlBody('', undefined)).toEqual({ ok: true, body: {} });
  });

  it('refuses malformed json with 400', () => {
    expect(parseControlBody('{not json', JSON_CT)).toEqual({
      ok: false,
      status: 400,
      message: 'malformed json',
    });
  });

  it('refuses a json array with 422', () => {
    expect(parseControlBody('[1,2]', JSON_CT).ok).toBe(false);
    expect(parseControlBody('[1,2]', JSON_CT)).toMatchObject({ status: 422 });
  });

  it('refuses a json primitive with 422', () => {
    expect(parseControlBody('42', JSON_CT)).toMatchObject({ status: 422 });
  });

  it('refuses json null with 422', () => {
    expect(parseControlBody('null', JSON_CT)).toMatchObject({ status: 422 });
  });

  it('accepts a json object', () => {
    expect(parseControlBody('{"file":"src/a.ts"}', JSON_CT)).toEqual({
      ok: true,
      body: { file: 'src/a.ts' },
    });
  });
});
