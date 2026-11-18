import QRCode from 'qrcode';
import { env } from '../../config/env';

export type QrFormat = 'png' | 'svg';

export const QR_CONTENT_TYPES: Record<QrFormat, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
};

/** URL khách mở khi quét QR: `${CLIENT_URL}/t/${qrToken}`. */
export function buildTableQrUrl(qrToken: string): string {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}/t/${encodeURIComponent(qrToken)}`;
}

const qrOptions = (size: number) => ({
  width: size,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
});

export async function renderQrPng(content: string, size: number): Promise<Buffer> {
  return QRCode.toBuffer(content, { ...qrOptions(size), type: 'png' });
}

export async function renderQrSvg(content: string, size: number): Promise<string> {
  return QRCode.toString(content, { ...qrOptions(size), type: 'svg' });
}

export async function renderQr(content: string, format: QrFormat, size: number): Promise<Buffer> {
  return format === 'png'
    ? renderQrPng(content, size)
    : Buffer.from(await renderQrSvg(content, size), 'utf8');
}
