import QRCode from 'qrcode';

// One stable QR code per machine, encoding nothing but its Equipment ID.
// It's generated deterministically from that ID -- scan the same machine's
// tag next week and it decodes to the exact same value, which is what makes
// it possible to build a real per-machine rental history over time instead
// of a one-off code that changes on every checkout.
export function generateAssetQrCode(assetId: string): Promise<string> {
  return QRCode.toDataURL(assetId, {
    width: 320,
    margin: 2,
    color: { dark: '#1D1D1F', light: '#FFFFFF' },
  });
}
