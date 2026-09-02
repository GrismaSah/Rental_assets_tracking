import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X, KeyboardIcon } from 'lucide-react';

interface QrScannerProps {
  onDetect: (assetId: string) => void;
  onClose: () => void;
}

// Reads a real QR code from the device camera (jsQR decodes raw video
// frames -- no fake/simulated scan). Accepts either this app's own QR
// payload (a URL with a ?scan=<id> param, see src/utils/qrCode.ts) or a
// bare asset ID string. A manual text-entry fallback is always shown
// alongside the camera view for devices without one, or when the camera
// permission is denied -- clearly a manual lookup, not a fabricated scan.
function extractAssetId(data: string): string | null {
  try {
    const url = new URL(data);
    const id = url.searchParams.get('scan');
    if (id) return id;
  } catch {
    // not a URL -- fall through to bare-ID matching below
  }
  return /^[A-Za-z0-9-]{3,20}$/.test(data.trim()) ? data.trim() : null;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onDetect, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const detectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access. Use manual entry below.');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err: Error) => {
        setCameraError(`Camera unavailable: ${err.message}. Use manual entry below.`);
      });

    function tick() {
      if (detectedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (code) {
            const assetId = extractAssetId(code.data);
            if (assetId) {
              detectedRef.current = true;
              onDetect(assetId);
              return;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-neutral-950/75 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-2xl border border-black/5 shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-neutral-700" />
            <h3 className="text-sm font-bold text-neutral-900">Scan Equipment QR Code</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {cameraError ? (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">{cameraError}</div>
          ) : (
            <div className="relative rounded-xl overflow-hidden bg-neutral-900 aspect-square">
              <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
              <div className="absolute inset-8 border-2 border-[#FFCD00] rounded-xl pointer-events-none" />
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}
          <p className="text-[11px] text-neutral-500 text-center">Point the camera at the machine's printed QR tag.</p>

          <div className="pt-2 border-t border-neutral-100 space-y-2">
            <label className="text-[11px] font-bold text-neutral-600 flex items-center gap-1.5">
              <KeyboardIcon className="w-3.5 h-3.5" /> Or enter the Asset ID manually
            </label>
            <div className="flex gap-2">
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="e.g. EQX1001"
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
              />
              <button
                type="button"
                onClick={() => manualId.trim() && onDetect(manualId.trim())}
                disabled={!manualId.trim()}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-neutral-900 text-white disabled:opacity-40"
              >
                Use ID
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
