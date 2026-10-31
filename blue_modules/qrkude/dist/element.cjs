/*! @kudelink/qrkude 0.1.0 | Copyright 2026 The QRKude Authors | SPDX-License-Identifier: Apache-2.0 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/element.ts
var element_exports = {};
__export(element_exports, {
  QRKudeElement: () => QRKudeElement,
  defineQRKudeElement: () => defineQRKudeElement
});
module.exports = __toCommonJS(element_exports);
var import_index = require("./index.cjs");
var ATTRIBUTES = [
  "value",
  "config",
  "module-shape",
  "eye-frame",
  "eye-ball",
  "color",
  "background",
  "logo",
  "label",
  "ecc",
  "margin",
  "size"
];
var Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {
};
var STYLE = `:host{display:inline-block;width:256px;line-height:0;vertical-align:middle}
:host([hidden]){display:none}
.qr{width:100%}
svg{display:block;width:100%;height:auto}`;
function warn(message) {
  if (typeof console !== "undefined") console.warn(`<qr-kude>: ${message}`);
}
var QRKudeElement = class extends Base {
  constructor() {
    super();
    /** Last rendered SVG markup ("" before the first render or after an error). */
    this.svg = "";
    /** Last encoded symbol. */
    this.code = null;
    /** Lint flags of the last render. */
    this.lintFlags = [];
    /** Last error, if the last render failed. */
    this.error = null;
    this.configValue = null;
    this.queued = false;
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.sizeRule = document.createElement("style");
    this.container = document.createElement("div");
    this.container.className = "qr";
    this.container.setAttribute("part", "code");
    this.container.setAttribute("role", "img");
    root.append(style, this.sizeRule, this.container);
  }
  static get observedAttributes() {
    return ATTRIBUTES.slice();
  }
  connectedCallback() {
    this.render();
  }
  attributeChangedCallback() {
    this.schedule();
  }
  /** The encoded text. */
  get value() {
    return this.getAttribute("value") || "";
  }
  set value(v) {
    this.setAttribute("value", v);
  }
  /** The style document. Strings are reflected to the `config` attribute;
   * objects are kept as a property. */
  get config() {
    return this.configValue !== null ? this.configValue : this.getAttribute("config");
  }
  set config(v) {
    if (typeof v === "string" || v === null) {
      this.configValue = null;
      if (v === null) this.removeAttribute("config");
      else this.setAttribute("config", v);
    } else {
      this.configValue = v;
      this.schedule();
    }
  }
  schedule() {
    if (this.queued) return;
    this.queued = true;
    Promise.resolve().then(() => {
      this.queued = false;
      if (this.isConnected) this.render();
    });
  }
  /** Builds the document from `config` plus the shortcut attributes. */
  document() {
    const doc = (0, import_index.parseDocument)(this.config || null);
    const s = doc.style;
    const attr = (name) => this.getAttribute(name);
    const shape = attr("module-shape");
    if (shape) {
      if (import_index.MODULE_SHAPES.indexOf(shape) >= 0) s.modules.shape = shape;
      else warn(`unknown module-shape "${shape}"`);
    }
    for (const [name, key] of [["eye-frame", "frame"], ["eye-ball", "ball"]]) {
      const v = attr(name);
      if (!v) continue;
      if (import_index.EYE_SHAPES.indexOf(v) >= 0) s.eyes[key] = v;
      else warn(`unknown ${name} "${v}"`);
    }
    const color = attr("color");
    if (color) {
      const c = (0, import_index.parseColor)(color.trim());
      if (c !== null) s.modules.color = (0, import_index.solidPaint)(c);
      else warn(`invalid color "${color}"`);
    }
    const background = attr("background");
    if (background) {
      if (background === "none") s.background.color = { type: "none" };
      else {
        const c = (0, import_index.parseColor)(background.trim());
        if (c !== null) s.background.color = (0, import_index.solidPaint)(c);
        else warn(`invalid background "${background}"`);
      }
    }
    const logo = attr("logo");
    if (logo) {
      s.logo.href = logo;
      if (!(s.logo.size > 0)) s.logo.size = 0.2;
    }
    const label = attr("label");
    if (label !== null) s.label.text = label;
    const margin = attr("margin");
    if (margin !== null && margin.trim() !== "" && isFinite(Number(margin))) s.margin = Number(margin);
    const ecc = attr("ecc");
    if (ecc) {
      if (ecc === "L" || ecc === "M" || ecc === "Q" || ecc === "H") doc.encode.ecc = ecc;
      else warn(`invalid ecc "${ecc}"`);
    }
    return doc;
  }
  /** Renders synchronously (normally done automatically). */
  render() {
    const size = this.getAttribute("size");
    const px = size !== null && isFinite(parseFloat(size)) ? parseFloat(size) : 0;
    this.sizeRule.textContent = px > 0 ? `:host{width:${px}px}` : "";
    try {
      const doc = this.document();
      const code = (0, import_index.encodeForStyle)(this.value, doc.encode, doc.style);
      const markup = (0, import_index.toSvg)(code, doc.style, doc.svg);
      this.code = code;
      this.svg = markup;
      this.error = null;
      this.lintFlags = (0, import_index.lint)(code, doc.style);
      this.container.innerHTML = markup;
      this.container.setAttribute("aria-label", `QR code: ${this.value}`);
      const detail = {
        svg: markup,
        code,
        lint: this.lintFlags,
        logoDamage: (0, import_index.logoDamage)(code, doc.style)
      };
      this.dispatchEvent(new CustomEvent("qrkude-render", { detail }));
    } catch (err) {
      this.code = null;
      this.svg = "";
      this.lintFlags = [];
      this.error = err instanceof Error ? err : new Error(String(err));
      this.container.innerHTML = "";
      this.dispatchEvent(new CustomEvent("qrkude-error", { detail: { error: this.error } }));
    }
  }
};
var baseDefined = false;
function defineQRKudeElement(name = "qr-kude") {
  if (typeof customElements === "undefined" || customElements.get(name)) return;
  customElements.define(name, baseDefined ? class extends QRKudeElement {
  } : QRKudeElement);
  baseDefined = true;
}
defineQRKudeElement();
