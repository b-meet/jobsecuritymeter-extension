/**
 * Shared look for anything we draw on somebody else's page.
 *
 * Every widget here mounts inside a CLOSED shadow root, so none of this leaks
 * onto the application form and none of the site's CSS reaches in. That matters
 * more than usual: restyling a job application by accident is a very visible
 * way to cost somebody an offer, and a site that hid our button under its own
 * `z-index` would be an invisible failure.
 *
 * `all: initial` on the root is the other half of the isolation. Shadow DOM
 * blocks selectors, but INHERITED properties (font, colour, line-height,
 * direction) still cross the boundary, so a site with `body { font-size: 9px }`
 * would otherwise shrink our UI with it.
 */

export const COLORS = {
  green: "#2d5f4f",
  greenDeep: "#1d2a25",
  cream: "#f5f1e8",
  ink: "#181512",
  muted: "#6b655d",
  amber: "#e6b945",
  line: "rgba(24,21,18,.12)",
} as const;

/** Highest value the spec allows - the page cannot outrank it. */
export const TOP_LAYER = "2147483647";

export const BASE_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .root {
    font: 500 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: ${COLORS.ink};
    -webkit-font-smoothing: antialiased;
  }
  button {
    font: inherit; border: 0; cursor: pointer; color: inherit;
    background: none; text-align: left;
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
`;

/**
 * The mark on the handle. Inline SVG rather than a bundled file so there is no
 * `web_accessible_resources` entry - that would let any page on the web probe
 * for the extension's presence by loading the icon URL.
 */
export const BOLT_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M13 2 4.5 13.2c-.4.5 0 1.3.7 1.3H10l-1 7.5 8.5-11.2c.4-.5 0-1.3-.7-1.3H12z"
          fill="currentColor" />
  </svg>
`;
