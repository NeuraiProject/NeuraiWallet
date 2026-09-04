# Vendored Neurai Connect packages

`@neuraiproject/neurai-connect-core` and `@neuraiproject/neurai-connect-wallet` are the wallet half of
[Neurai Connect](https://github.com/NeuraiProject/neurai-relay) — the QR login and dApp sessions the app
speaks. They are not published to npm yet, so the exact tarballs the app builds against live here and
`package.json` depends on them by path. That keeps `npm ci` reproducible and offline for everyone.

They are replaced by ordinary registry dependencies once the packages are published (a Phase 5 task of
the Neurai Connect plan). To refresh them from a local checkout of that repository:

```bash
npm pack ../neurai-relay/packages/connect-core ../neurai-relay/packages/connect-wallet
mv neuraiproject-neurai-connect-*.tgz vendor/
npm install
```
