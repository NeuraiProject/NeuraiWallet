// Opening an `xna:` payment request.
//
// The scheme is registered on both platforms, so a request can arrive with no
// wallet in context. What matters here is that the user is never dropped into a
// send screen without a wallet to spend from, and that a single wallet skips the
// chooser instead of asking a question with one answer.

import { openNeuraiPaymentUri } from '../../helpers/open-neurai-payment';
import type { TWallet } from '../../class/wallets/types';

const wallet = (id: string, allowSend = true) => ({ getID: () => id, allowSend: () => allowSend }) as unknown as TWallet;

const PAYMENT = { address: 'NX7syqGJzweY57vW2K1D9G3kn8DXSq9Azc', amount: '2.5' };

describe('openNeuraiPaymentUri', () => {
  it('goes straight to the send screen when only one wallet can spend', () => {
    const calls: unknown[][] = [];
    const navigation = { navigate: (...args: unknown[]) => calls.push(args) };

    expect(openNeuraiPaymentUri(navigation as never, [wallet('a'), wallet('watch-only', false)], PAYMENT)).toBe(true);
    expect(calls).toEqual([['SendNeurai', { walletID: 'a', address: PAYMENT.address, amount: 2.5 }]]);
  });

  it('leaves the amount out when the request does not carry one', () => {
    const calls: unknown[][] = [];
    const navigation = { navigate: (...args: unknown[]) => calls.push(args) };

    openNeuraiPaymentUri(navigation as never, [wallet('a')], { address: PAYMENT.address });
    expect(calls[0][1]).toEqual({ walletID: 'a', address: PAYMENT.address, amount: undefined });
  });

  it('asks which wallet to spend from when there is more than one', () => {
    const calls: unknown[][] = [];
    const navigation = { navigate: (...args: unknown[]) => calls.push(args) };

    expect(openNeuraiPaymentUri(navigation as never, [wallet('a'), wallet('b')], PAYMENT)).toBe(true);
    const [screen, params] = calls[0] as [string, Record<string, unknown>];
    expect(screen).toBe('SelectWallet');
    expect((params.availableWallets as TWallet[]).map(w => w.getID())).toEqual(['a', 'b']);
    expect(params.onChainRequireSend).toBe(true);

    // Choosing one closes the chooser before sending, so the back button does not
    // land the user on the wallet list they already left.
    const inner: unknown[][] = [];
    const wrapper = { pop: () => inner.push(['pop']), navigate: (...args: unknown[]) => inner.push(args) };
    (params.onWalletSelect as (w: TWallet, ctx: unknown) => void)(wallet('b'), { navigation: wrapper });
    expect(inner).toEqual([['pop'], ['SendNeurai', { walletID: 'b', address: PAYMENT.address, amount: 2.5 }]]);
  });

  it('refuses instead of navigating when no wallet can spend', () => {
    const calls: unknown[][] = [];
    const navigation = { navigate: (...args: unknown[]) => calls.push(args) };

    expect(openNeuraiPaymentUri(navigation as never, [wallet('watch-only', false)], PAYMENT)).toBe(false);
    expect(openNeuraiPaymentUri(navigation as never, [], PAYMENT)).toBe(false);
    expect(calls).toEqual([]);
  });
});
