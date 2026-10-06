# NeuraiWallet

A mobile wallet for the [Neurai](https://neurai.org) blockchain, built with React Native for
Android and iOS. Keys are generated on the device and stored in the platform keystore; no seed
or private key ever leaves it.

NeuraiWallet is a fork of [BlueWallet](https://github.com/BlueWallet/BlueWallet). The
navigation shell, the theming, the encrypted storage and the settings screens come from there;
the wallet, transaction, asset and messaging layers are Neurai's own and are built on the
`@neuraiproject/*` libraries (`neurai-key`, `neurai-jswallet`, `neurai-create-transaction`,
`neurai-sign-transaction`, `neurai-depin-msg`, `neurai-message`).

## What it does

* **HD wallets** on Neurai's BIP44 path, created from a 12-word mnemonic or imported from one.
* **Post-quantum wallets** signed with ML-DSA-44, using bech32m `AuthScript` addresses.
* **Hardware wallet** support over USB serial for the Neurai ESP32 signer: the device holds the
  seed and signs; the phone only builds and broadcasts.
* **Neurai Assets** — the native tokens of the chain (root, sub, unique/NFT, owner, restricted,
  qualifier and DePIN assets) are listed per wallet and can be sent from the Send screen.
* **DePIN messaging** — a token-gated chat tab (see below).
* **Neurai Connect** — QR login and dApp sessions (see below).
* **Privacy pool (C6, testnet)** — private XNA and asset notes with zero-knowledge proofs built on
  the phone (see below).
* Inherited from BlueWallet and still in use: encrypted storage with plausible deniability,
  biometric unlock on the sensitive screens, "is it my address?" verification, raw transaction
  broadcast, fiat rates and 50+ UI languages.

## Networks

Six chain identifiers are wired in parallel, one per network for each wallet kind: Legacy
P2PKH, ECDSA witness v3 and post-quantum. Switching the active network changes the backend URL,
the address prefixes, the BIP44 coin type and the bech32m HRP in one step. They are defined in
`blue_modules/neurai/networkConfig.ts`:

| Chain | Network | Keys | Addresses | BIP44 coin type |
| --- | --- | --- | --- | --- |
| `xna` | mainnet | legacy ECDSA (secp256k1) | base58, P2PKH version 53 (`N…`) | 1900 |
| `xna-test` | testnet | legacy ECDSA (secp256k1) | base58, P2PKH version 127 | 1 |
| `xna-ecdsa` | mainnet | ECDSA (secp256k1), `m/84'` | bech32m strict ECDSA v3, HRP `nq` (`nq1r…`) | 1900 |
| `xna-ecdsa-test` | testnet | ECDSA (secp256k1), `m/84'` | bech32m strict ECDSA v3, HRP `tnq` (`tnq1r…`) | 1 |
| `xna-pq` | mainnet | post-quantum ML-DSA-44 | bech32m AuthScript v1, HRP `nc` (`nc1p…`) | 1900 |
| `xna-pq-test` | testnet | post-quantum ML-DSA-44 | bech32m strict PQ v2, HRP `tpq` (`tpq1z…`) | 1 |

These are the app's own names. `neurai-key` 5 reuses `xna` / `xna-pq` for other address types,
so every direct call goes through `blue_modules/neurai/keyNetwork.ts`; the Legacy and mainnet PQ
derivations are unchanged (mainnet PQ addresses keep their commitment, re-encoded from the old
`nq1p…`). Testnet was reset with a new genesis: testnet PQ wallets moved to the node's strict PQ
type, and cached testnet state (balances, history, DePIN pins and sessions) from the old chain is
discarded on load (`AbstractNeuraiWallet.fromJson`, `blue_modules/neurai/testnetReset.ts`).

ECDSA and PQ wallets can only be created on testnet for now: the node accepts witness v3 and v2
outputs only where those families are active, so the mainnet options stay disabled until then.
ECDSA wallets use ordinary compressed secp256k1 keys, like Legacy, but the node's DePIN service
only knows Legacy P2PKH addresses, so DePIN messaging stays a Legacy-wallet feature.

Balances, history, UTXOs and broadcast go through `neurai-wallet-services` over WSS by default
(`blue_modules/neurai/WssBackend.ts`), with a JSON-RPC backend as an explicit fallback
(`RpcBackend.ts`). Both endpoints can be overridden per network from Settings → Network.

## DePIN messaging

Neurai's DePIN assets (`&NAME`) carry a chat: holders of the same token can message each other
end to end encrypted, relayed by a DePIN-enabled Neurai node rather than by a server of ours.
The app derives a dedicated chat identity on its own BIP44 account (`m/44'/{coin}'/100'/0/0`,
see `blue_modules/neurai/depinChatIdentity.ts` and `components/DePINChat.tsx`), lists the DePIN
tokens held at that address and opens a group or private conversation per token. Messages are
built, encrypted (ECIES over secp256k1 + AES-256-GCM) and signed by
`@neuraiproject/neurai-depin-msg`, and are wire compatible with the node's `depinsubmitmsg` / `depinreceivemsg` and with the Neurai web wallet.
Group messages need the address's public key to be visible on chain, so the app offers a
one-tap "reveal" that spends a small amount from the chat address. The DePIN node the chat
talks to is configurable from the gear button in the chat (the `DepinRpcEdit` screen).

## Neurai Connect

Neurai Connect is the wallet ↔ web link: a site shows a QR code, the user scans it with
NeuraiWallet, approves on the phone, and the site is either logged in ("Sign in with Neurai",
a CAIP-122 message signed with the chosen address) or holds a dApp session it can later use to
ask the wallet for `getAccountAddresses` and `signMessage` (`sendTransfer` and `signPsbt` are
declared by the `bip122` profile but not implemented yet). Traffic goes through a relay
that only ever sees opaque encrypted blobs and random topics; no private key leaves the device.
The wallet side lives in `blue_modules/neurai/connect/` (relay client, session storage, signer,
per-domain identities) with the approval screens in `screen/connect/`, and pairings arrive as
`nc:` URIs from the scanner or as `neuraiwallet://connect?uri=…` deep links, recognised by
`class/neurai-uri-match.ts`.

## Privacy pool (C6, testnet)

Testnet Legacy and PQ wallets with their words get a **Privacy** button next to the wallet tabs.
It opens the C6 TEST pools pinned in `blue_modules/neurai/privacy/c6-*.json` (the same instances
as the web wallet): one for XNA and one for an ordinary asset, each with its own private balance.
Deposit, assign to `tnzk1…` addresses, withdraw and join two notes; asset operations pay the
miner fee with a separate XNA sponsor coin.

Hermes has no WebAssembly, so the proving side of `@neuraiproject/neurai-privacy` (snarkjs,
Argon2id, pool scanning) runs in a hidden WebView (`components/privacy/PrivacyHost.tsx`). Its
page is bundled from `privacy-host/` by `npm run privacy:host` (run by `postinstall`) into the
git-ignored `blue_modules/neurai/privacy/hostHtml.generated.ts`. The app keeps the library's
worker client, the encrypted journals (`privacy/store.ts`), RPC through the wallet's WSS service
and signing (`privacy/wallet.ts`); `privacy/bridge.ts` relays the worker's messages.

The proving files (~88 MB per instance) are downloaded on first use and kept only if their size
and SHA-256 match the pins in the app, so any HTTPS host will do. By default they come from the
testnet web wallet, which deploys the same pinned files (`https://webwallet-testnet.neurai.org`
plus the manifest's `artifactBaseUrl`, e.g. `/privacy-c6/`); the URL can be changed per pool in
the privacy screen. To mirror them to a GitHub release (`c6-test-<commitment[0:12]>`) instead:

```bash
node scripts/privacy-artifacts-release.mjs xna   ../neurai-webwallet/public/privacy-c6
node scripts/privacy-artifacts-release.mjs asset ../neurai-webwallet/public/privacy-c6-assets/C6ASSET261004A
# verified? add --publish (needs an authenticated GitHub CLI)
```

`privacy-host/e2e/run.sh <artifacts-dir>` checks the WebView page end to end in headless
Chromium (Docker): private wallet derivation, a real pool scan on testnet and a real Groth16
deposit proof whose files cross the bridge.

## Build and run

Node 22.11.0 or newer is required (see the `engines` field in `package.json`). Check yours with
`node --version && npm --version`.

```bash
git clone https://github.com/neuraiproject/NeuraiWallet.git
cd NeuraiWallet
npm install
```

Start the Metro bundler in one terminal:

```bash
npm start
```

Then, in another terminal:

```bash
npm run android        # build and install on a connected device or emulator
npm run ios            # build and run on the iOS simulator
```

For iOS you need the CocoaPods dependencies first (`npx pod-install`), and for macOS via Mac
Catalyst open `ios/BlueWallet.xcworkspace` in Xcode and run the `BlueWallet` scheme (the Xcode
project still carries the upstream name).

Useful extras while developing:

```bash
npm run adb              # adb reverse tcp:8081, so a device can reach Metro
npm run android:relaunch # force-stop and relaunch the installed app
npm run clean            # gradle clean + wipe caches and node_modules, then npm i
npm run clean:ios        # wipe node_modules and Pods, reinstall, reset the Metro cache
npm run android:clean    # gradle clean, then rebuild and run on Android
```

## Tests

```bash
npm test           # everything: lint + unit + integration
npm run lint       # tsc --noEmit, unused-loc-key check, then eslint
npm run lint:fix   # the same, applying eslint's fixes
npm run unit       # jest tests/unit/* only
npm run integration  # jest tests/integration/* (needs test mnemonics in the environment)
```

The unit suite is the one to run while working; it is self-contained and mocks the native
modules in `tests/setup.js`. Integration tests talk to real Neurai endpoints and expect
mnemonics in environment variables. End-to-end tests use Detox on Android:

```bash
npm run e2e:debug         # build a debug APK if needed, then run the e2e suite
npm run e2e:release-test  # run the suite against a release build
```

## Where the code lives

| Directory | What is in it |
| --- | --- |
| `components/` | React components and the context providers (`SettingsProvider`, `StorageProvider`) |
| `class/` | Core business logic, including the wallet implementations in `class/wallets/` |
| `blue_modules/` | Utility modules: currency, encryption, filesystem, and the Neurai network layer in `blue_modules/neurai/` and the ESP32 driver in `blue_modules/neurai-hw/` |
| `screen/` | Screens grouped by feature: `wallets`, `send`, `receive`, `transactions`, `settings`, `connect` |
| `navigation/` | React Navigation setup and the typed param lists |
| `hooks/` | Custom hooks (`useStorage`, `useSettings`, `useBiometrics`, the DePIN chat hooks, …) |
| `loc/` | Localisation; `loc/en.json` is the source, alongside 50+ translations |
| `models/` | Type definitions for units, fiat currencies and block explorers |
| `tests/` | `tests/unit/`, `tests/integration/` and `tests/e2e/` |
| `android/`, `ios/` | The native projects |

Conventions for contributors — TypeScript only, commit-message prefixes, linting rules — are in
[`CLAUDE.md`](CLAUDE.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). Common questions are answered
in [`FAQ.md`](FAQ.md).

## Licence

MIT. See [`LICENSE`](LICENSE). NeuraiWallet derives from BlueWallet, which is also MIT licensed.
