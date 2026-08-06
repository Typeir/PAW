/**
 * PAW Fake Model Adapter
 *
 * @fileoverview A {@link ModelPort} that records every request and returns a
 * caller-supplied reply. It is the model a swarm test drives — deterministic,
 * offline, free — and it is how any consumer of `ModelPort` is tested without a
 * real provider or a key. Token counts are derived from string lengths so budget
 * accounting has something plausible to meter.
 *
 * @module @paw/adapters/model/fakeModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelPort, ModelRequest, ModelResponse } from '@paw/core';

/**
 * A fake model port that also exposes the requests it received.
 *
 * @interface FakeModel
 * @property {ModelRequest[]} requests - Every request `complete` was called with, in order.
 * @property {(request: ModelRequest) => Promise<ModelResponse>} complete - Run a completion, recording the request.
 */
export interface FakeModel extends ModelPort {
  readonly requests: ModelRequest[];
}

/**
 * Create a fake model port.
 *
 * @param {(request: ModelRequest) => string} reply - Produces the content for a given request.
 * @returns {FakeModel} A recording fake model port.
 */
export function createFakeModel(
  reply: (request: ModelRequest) => string,
): FakeModel {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const content = reply(request);
      return {
        content,
        inputTokens: request.prompt.length,
        outputTokens: content.length,
      };
    },
  };
}
