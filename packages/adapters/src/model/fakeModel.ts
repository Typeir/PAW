/**
 * PAW Fake Model Adapter
 *
 * @fileoverview {@link ModelPort}. Record every request, return caller reply.
 * Swarm tests use it. Deterministic, runs offline. Test any `ModelPort`
 * consumer without a provider or key. Token count comes from string length.
 *
 * @module @paw/adapters/model/fakeModel
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

import type { ModelPort, ModelRequest, ModelResponse } from '@paw/core';

/**
 * Fake model port. Also show request it got.
 *
 * @interface FakeModel
 * @property {ModelRequest[]} requests - Every request `complete` was called with, in order.
 * @property {(request: ModelRequest) => Promise<ModelResponse>} complete - Run completion, record request.
 */
export interface FakeModel extends ModelPort {
  readonly requests: ModelRequest[];
}

/**
 * Make fake model port.
 *
 * @param {(request: ModelRequest) => string} reply - Produce content for given request.
 * @returns {FakeModel} Recording fake model port.
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
