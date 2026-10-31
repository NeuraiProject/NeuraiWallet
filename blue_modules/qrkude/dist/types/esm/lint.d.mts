import { QRCode } from './encode.mjs';
import { Style } from './style.mjs';
/** Lint flags, in the order they are reported. */
export declare const LINT_FLAGS: readonly ["logo-risky", "logo-unreadable", "low-contrast", "inverted", "transparent-background", "quiet-zone", "small-modules", "eye-shapes", "invisible"];
export type LintFlag = (typeof LINT_FLAGS)[number];
/** Human-readable explanation of each lint flag. */
export declare const LINT_MESSAGES: Record<LintFlag, string>;
/** Returns the scannability warnings of a code with a style (docs/SPEC.md section 11). */
export declare function lint(code: QRCode, style: Style): LintFlag[];
