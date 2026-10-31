/** Object members in document order (duplicates are kept). */
export declare class JsonObject {
    readonly entries: [string, JsonValue][];
    constructor(entries: [string, JsonValue][]);
}
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
/** Deepest allowed object/array nesting (the top-level object is level 1). */
export declare const MAX_DEPTH = 64;
/** Longest allowed number token. */
export declare const MAX_NUMBER_LENGTH = 400;
/** Parses a JSON document. Like the reference reader, trailing text after
 * the first value is ignored. */
export declare function parseJson(text: string): JsonValue;
/** Converts a plain JavaScript value into the reader's value model, with the
 * same limits (non-finite numbers and nesting deeper than 64 are parse errors,
 * which also rejects cyclic objects). `undefined` members are dropped. */
export declare function fromPlain(v: unknown, depth?: number): JsonValue;
