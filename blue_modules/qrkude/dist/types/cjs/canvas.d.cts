import { QRCode } from './encode.cjs';
import { Layer, PathSink } from './layout.cjs';
import { Color, Style } from './style.cjs';
/** Anything `drawImage` accepts (HTMLImageElement, ImageBitmap, canvas...). */
export type CanvasImage = any;
/** The path-building part of `CanvasRenderingContext2D` / `Path2D`. */
export interface CanvasPathTarget {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    closePath(): void;
}
export interface CanvasGradientLike {
    addColorStop(offset: number, color: string): void;
}
/** The subset of `CanvasRenderingContext2D` used by the renderer. */
export interface Canvas2DContext extends CanvasPathTarget {
    canvas?: unknown;
    fillStyle: unknown;
    font: string;
    textAlign: string;
    textBaseline: string;
    save(): void;
    restore(): void;
    scale(x: number, y: number): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    beginPath(): void;
    fill(...args: any[]): void;
    fillText(text: string, x: number, y: number): void;
    drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
}
/** An HTMLCanvasElement or OffscreenCanvas. */
export interface CanvasLike {
    width: number;
    height: number;
    getContext(contextId: '2d'): unknown;
}
export interface CanvasRenderOptions {
    /** Output width in CSS pixels (height follows the canvas aspect ratio).
     * Default: the current canvas width. */
    size?: number;
    /** Logo image, aspect-fitted into the logo box. */
    logo?: CanvasImage | null;
    /** Backing-store scale (e.g. `devicePixelRatio`). Default 1. */
    pixelRatio?: number;
    /** Draw the label with fillText (default true). */
    label?: boolean;
}
export interface CanvasRenderResult {
    /** CSS size of the drawing. */
    width: number;
    height: number;
    /** Device pixels per module. */
    scale: number;
}
/** Path sink that builds a canvas path (`Path2D` or a context) with `arc`. */
export declare class CanvasPathSink implements PathSink {
    readonly target: CanvasPathTarget;
    private x;
    private y;
    private sx;
    private sy;
    constructor(target: CanvasPathTarget);
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arcTo(r: number, clockwise: boolean, x: number, y: number, cx: number, cy: number): void;
    close(): void;
}
/** Appends the geometry of one layer (in canvas units) to a Path2D or a
 * context path. Returns the number of sub-paths. */
export declare function layerToCanvasPath(target: CanvasPathTarget, code: QRCode, style: Style, layer: Layer): number;
/** CSS color string of a 0xRRGGBBAA color. */
export declare function cssColor(c: Color): string;
/**
 * Renders a code onto a canvas (resized to `size` x `size * H / W` times the
 * pixel ratio) or into an existing 2D context (drawn at the origin of its
 * current transform). Layers are drawn in SVG order with Path2D; gradients use
 * the exact SVG gradient geometry; the label is drawn with fillText.
 */
export declare function renderToCanvas(target: CanvasLike | Canvas2DContext, code: QRCode, style: Style, options?: CanvasRenderOptions): CanvasRenderResult;
export interface ImageExportOptions extends CanvasRenderOptions {
    /** MIME type, default "image/png". */
    type?: string;
    /** JPEG / WebP quality 0..1. */
    quality?: number;
}
/** Loads an image (URL or data: URI) for use as a canvas logo. */
export declare function loadImage(src: string): Promise<CanvasImage>;
/** Renders to a new canvas and returns a data URL (PNG by default). The logo
 * is loaded from `style.logo.href` unless `options.logo` is given (null = none). */
export declare function toDataURL(code: QRCode, style: Style, options?: ImageExportOptions): Promise<string>;
/** Renders to a new canvas and returns an image Blob (PNG by default). */
export declare function toBlob(code: QRCode, style: Style, options?: ImageExportOptions): Promise<Blob>;
