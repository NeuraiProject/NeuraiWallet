import { EncodeOptions, QRCode } from './encode.mjs';
import { LintFlag } from './lint.mjs';
import { DocumentInput, QRDocument, Style, SvgOptions } from './style.mjs';
export declare const VERSION = "0.1.0";
export { ECC_LEVELS, QRCode, QRKudeError, alignmentPositions, encode, utf8, } from './encode.mjs';
export type { Ecc, EncodeOptions, Mode, QRKudeErrorCode, QRKudeErrorKind } from './encode.mjs';
export { EYE_SHAPES, LOGO_SHAPES, MODULE_SHAPES, TRANSPARENT, cloneStyle, colorAlpha, colorHex, defaultStyle, formatColor, isGradient, linearPaint, parseColor, parseDocument, parseStyle, radialPaint, recommendedEcc, rgba, solidPaint, styleToJson, } from './style.mjs';
export type { Color, DocumentInput, EyeShape, GradientPaint, GradientStop, LabelPosition, LogoShape, ModuleShape, NonePaint, Paint, QRDocument, SolidPaint, Style, SvgOptions, } from './style.mjs';
export { LAYERS, MAX_LENGTH, ballShape, emitLayer, getLayout, gradientGeometry, layerPaint, layerVisible, logoDamage, } from './layout.mjs';
export type { GradientGeometry, Layer, Layout, PathSink } from './layout.mjs';
export { SvgPathWriter, escapeXml, formatNumber, sanitizeIdPrefix, toSvg } from './svg.mjs';
export { LINT_FLAGS, LINT_MESSAGES, lint } from './lint.mjs';
export type { LintFlag } from './lint.mjs';
export { email, event, geo, sms, tel, vcard, wifi } from './payload.mjs';
export type { CalendarEvent, VCard } from './payload.mjs';
export { CanvasPathSink, cssColor, layerToCanvasPath, loadImage, renderToCanvas, toBlob, toDataURL, } from './canvas.mjs';
export type { Canvas2DContext, CanvasGradientLike, CanvasImage, CanvasLike, CanvasPathTarget, CanvasRenderOptions, CanvasRenderResult, ImageExportOptions, } from './canvas.mjs';
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
