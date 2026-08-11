/**
 * PAW Connectors — Public API
 *
 * @fileoverview Host connectors PAW ship. Each implement `@paw/core`'s
 * `HostConnector` interface, translate specific host surface to and from
 * canonical event stream. Repo pick one by name via `PawConfig.connector`;
 * add host mean add connector here, core untouched.
 *
 * @module @paw/connectors
 * @version 0.0.0
 * @author Typeir
 * @since 5.0.0
 */

export { copilotHooksConnector } from './copilotHooks.js';
