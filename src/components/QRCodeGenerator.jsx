/**
 * QR Code Generator Component
 * Generates QR codes for payment links using qrcode library
 */

import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

const QRCodeGenerator = ({ value, size = 256, className = "" }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!value || !canvasRef.current) return;

    const generateQR = async () => {
      try {
        await QRCode.toCanvas(canvasRef.current, value, {
          width: size,
          margin: 2,
          color: {
            dark: '#10B981', // Emerald-500
            light: '#000000', // Black background
          },
        });
      } catch (error) {
        console.error('Error generating QR code:', error);
      }
    };

    generateQR();
  }, [value, size]);

  if (!value) {
    return (
      <div 
        className={`flex items-center justify-center bg-black border border-green-500/20 rounded ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-green-400/50 text-sm">No data</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <canvas 
        ref={canvasRef}
        className="border border-green-500/30 rounded"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
};

export default QRCodeGenerator;
