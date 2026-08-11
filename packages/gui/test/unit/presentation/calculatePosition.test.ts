/**
 * @fileoverview Exercise `calculatePosition` on every placement, each viewport flip,
 * and both horizontal clamps, passing fabricated rects.
 *
 * @module @paw/gui/test/unit/presentation/calculatePosition
 */

import { describe, expect, it } from 'vitest';
import { calculatePosition } from '../../../src/presentation/lib/calculatePosition.js';

/** jsdom default viewport 1024×768. */
const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect);

const tip = rect(0, 0, 100, 30);

describe('calculatePosition', () => {
  it('places above for top and flips to bottom near the top edge', () => {
    expect(calculatePosition(rect(400, 400, 40, 20), tip, 'top').actualPlacement).toBe('top');
    const flipped = calculatePosition(rect(400, 5, 40, 20), tip, 'top');
    expect(flipped.actualPlacement).toBe('bottom');
    expect(flipped.y).toBe(33);
  });

  it('places below for bottom and flips to top near the bottom edge', () => {
    expect(calculatePosition(rect(400, 300, 40, 20), tip, 'bottom').actualPlacement).toBe('bottom');
    expect(calculatePosition(rect(400, 750, 40, 20), tip, 'bottom').actualPlacement).toBe('top');
  });

  it('places left for left and flips to right near the left edge', () => {
    expect(calculatePosition(rect(400, 400, 40, 20), tip, 'left').actualPlacement).toBe('left');
    expect(calculatePosition(rect(5, 400, 40, 20), tip, 'left').actualPlacement).toBe('right');
  });

  it('places right for right and flips to left near the right edge', () => {
    expect(calculatePosition(rect(400, 400, 40, 20), tip, 'right').actualPlacement).toBe('right');
    expect(calculatePosition(rect(950, 400, 40, 20), tip, 'right').actualPlacement).toBe('left');
  });

  it('clamps x to the viewport margins', () => {
    expect(calculatePosition(rect(0, 400, 10, 20), tip, 'top').x).toBe(8);
    expect(calculatePosition(rect(1020, 400, 10, 20), tip, 'top').x).toBe(1024 - 100 - 8);
  });
});
