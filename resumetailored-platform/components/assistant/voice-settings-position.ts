/**
 * Pure positioning math for VoiceSettingsPopover.tsx — no DOM, no React, so
 * it can be unit-tested directly (scripts/test-voice-settings-position.cjs).
 *
 * Round 2 history: the panel was anchored with pure CSS (`absolute right-0`
 * on a wrapper exactly as wide as the 36px trigger button), which silently
 * assumed the trigger always sits flush against the container's right edge.
 * That assumption breaks on any real page layout where it doesn't — e.g. the
 * employer header is `flex flex-wrap justify-between`, and a lone wrapped
 * flex item under `justify-content: space-between` renders flush-LEFT, not
 * flush-right (confirmed CSS behavior, not device-specific). A 288px-wide
 * panel still anchored `right: 0` to a now-far-left trigger then extends far
 * past the viewport's left edge. There was no horizontal viewport check at
 * all, and no recompute on resize/orientation/scroll. This module replaces
 * that assumption with flip + shift + clamp computed fresh every time from
 * the trigger's real rect and the real viewport size.
 */

export const MOBILE_SHEET_BREAKPOINT = 480;
export const PANEL_GUTTER = 8;

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

/** Single source of truth for the sheet/popover breakpoint — anything that
 *  needs to know which mode applies (the component, the debug overlay,
 *  tests) calls this, so JS and CSS can never disagree about it. */
export function isMobileSheetWidth(viewportWidth: number): boolean {
  return viewportWidth <= MOBILE_SHEET_BREAKPOINT;
}

/**
 * Flip (prefer below the trigger, flip above if it would clip the bottom)
 * + shift (slide horizontally so it never clips the left or right edge)
 * + clamp (never render outside `gutter` px of any edge) + size (never
 * exceed the available width/height). Mirrors @floating-ui/react's
 * flip+shift+size middleware stack without the dependency.
 *
 * All inputs are plain numbers (viewport-relative, i.e. what
 * `getBoundingClientRect()` / `window.innerWidth`/`visualViewport.width`
 * already report) so this has no DOM dependency at all.
 */
export function computePopoverPosition(
  trigger: Rect,
  panelWidth: number,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  gutter: number = PANEL_GUTTER,
): PopoverPosition {
  const maxWidth = Math.max(0, viewportWidth - gutter * 2);
  const maxHeight = Math.max(0, viewportHeight - gutter * 2);
  const width = Math.min(panelWidth, maxWidth);
  const height = Math.min(panelHeight, maxHeight);

  const belowTop = trigger.bottom + gutter;
  const fitsBelow = belowTop + height <= viewportHeight - gutter;
  const aboveTop = trigger.top - gutter - height;
  const fitsAbove = aboveTop >= gutter;

  let top: number;
  let placement: "top" | "bottom";
  if (fitsBelow || !fitsAbove) {
    top = belowTop;
    placement = "bottom";
  } else {
    top = aboveTop;
    placement = "top";
  }
  // Final clamp: even if neither orientation "fits", never render outside
  // the gutter — better clipped-but-visible-and-scrollable than off-screen.
  const maxTop = Math.max(gutter, viewportHeight - gutter - height);
  top = Math.min(Math.max(top, gutter), maxTop);

  // Horizontal: prefer right-aligning the panel with the trigger (today's
  // visual default), then shift the whole box back onto the screen if that
  // would put either edge out of bounds. This is the step Round 2 never
  // did at all.
  const idealLeft = trigger.right - width;
  const maxLeft = Math.max(gutter, viewportWidth - gutter - width);
  const left = Math.min(Math.max(idealLeft, gutter), maxLeft);

  return { top, left, maxWidth: width, maxHeight: height, placement };
}
