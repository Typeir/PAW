/**
 * PAW Connectors — Public API
 *
 * @fileoverview The host connectors PAW ships. Each implements `@paw/core`'s
 * `HostConnector` interface, translating a specific host's surface to and from
 * the canonical event stream. A repo selects one by name via `PawConfig.connector`;
 * adding a host is adding a connector here, with core untouched.
 *
 * @module @paw/connectors
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { copilotHooksConnector } from './copilotHooks.js';
