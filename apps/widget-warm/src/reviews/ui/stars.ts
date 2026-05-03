const STAR_PATH =
  'M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z';

export function starsHtml(filled: number, total = 5): string {
  let html = '';
  for (let i = 1; i <= total; i += 1) {
    const cls = i <= filled ? '' : ' class="empty"';
    html += `<svg viewBox="0 0 24 24"${cls}><path fill="currentColor" d="${STAR_PATH}"/></svg>`;
  }
  return html;
}

