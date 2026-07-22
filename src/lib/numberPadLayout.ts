// Shared layout constant for the docked <NumberPad> (src/components/NumberPad.tsx).
//
// A consumer that renders a scrollable list ABOVE the pad must pad the bottom of
// that list by at least this many px so the last row can scroll clear of the
// pad (R1: the list is never covered). Kept here — not inside NumberPad — so the
// pad stays a pure leaf and the number has one home.
//
// Approx height: read-out row (~52px) + 4 button rows (52px + 6px gap ≈ 58px
// each) + top border + safe-area bottom inset. Rounded up generously; a little
// extra bottom padding is harmless, too little clips the last row.
export const NUMBER_PAD_HEIGHT_PX = 320
