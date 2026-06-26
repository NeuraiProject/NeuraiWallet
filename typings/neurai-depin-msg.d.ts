// @neuraiproject/neurai-depin-msg ships only a browser IIFE bundle that attaches
// its API to `globalThis.neuraiDepinMsg`; there are no ESM named exports. We
// import the bundle for its side effect and read the typed surface from
// `globalThis` in `blue_modules/neurai/depinMsg.ts`.
declare module '@neuraiproject/neurai-depin-msg/dist/neurai-depin-msg.js';
declare module '@neuraiproject/neurai-depin-msg/dist/neurai-depin-msg.min.js';
