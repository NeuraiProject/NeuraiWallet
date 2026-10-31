/** Error correction level, from lowest (~7% recovery) to highest (~30%). */
export type Ecc = 'L' | 'M' | 'Q' | 'H';
/** Data mode of the single segment. */
export type Mode = 'numeric' | 'alphanumeric' | 'byte';
/** Encoder options (the `encode` object of a style document). */
export interface EncodeOptions {
    /** Minimum error correction level. Default `"M"`. */
    ecc?: Ecc;
    /** Smallest version to try, 1..40. Default 1. */
    minVersion?: number;
    /** Largest version to try, 1..40. Default 40. */
    maxVersion?: number;
    /** -1 = automatic (default), 0..7 = forced mask. */
    mask?: number;
    /** Raise the ECC level while the chosen version still fits. Default true. */
    boostEcc?: boolean;
    /** Prepend an ECI designator 26 (UTF-8). Default false. */
    eci?: boolean;
}
/** Error codes thrown as {@link QRKudeError}. */
export type QRKudeErrorCode = 'invalid-argument' | 'data-too-long' | 'parse';
/** The cross-port error kinds of SPEC 2.0. */
export type QRKudeErrorKind = 'parse error' | 'invalid argument' | 'data too long';
export declare class QRKudeError extends Error {
    readonly code: QRKudeErrorCode;
    /** `"parse error"`, `"invalid argument"` or `"data too long"`. */
    readonly kind: QRKudeErrorKind;
    constructor(code: QRKudeErrorCode, message: string);
}
export declare const ECC_LEVELS: readonly Ecc[];
/** An encoded QR symbol: an immutable `size` x `size` module matrix. */
export declare class QRCode {
    /** 1..40 */
    readonly version: number;
    /** Modules per side (`4 * version + 17`). */
    readonly size: number;
    /** ECC level actually used (after boosting). */
    readonly ecc: Ecc;
    /** Mask pattern 0..7. */
    readonly mask: number;
    /** Data mode of the payload. */
    readonly mode: Mode;
    /** Row-major modules, 1 = dark. */
    readonly modules: Uint8Array;
    constructor(version: number, ecc: Ecc, mask: number, mode: Mode, modules: Uint8Array);
    /** true = dark module. Out-of-range coordinates return false. */
    isDark(x: number, y: number): boolean;
    /** Rows of booleans (true = dark). */
    toMatrix(): boolean[][];
}
/** Alignment pattern center coordinates for a version (empty for version 1). */
export declare function alignmentPositions(ver: number): number[];
/** UTF-8 bytes of a string (lone surrogates become U+FFFD, like TextEncoder). */
export declare function utf8(text: string): Uint8Array;
/**
 * Encodes text (as UTF-8) or raw bytes. The mode (numeric / alphanumeric /
 * byte) is chosen automatically. Throws {@link QRKudeError} with the message
 * `"data too long"` when no version in range fits.
 */
export declare function encode(data: string | Uint8Array | ArrayLike<number>, options?: EncodeOptions): QRCode;
