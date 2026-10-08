/**
 * SCSS Inline Module
 *
 * @fileoverview Types a `*.scss?inline` import: the compiled CSS as a string.
 *
 * @module @paw/gui/presentation/styles/scss
 */

declare module '*.scss?inline' {
  const css: string;
  export default css;
}
