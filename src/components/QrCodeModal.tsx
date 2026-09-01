import React, { useEffect, useState } from 'react';
import { X, Printer, Tag } from 'lucide-react';
import { Asset } from '../types';
import { generateAssetQrCode } from '../utils/qrCode';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
}

export const QrCodeModal: React.FC<QrCodeModalProps> = ({ isOpen, onClose, asset }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && asset) {
      generateAssetQrCode(asset.id).then(setQrDataUrl);
    } else {
      setQrDataUrl(null);
    }
  }, [isOpen, asset]);

  if (!isOpen || !asset) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-neutral-900 text-[#FFCD00]">
            <Tag className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">Machine QR Tag</h3>
            <p className="text-[11px] text-neutral-500">Permanent identifier for this unit — scan to check it in/out</p>
          </div>
        </div>

        <div id="qr-print-area" className="flex flex-col items-center gap-2 py-2">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR code for ${asset.id}`} className="w-56 h-56" />
          ) : (
            <div className="w-56 h-56 flex items-center justify-center text-xs text-neutral-400">
              Generating...
            </div>
          )}
          <div className="text-center">
            <div className="font-mono font-bold text-neutral-900">{asset.id}</div>
            <div className="text-xs text-neutral-500">{asset.model}</div>
          </div>
        </div>

        <button
          onClick={() => window.print()}
          className="w-full py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
        >
          <Printer className="w-3.5 h-3.5" />
          Print Tag
        </button>
      </div>
    </div>
  );
};
