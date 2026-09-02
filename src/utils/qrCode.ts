import QRCode from 'qrcode';

// One stable QR code per machine, deterministic from its Equipment ID --
// scan the same machine's tag next week and it decodes to the exact same
// code, which is what makes a real per-machine rental history possible.
//
// It encodes a real URL (this app's own address + ?scan=<id>), the same way
// Caterpillar's actual "Cat QR Codes" work on real machines: any phone's
// stock camera app reads it and opens the link directly -- no scanner app,
// no in-app camera feature needed. App.tsx watches for that ?scan= param on
// load and opens the pre-filled check-in/out form for that machine.
export function generateAssetQrCode(assetId: string): Promise<string> {
  // VITE_APP_URL is needed when the dashboard itself is opened on localhost
  // but a physical phone scans the tag. Set it to the computer's LAN URL so
  // the phone reaches this server instead of its own localhost.
  const url = new URL(import.meta.env.VITE_APP_URL || window.location.origin);
  url.searchParams.set('scan', assetId);

  return QRCode.toDataURL(url.toString(), {
    width: 320,
    margin: 2,
    color: { dark: '#1D1D1F', light: '#FFFFFF' },
  });
}
