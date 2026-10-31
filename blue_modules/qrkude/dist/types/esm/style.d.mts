import { Ecc, EncodeOptions } from './encode.mjs';
import { JsonObject } from './json.mjs';
/** A color as an unsigned 32-bit integer `0xRRGGBBAA`. */
export type Color = number;
export declare const MODULE_SHAPES: readonly ["square", "dot", "rounded", "diamond", "star", "fluid", "liquid", "bevel", "classy", "hbars", "vbars"];
export type ModuleShape = (typeof MODULE_SHAPES)[number];
export declare const EYE_SHAPES: readonly ["square", "rounded", "circle", "leaf", "drop", "bevel", "diamond", "dots"];
export type EyeShape = (typeof EYE_SHAPES)[number];
export declare const LOGO_SHAPES: readonly ["square", "rounded", "circle"];
export type LogoShape = (typeof LOGO_SHAPES)[number];
export type LabelPosition = 'bottom' | 'top';
export interface GradientStop {
    /** 0..1 */
    offset: number;
    color: Color;
}
/** No paint: transparent, or "same as modules" for the eye paints. */
export interface NonePaint {
    type: 'none';
}
export interface SolidPaint {
    type: 'solid';
    color: Color;
}
export interface GradientPaint {
    type: 'linear' | 'radial';
    /** Linear: degrees, 0 = left to right, 90 = top to bottom. */
    angle: number;
    /** Radial center and radius, relative to the painted area. */
    cx: number;
    cy: number;
    r: number;
    /** At most 8 stops are used. */
    stops: GradientStop[];
}
export type Paint = NonePaint | SolidPaint | GradientPaint;
/** A fully resolved style (see docs/SPEC.md section 2). */
export interface Style {
    /** Quiet zone in modules. */
    margin: number;
    modules: {
        shape: ModuleShape;
        /** 0.1..1 (square, dot, rounded, diamond, star, bars). */
        size: number;
        /** 0..1 (rounded, fluid, liquid, bevel, classy, bars). */
        roundness: number;
        color: Paint;
    };
    eyes: {
        frame: EyeShape;
        ball: EyeShape;
        /** `none` = same as modules. */
        frameColor: Paint;
        ballColor: Paint;
    };
    alignment: {
        /** null = draw alignment patterns as data modules. */
        frame: EyeShape | null;
        /** null = square (when frame is set). */
        ball: EyeShape | null;
    };
    background: {
        /** `none` = transparent. */
        color: Paint;
        radius: number;
    };
    border: {
        width: number;
        color: Color;
    };
    logo: {
        /** Fraction of the symbol width; 0 = no logo. */
        size: number;
        /** Clear space around the logo, in modules. */
        margin: number;
        shape: LogoShape;
        /** Remove the modules behind the logo area. */
        excavate: boolean;
        /** Fill of the logo area (alpha 0 = none). */
        background: Color;
        /** Image URL or data: URI (SVG output). */
        href: string | null;
    };
    label: {
        /** null / empty = no label. */
        text: string | null;
        font: string | null;
        /** Font size in modules. */
        size: number;
        color: Color;
        position: LabelPosition;
        bold: boolean;
    };
}
/** SVG writer options. */
export interface SvgOptions {
    /** width attribute in px (0 = omit width/height). */
    width?: number;
    /** Gradient id prefix (default "qrk"). */
    idPrefix?: string | null;
}
/** A parsed `{encode, style, svg}` document. `encode` only contains the keys
 * present in the input, so `encode.ecc === undefined` means "use the default
 * rule" (H with a logo, else M). */
export interface QRDocument {
    encode: EncodeOptions;
    style: Style;
    svg: SvgOptions;
}
export declare const TRANSPARENT: Color;
/** Builds a color from 0..255 channels. */
export declare function rgba(r: number, g: number, b: number, a?: number): Color;
/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa` or `transparent`; null if invalid. */
export declare function parseColor(str: string): Color | null;
/** `#rrggbb` (lower case, alpha dropped). */
export declare function colorHex(c: Color): string;
/** `#rrggbb` or `#rrggbbaa` when not opaque (round-trips through parseColor). */
export declare function formatColor(c: Color): string;
/** Alpha channel 0..255. */
export declare function colorAlpha(c: Color): number;
export declare function solidPaint(color: Color): SolidPaint;
export declare function linearPaint(angle: number, from: Color, to: Color): GradientPaint;
export declare function radialPaint(center: Color, edge: Color): GradientPaint;
export declare function isGradient(p: Paint): p is GradientPaint;
/** The default style (classic black squares on white, 4-module quiet zone). */
export declare function defaultStyle(): Style;
/** Deep copy of a style. */
export declare function cloneStyle(s: Style): Style;
/** HIGH when the style has a logo, else MEDIUM. */
export declare function recommendedEcc(style: Style): Ecc;
/** JSON text, or the equivalent plain object. */
export type DocumentInput = string | Record<string, unknown> | JsonObject;
/**
 * Parses a style document: `{"encode": {...}, "style": {...}, "svg": {...}}`
 * or a bare style object (top-level style keys are accepted too). Members
 * apply in document order: a repeated object merges field by field, scalars
 * and paints replace. Missing keys keep their defaults; unknown keys are
 * ignored. Throws {@link QRKudeError} (kind `"parse error"`) on malformed
 * input, including the limits of SPEC 2.0 (number tokens over 400
 * characters, non-finite numbers, nesting deeper than 64).
 */
export declare function parseDocument(input: DocumentInput | null | undefined): QRDocument;
/** Parses a style (bare or wrapped in a document) on top of the defaults. */
export declare function parseStyle(input: DocumentInput | null | undefined): Style;
/** Converts a style back to its JSON object form (round-trips through
 * {@link parseStyle}). */
export declare function styleToJson(s: Style): Record<string, unknown>;
