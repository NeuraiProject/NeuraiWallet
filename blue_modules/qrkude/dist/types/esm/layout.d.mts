import { QRCode } from './encode.mjs';
import { EyeShape, Paint, Style } from './style.mjs';
/** Drawing layers, in painting order. */
export type Layer = 'background' | 'border' | 'modules' | 'eyeFrames' | 'eyeBalls' | 'logoBackground';
export declare const LAYERS: readonly Layer[];
/**
 * Receives the geometry of a layer. All coordinates are in modules (canvas
 * units, y down). All sub-paths are closed; fill with the non-zero rule.
 * `arcTo` draws a circular arc of radius `r` from the current point to
 * `(x, y)` around the center `(cx, cy)`; `clockwise` refers to the screen.
 * Arcs never exceed 90 degrees.
 */
export interface PathSink {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arcTo(r: number, clockwise: boolean, x: number, y: number, cx: number, cy: number): void;
    close(): void;
}
/** Canvas layout in modules. */
export interface Layout {
    /** Whole canvas. */
    width: number;
    height: number;
    /** Top-left of module (0, 0). */
    symbolX: number;
    symbolY: number;
    /** Modules per side. */
    modules: number;
    hasLogo: boolean;
    /** Logo image box (square). */
    logoX: number;
    logoY: number;
    logoSize: number;
    hasLabel: boolean;
    /** Text anchor (middle) and baseline. */
    labelX: number;
    labelBaseline: number;
    /** Clamped label font size. */
    labelSize: number;
}
/** Gradient geometry in canvas units, as written to the SVG. */
export interface GradientGeometry {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx: number;
    cy: number;
    r: number;
}
/** Upper bound for lengths given in modules (margin, border, label size...). */
export declare const MAX_LENGTH = 1000;
/** Ball shape actually drawn: dots become a circle, invalid becomes square. */
export declare function ballShape(shape: EyeShape | null | undefined): EyeShape;
/** Paint used by a layer (eye paints resolved, border / logo background as solid). */
export declare function layerPaint(style: Style, layer: Layer): Paint;
/**
 * Whether a layer paints anything (SPEC 8.5): its resolved paint has at least
 * one color with alpha > 0 (a solid color, or any of the first 8 gradient
 * stops), and the border has a width > 0, the logo background has a logo, the
 * modules have at least one sub-path. A hint for renderers that skip
 * invisible layers; the SVG writer keeps its own rules.
 */
export declare function layerVisible(code: QRCode, style: Style, layer: Layer): boolean;
/** Gradient geometry of a layer's paint, in canvas units. */
export declare function gradientGeometry(code: QRCode, style: Style, layer: Layer): GradientGeometry;
/** Canvas layout of a code with a style. */
export declare function getLayout(code: QRCode, style: Style): Layout;
/**
 * Emits the geometry of one layer into a path sink (pass null to only count).
 * Returns the number of sub-paths. This is the shape model shared by the SVG
 * writer and the canvas renderer.
 */
export declare function emitLayer(code: QRCode, style: Style, layer: Layer, sink?: PathSink | null): number;
/**
 * Worst-case logo damage: max over RS blocks of (codewords hidden by the logo
 * area) / (codewords the block can correct). 0 = no logo; above 1 the symbol
 * cannot be decoded.
 */
export declare function logoDamage(code: QRCode, style: Style): number;
