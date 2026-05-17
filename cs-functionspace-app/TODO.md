# Belief Builder — Remaining Polish

## Animations (Section 7)
- [ ] Brick drop animation (220ms fall + squash + settle)
- [ ] Brick remove dissolve animation (180ms flash + collapse)
- [ ] Column recompression/reexpansion animation (parallel with add/remove)
- [ ] Payout label numeric tween (300ms interpolation)
- [ ] Spark burst particles on brick landing (6-8 particles, dedicated canvas layer)

## Visual Polish
- [ ] Gold shimmer on topmost brick when BRICKS[col] >= 4 AND EDGE_RATIO > 4.0
- [ ] Column-full shake animation (±3px, 3 cycles, 200ms)
- [ ] Global cap banner (auto-dismiss 3s)
- [ ] Tooltip on hover (above grid, shows "Round X · Y× payout" or "Remove · Round X")
- [ ] Ghost brick positioned correctly relative to existing stack height

## Edge Cases (Section 12)
- [ ] All-bricks-in-one-column amber warning
- [ ] Distribution-matches-consensus detection
- [ ] OT-only validation (valid, no warning)

## Canvas Layer Stack (Section 8)
- [ ] Consider migrating to canvas for consensus bars + particles for performance
- [ ] Particle canvas layer for spark bursts
