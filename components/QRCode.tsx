import Clipboard from '@react-native-clipboard/clipboard';
import {
  colorAlpha,
  colorHex,
  emitLayer,
  encode,
  getLayout,
  gradientGeometry,
  isGradient,
  layerPaint,
  parseStyle,
  SvgPathWriter,
  type Layer,
  type Paint,
  type Style,
} from '@kudelink/qrkude';
import React, { useCallback, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import Share from 'react-native-share';
import Svg, { Defs, Image as SvgImage, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import loc from '../loc';
import { ActionIcons } from '../typings/ActionIcons';
import ToolTipMenu from './TooltipMenu';
import { Action } from './types';

type ErrorCorrectionLevel = 'H' | 'Q' | 'M' | 'L';

interface QRCodeProps {
  value: string;
  size?: number;
  isLogoRendered?: boolean;
  isMenuAvailable?: boolean;
  logoSize?: number;
  ecl?: ErrorCorrectionLevel;
  onError?: (error?: unknown) => void;
}

const BACKGROUND = '#FFFFFF';
/** Largest logo, as a fraction of the code's width: H codes still read
 * reliably with it, whatever the payload. */
const MAX_LOGO_FRACTION = 0.3;

/**
 * QRKude style: round dots in a dark blue gradient, rounded eyes, and the
 * Neurai logo in a white circle cut out of the center.
 */
export const qrStyle = (logoFraction: number): Style =>
  parseStyle({
    margin: 1,
    modules: {
      shape: 'dot',
      size: 0.9,
      color: {
        type: 'linear',
        angle: 45,
        stops: [
          { offset: 0, color: '#0c2550' },
          { offset: 1, color: '#1e3a8a' },
        ],
      },
    },
    eyes: { frame: 'rounded', ball: 'rounded' },
    background: { color: BACKGROUND },
    logo: { size: logoFraction, shape: 'circle', background: BACKGROUND },
  });

const actionIcons: { [key: string]: ActionIcons } = {
  Copy: { iconValue: 'doc.on.doc' },
  Share: { iconValue: 'square.and.arrow.up' },
};

const actionKeys = { Copy: 'copy', Share: 'share' };

// Copy-as-image is iOS/macOS-only — @react-native-clipboard/clipboard's setImage
// is not implemented on Android. Android users still get text-copy via the
// dedicated CopyTextToClipboard control rendered next to the QR on every screen.
const menuActions: Action[] =
  Platform.OS === 'ios' || Platform.OS === 'macos'
    ? [
        { id: actionKeys.Copy, text: loc.transactions.details_copy, icon: actionIcons.Copy },
        { id: actionKeys.Share, text: loc.receive.details_share, icon: actionIcons.Share },
      ]
    : [{ id: actionKeys.Share, text: loc.receive.details_share, icon: actionIcons.Share }];

/** A layer's fill: a color, or a gradient of the plan's `gradients`. */
type Fill = { color: string; opacity: number } | { gradient: number };

type PlanGradient = {
  linear: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
  r: number;
  stops: Array<{ offset: number; color: string; opacity: number }>;
};

/** Everything drawn for one value, in the code's units (modules). */
type RenderPlan = {
  width: number;
  height: number;
  layers: Array<{ layer: Layer; d: string; fill: Fill }>;
  gradients: PlanGradient[];
  logo: { x: number; y: number; size: number } | null;
};

const PLAN_CACHE_MAX = 64;
const planCache = new Map<string, RenderPlan>();

/** Layers drawn as paths, in painting order; the background is a rect. */
const PATH_LAYERS: Layer[] = ['modules', 'eyeFrames', 'eyeBalls', 'logoBackground'];

/**
 * The geometry and paints of `value` in the QRKude style, as its SVG writer
 * lays them out. Eyes without a paint of their own share the modules' one.
 */
const buildPlan = (value: string, ecl: ErrorCorrectionLevel, logoFraction: number): RenderPlan => {
  const style = qrStyle(logoFraction);
  const code = encode(value, { ecc: ecl });
  const layout = getLayout(code, style);
  const gradients: PlanGradient[] = [];
  const gradientIndex = new Map<Paint, number>();
  const fillOf = (paint: Paint, geometryLayer: Layer): Fill => {
    if (isGradient(paint)) {
      let index = gradientIndex.get(paint);
      if (index === undefined) {
        const g = gradientGeometry(code, style, geometryLayer);
        index = gradients.length;
        gradients.push({
          linear: paint.type === 'linear',
          ...g,
          stops: paint.stops.slice(0, 8).map(st => ({ offset: st.offset, color: colorHex(st.color), opacity: colorAlpha(st.color) / 255 })),
        });
        gradientIndex.set(paint, index);
      }
      return { gradient: index };
    }
    const color = paint.type === 'solid' ? paint.color : 0;
    return { color: colorHex(color), opacity: colorAlpha(color) / 255 };
  };

  const layers: RenderPlan['layers'] = [];
  for (const layer of PATH_LAYERS) {
    const writer = new SvgPathWriter();
    if (emitLayer(code, style, layer, writer) === 0) continue;
    const paint = layerPaint(style, layer);
    const sharesModulesPaint = paint === style.modules.color;
    layers.push({ layer, d: writer.toString(), fill: fillOf(paint, sharesModulesPaint ? 'modules' : layer) });
  }
  return {
    width: layout.width,
    height: layout.height,
    layers,
    gradients,
    logo: layout.hasLogo ? { x: layout.logoX, y: layout.logoY, size: layout.logoSize } : null,
  };
};

const getCachedPlan = (value: string, ecl: ErrorCorrectionLevel, logoFraction: number): RenderPlan => {
  const key = `${ecl}|${logoFraction}|${value}`;
  const hit = planCache.get(key);
  if (hit) {
    planCache.delete(key);
    planCache.set(key, hit);
    return hit;
  }
  const plan = buildPlan(value, ecl, logoFraction);
  planCache.set(key, plan);
  if (planCache.size > PLAN_CACHE_MAX) {
    const first = planCache.keys().next().value;
    if (first !== undefined) planCache.delete(first);
  }
  return plan;
};

const gradientId = (index: number) => `qrgrad${index}`;

const QRCode: React.FC<QRCodeProps> = ({
  value = '',
  size = 300,
  isLogoRendered = true,
  isMenuAvailable = true,
  logoSize = 90,
  ecl = 'H',
  onError,
}) => {
  const svgRef = useRef<Svg>(null);

  const logoFraction = isLogoRendered && size > 0 ? Math.min(logoSize / size, MAX_LOGO_FRACTION) : 0;
  const plan = useMemo<RenderPlan | null>(() => {
    try {
      return getCachedPlan(value, ecl, logoFraction);
    } catch (e) {
      onError?.(e);
      return null;
    }
  }, [value, ecl, logoFraction, onError]);

  const handleCopy = useCallback(() => {
    if (!svgRef.current) return;
    svgRef.current.toDataURL((data: string) => {
      if (data) Clipboard.setImage(data);
    });
  }, []);

  const handleShare = useCallback(() => {
    if (!svgRef.current) return;
    svgRef.current.toDataURL((data: string) => {
      if (!data) {
        console.warn('QRCode: toDataURL returned empty data');
        return;
      }
      const cleaned = data.replace(/(\r\n|\n|\r)/gm, '');
      Share.open({
        url: `data:image/png;base64,${cleaned}`,
        type: 'image/png',
        filename: 'qrcode',
        failOnCancel: false,
        // Workaround for Android FileProvider crash with data: URLs since react-native-share@12.1.1.
        // Accepted at runtime but missing from ShareOptions types as of 12.2.6.
        // See https://github.com/react-native-share/react-native-share/issues/1683
        // @ts-expect-error - useInternalStorage missing from ShareOptions type
        useInternalStorage: true,
      }).catch((error: Error) => console.warn('QRCode share failed:', error));
    });
  }, []);

  const onPressMenuItem = useCallback(
    (id: string) => {
      if (id === actionKeys.Copy) handleCopy();
      else if (id === actionKeys.Share) handleShare();
    },
    [handleCopy, handleShare],
  );

  const stylesHook = StyleSheet.create({
    placeholder: { width: size, height: size, backgroundColor: BACKGROUND },
  });

  const qrButtonStyle: ViewStyle = {
    width: size,
    height: size,
    justifyContent: 'center',
    alignItems: 'center',
  };

  const renderQR = useMemo(() => {
    if (!plan) return null;
    const { width, height, layers, gradients, logo } = plan;
    const fillProps = (fill: Fill) =>
      'gradient' in fill ? { fill: `url(#${gradientId(fill.gradient)})` } : { fill: fill.color, fillOpacity: fill.opacity };

    return (
      <Svg ref={svgRef} testID="BitcoinAddressQRCode" width={size} height={(size * height) / width} viewBox={`0 0 ${width} ${height}`}>
        {gradients.length > 0 && (
          <Defs>
            {gradients.map((g, i) => {
              const stops = g.stops.map((st, j) => <Stop key={j} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />);
              return g.linear ? (
                <LinearGradient key={i} id={gradientId(i)} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
                  {stops}
                </LinearGradient>
              ) : (
                <RadialGradient key={i} id={gradientId(i)} gradientUnits="userSpaceOnUse" cx={g.cx} cy={g.cy} r={g.r}>
                  {stops}
                </RadialGradient>
              );
            })}
          </Defs>
        )}
        <Rect testID="qr-background" x={0} y={0} width={width} height={height} fill={BACKGROUND} />
        {layers.map(l => (
          <Path key={l.layer} testID={`qr-${l.layer}`} d={l.d} {...fillProps(l.fill)} />
        ))}
        {logo && (
          <SvgImage
            testID="qr-logo-image"
            href={require('../img/qr-code.png')}
            x={logo.x}
            y={logo.y}
            width={logo.size}
            height={logo.size}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
      </Svg>
    );
  }, [plan, size]);

  const content = renderQR ?? <View testID="qr-placeholder" style={stylesHook.placeholder} />;

  return (
    <View
      style={styles.container}
      accessibilityIgnoresInvertColors
      importantForAccessibility="no-hide-descendants"
      accessibilityRole="image"
      accessibilityLabel={loc.receive.qrcode_for_the_address}
    >
      {isMenuAvailable ? (
        <ToolTipMenu
          actions={menuActions}
          onPressMenuItem={onPressMenuItem}
          shouldOpenOnLongPress
          isButton
          enableAndroidRipple={false}
          buttonStyle={qrButtonStyle}
        >
          {content}
        </ToolTipMenu>
      ) : (
        content
      )}
    </View>
  );
};

export default QRCode;

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
