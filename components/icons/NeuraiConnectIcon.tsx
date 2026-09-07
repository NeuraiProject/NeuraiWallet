import React from 'react';
import Svg, { Circle } from 'react-native-svg';

interface NeuraiConnectIconProps {
  color: string;
  size: number;
}

/**
 * Neurai Connect mark: a solid dot inside a heavy ring.
 *
 * Drawn instead of taken from an icon font so the ring keeps its weight at both
 * badge sizes the cards use (20 on a full card, 16 on a compact one) — a font
 * glyph thins out at 16 until it reads as a plain circle.
 */
const NeuraiConnectIcon: React.FC<NeuraiConnectIconProps> = ({ color, size }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    {/* Stroke centred on r=9.1, so the ring spans r=7.2 to the r=11 outer edge. */}
    <Circle cx={12} cy={12} r={9.1} stroke={color} strokeWidth={3.8} fill="none" />
    <Circle cx={12} cy={12} r={4.2} fill={color} />
  </Svg>
);

export default NeuraiConnectIcon;
