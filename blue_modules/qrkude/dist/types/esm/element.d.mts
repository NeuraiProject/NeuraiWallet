import { DocumentInput, LintFlag, QRCode, QRDocument } from './index.mjs';
/** Detail of the `qrkude-render` event. */
export interface QRKudeRenderDetail {
    svg: string;
    code: QRCode;
    lint: LintFlag[];
    logoDamage: number;
}
declare const Base: typeof HTMLElement;
/**
 * Renders a styled QR code as inline SVG (in its shadow root) and re-renders
 * whenever an attribute changes.
 *
 * Attributes: `value`, `config` (JSON document `{encode, style, svg}` or a bare
 * style), and the shortcuts `module-shape`, `eye-frame`, `eye-ball`, `color`,
 * `background`, `logo` (image URL), `label`, `ecc`, `margin`, `size` (CSS px).
 *
 * Events: `qrkude-render` ({@link QRKudeRenderDetail}), `qrkude-error`
 * (`{ error }`).
 */
export declare class QRKudeElement extends Base {
    static get observedAttributes(): string[];
    /** Last rendered SVG markup ("" before the first render or after an error). */
    svg: string;
    /** Last encoded symbol. */
    code: QRCode | null;
    /** Lint flags of the last render. */
    lintFlags: LintFlag[];
    /** Last error, if the last render failed. */
    error: Error | null;
    private configValue;
    private queued;
    private readonly container;
    private readonly sizeRule;
    constructor();
    connectedCallback(): void;
    attributeChangedCallback(): void;
    /** The encoded text. */
    get value(): string;
    set value(v: string);
    /** The style document. Strings are reflected to the `config` attribute;
     * objects are kept as a property. */
    get config(): DocumentInput | null;
    set config(v: DocumentInput | null);
    private schedule;
    /** Builds the document from `config` plus the shortcut attributes. */
    document(): QRDocument;
    /** Renders synchronously (normally done automatically). */
    render(): void;
}
export declare function defineQRKudeElement(name?: string): void;
export {};
