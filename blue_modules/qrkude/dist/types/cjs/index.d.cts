import { EncodeOptions, QRCode } from './encode.cjs';
import { LintFlag } from './lint.cjs';
import { DocumentInput, QRDocument, Style, SvgOptions } from './style.cjs';
export declare const VERSION = "0.1.0";
export { ECC_LEVELS, QRCode, QRKudeError, alignmentPositions, encode, utf8, } from './encode.cjs';
export type { Ecc, EncodeOptions, Mode, QRKudeErrorCode, QRKudeErrorKind } from './encode.cjs';
export { EYE_SHAPES, LOGO_SHAPES, MODULE_SHAPES, TRANSPARENT, cloneStyle, colorAlpha, colorHex, defaultStyle, formatColor, isGradient, linearPaint, parseColor, parseDocument, parseStyle, radialPaint, recommendedEcc, rgba, solidPaint, styleToJson, } from './style.cjs';
export type { Color, DocumentInput, EyeShape, GradientPaint, GradientStop, LabelPosition, LogoShape, ModuleShape, NonePaint, Paint, QRDocument, SolidPaint, Style, SvgOptions, } from './style.cjs';
export { LAYERS, MAX_LENGTH, ballShape, emitLayer, getLayout, gradientGeometry, layerPaint, layerVisible, logoDamage, } from './layout.cjs';
export type { GradientGeometry, Layer, Layout, PathSink } from './layout.cjs';
export { SvgPathWriter, escapeXml, formatNumber, sanitizeIdPrefix, toSvg } from './svg.cjs';
export { LINT_FLAGS, LINT_MESSAGES, lint } from './lint.cjs';
export type { LintFlag } from './lint.cjs';
export { email, event, geo, sms, tel, vcard, wifi } from './payload.cjs';
export type { CalendarEvent, VCard } from './payload.cjs';
export { CanvasPathSink, cssColor, layerToCanvasPath, loadImage, renderToCanvas, toBlob, toDataURL, } from './canvas.cjs';
export type { Canvas2DContext, CanvasGradientLike, CanvasImage, CanvasLike, CanvasPathTarget, CanvasRenderOptions, CanvasRenderResult, ImageExportOptions, } from './canvas.cjs';
/**
 * Encodes with the style's ECC default: when `options.ecc` is absent the
 * level is H if the style has a logo, else M (SPEC 1.3).
 */
export declare function encodeForStyle(data: string | Uint8Array | ArrayLike<number>, options: EncodeOptions | null | undefined, style: Style): QRCode;
/** Everything produced for one payload and document. */
export interface Generated {
    code: QRCode;
    style: Style;
    svgOptions: SvgOptions;
    /** The SVG document. */
    svg: string;
    lint: LintFlag[];
    logoDamage: number;
}
/**
 * Encodes `text` with the document's `encode` options (ECC defaults to H when
 * the style has a logo, else M) and renders it.
 */
export declare function generate(text: string | Uint8Array, doc?: DocumentInput | QRDocument | null): Generated;
/** One-call SVG: `svg('https://kudelink.com', { style: { modules: { shape: 'dot' } } })`. */
export declare function svg(text: string | Uint8Array, doc?: DocumentInput | QRDocument | null): string;
