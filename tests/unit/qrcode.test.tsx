import React from 'react';
import { render } from '@testing-library/react-native';
import { encode, getLayout, toSvg } from '@kudelink/qrkude';
import QRCode, { qrStyle } from '../../components/QRCode';

const ADDRESS = 'tnq1rqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqsqvpjz5x';
// The QR hides its drawing from accessibility: the queries have to look inside.
const hidden = { includeHiddenElements: true };

/** The path data of QRKude's own SVG for `value`, in painting order. */
const svgPaths = (value: string, logoFraction: number) =>
  [...toSvg(encode(value, { ecc: 'H' }), qrStyle(logoFraction)).matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);

describe('QRCode', () => {
  it('draws the dots, the eyes and the logo cut-out as QRKude lays them out', () => {
    const view = render(<QRCode value={ADDRESS} size={300} logoSize={75} isMenuAvailable={false} />);
    const drawn = ['qr-modules', 'qr-eyeFrames', 'qr-eyeBalls', 'qr-logoBackground'].map(id => view.getByTestId(id, hidden).props.d);
    expect(drawn).toEqual(svgPaths(ADDRESS, 0.25));

    const layout = getLayout(encode(ADDRESS, { ecc: 'H' }), qrStyle(0.25));
    const logo = view.getByTestId('qr-logo-image', hidden).props;
    expect([logo.x, logo.y, logo.width]).toEqual([layout.logoX, layout.logoY, layout.logoSize]);
    expect(logo.x + logo.width / 2).toBeCloseTo(layout.width / 2);
  });

  it('keeps the logo small enough for the code to read', () => {
    const view = render(<QRCode value={ADDRESS} size={200} logoSize={150} isMenuAvailable={false} />);
    expect(view.getByTestId('qr-logo-image', hidden).props.width).toBe(getLayout(encode(ADDRESS, { ecc: 'H' }), qrStyle(0.3)).logoSize);
  });

  it('leaves the center to the code without a logo', () => {
    const view = render(<QRCode value={ADDRESS} isLogoRendered={false} isMenuAvailable={false} />);
    expect(view.queryByTestId('qr-logo-image', hidden)).toBeNull();
    expect(view.queryByTestId('qr-logoBackground', hidden)).toBeNull();
    expect(view.getByTestId('qr-modules', hidden).props.d).toBe(svgPaths(ADDRESS, 0)[0]);
  });

  it('shows a placeholder when the value does not fit in a QR code', () => {
    const onError = jest.fn();
    const view = render(<QRCode value={'x'.repeat(4000)} isMenuAvailable={false} onError={onError} />);
    expect(view.getByTestId('qr-placeholder', hidden)).toBeTruthy();
    expect(onError).toHaveBeenCalled();
  });
});
