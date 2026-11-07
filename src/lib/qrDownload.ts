/** 画面に表示している QR コード（SVG）を画像として保存する */

function triggerDownload(href: string, fileName: string, revoke?: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // すぐに URL を破棄すると、Safari や Firefox で保存が始まらないことがあるので少し待つ
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(revoke), 10_000);
}

function svgBlobUrl(svg: SVGSVGElement): string {
  const source = new XMLSerializer().serializeToString(svg);
  return URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
}

/** ファイル名に使えない文字を「_」にする */
export function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'qr-code';
}

export function downloadSvg(svg: SVGSVGElement | null | undefined, fileName: string) {
  if (!svg) return;
  const url = svgBlobUrl(svg);
  triggerDownload(url, fileName, url);
}

export function downloadPng(svg: SVGSVGElement | null | undefined, size: number, fileName: string) {
  if (!svg) return;
  const url = svgBlobUrl(svg);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    triggerDownload(canvas.toDataURL('image/png'), fileName);
    URL.revokeObjectURL(url);
  };
  image.src = url;
}
