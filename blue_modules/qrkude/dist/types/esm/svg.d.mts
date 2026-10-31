import { QRCode } from './encode.mjs';
import { PathSink } from './layout.mjs';
import { Style, SvgOptions } from './style.mjs';
/**
 * Formats a number the way every QRKude port does: rounded half up to at most
 * 3 decimals, trailing zeros removed (`0.0625 -> "0.063"`, `-0.0625 -> "-0.062"`).
 * NaN and values with `|v| >= 1e15` format as `"0"`.
 */
export declare function formatNumber(value: number): string;
/** Escapes `& < > "` for SVG text and attribute values and drops control
 * characters other than tab, LF and CR (SPEC 8.3). Non-string input is
 * converted with String() first. */
export declare function escapeXml(value: string): string;
/** Path sink that writes SVG path data (`M`, `H`, `V`, `L`, `A`, `Z`). */
export declare class SvgPathWriter implements PathSink {
    private parts;
    private lx;
    private ly;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arcTo(r: number, clockwise: boolean, x: number, y: number): void;
    close(): void;
    toString(): string;
}
/**
 * Gradient id prefix (SPEC 8.3): every byte of the UTF-8 encoding outside
 * `[A-Za-z0-9_-]` becomes `_`, a leading digit or `-` gets a `q` in front, and
 * an empty or absent prefix is `qrk`. The result can never carry markup.
 */
export declare function sanitizeIdPrefix(prefix: string | null | undefined): string;
/** Writes the SVG document of a code with a style (docs/SPEC.md section 8). */
export declare function toSvg(code: QRCode, style: Style, options?: SvgOptions): string;
