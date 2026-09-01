import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, ScanLine, AlertCircle, Keyboard } from 'lucide-react';
import { Asset } from '../types';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: Asset[];
  onScanSuccess: (asset: Asset) => void;
  onUseManualEntry: () => void;
}

const SCAN_REGION_ID = 'qr-scan-region';

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  assets,
  onScanSuccess,
  onUseManualEntry,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const scanner = new Html5Qrcode(SCAN_REGION_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          if (cancelled) return;
          const matched = assets.find((a) => a.id.toLowerCase() === decodedText.trim().toLowerCase());
          if (matched) {
            setNotFoundMsg(null);
            cancelled = true;
            scanner
              .stop()
              .then(() => scanner.clear())
              .catch(() => {})
              .finally(() => onScanSuccess(matched));
          } else {
            setNotFoundMsg(`"${decodedText}" doesn't match any known machine.`);
          }
        },
        () => {
          // Fires continuously while no QR code is in frame -- expected noise, ignore.
        }
      )
      .catch((err) => {
        setCameraError(
          err?.message?.includes('Permission')
            ? 'Camera permission was denied. Allow camera access, or use manual entry below.'
            : 'Could not access a camera on this device. Use manual entry below.'
        );
      });

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-neutral-900 text-[#FFCD00]">
            <ScanLine className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Scan Machine QR Tag</h3>
            <p className="text-[11px] text-neutral-500">Point the camera at a unit's QR code</p>
          </div>
        </div>

        {cameraError ? (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{cameraError}</span>
          </div>
        ) : (
          <div id={SCAN_REGION_ID} className="w-full rounded-xl overflow-hidden bg-neutral-900 aspect-square" />
        )}

        {notFoundMsg && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            {notFoundMsg}
          </div>
        )}

        <button
          onClick={onUseManualEntry}
          className="w-full py-2.5 rounded-xl text-xs font-bold bg-neutral-100 text-neutral-800 hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <Keyboard className="w-3.5 h-3.5" />
          Use Manual Entry Instead
        </button>
      </div>
    </div>
  );
};
