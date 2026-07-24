import { normalizeAmount, parseRevealed, shortAddr } from '../../components/depinChat/utils';

describe('DePIN chat utilities', () => {
  describe('parseRevealed', () => {
    const compressedPubkey = `02${'a'.repeat(64)}`;

    it('recognizes the RPC revealed flag', () => {
      expect(parseRevealed({ revealed: 1 })).toBe(true);
      expect(parseRevealed({ revealed: 0 })).toBe(false);
    });

    it('recognizes a compressed public key in object and string responses', () => {
      expect(parseRevealed({ pubkey: compressedPubkey })).toBe(true);
      expect(parseRevealed(compressedPubkey)).toBe(true);
    });

    it('keeps unrecognized responses unknown', () => {
      expect(parseRevealed({ pubkey: 'not-a-pubkey' })).toBeNull();
      expect(parseRevealed(null)).toBeNull();
    });
  });

  describe('normalizeAmount', () => {
    it('keeps coin-denominated values unchanged', () => {
      expect(normalizeAmount(1.5)).toBe(1.5);
      expect(normalizeAmount('2.25')).toBe(2.25);
    });

    it('converts satoshi-denominated values to coins', () => {
      expect(normalizeAmount(150_000_000)).toBe(1.5);
    });

    it('falls back to zero for invalid values', () => {
      expect(normalizeAmount('unknown')).toBe(0);
    });
  });

  it('shortens long addresses without changing short ones', () => {
    expect(shortAddr('Nabcdef1234567890')).toBe('Nabcd…67890');
    expect(shortAddr('short')).toBe('short');
  });
});
