/** Inline SVG icons (drawn for Prism; no third-party icon sets). */

let gradSeq = 0;

/** The Fetchly mark: a sleek lightning-bolt download arrow. */
export function prismMark(size = 18): string {
  const g = `prism-g${++gradSeq}`;
  return `<svg class="prism-mark" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">
<defs><linearGradient id="${g}" x1="20" y1="8" x2="44" y2="56" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#60a5fa"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
<path d="M31 8h11L32.5 24H43L31 38h9.5L29 56 17.5 38H27l6-10H22L31 8z" fill="url(#${g})" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;
}

const s = (body: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  download: (n?: number) => s('<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>', n),
  chevronDown: (n?: number) => s('<path d="m7 10 5 5 5-5"/>', n),
  check: (n?: number) => s('<path d="m5 12.5 4.5 4.5L19 7.5"/>', n),
  link: (n?: number) =>
    s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4L11.6 6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>', n),
  image: (n?: number) =>
    s('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 19"/>', n),
  film: (n?: number) =>
    s('<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor"/>', n),
  audio: (n?: number) => s('<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>', n),
  stream: (n?: number) => s('<path d="M4 7h16M4 12h16M4 17h10"/><path d="m17 15 3 2-3 2z" fill="currentColor"/>', n),
  gear: (n?: number) =>
    s('<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/>', n),
  external: (n?: number) => s('<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>', n),
  alert: (n?: number) => s('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>', n),
  refresh: (n?: number) => s('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>', n),
  close: (n?: number) => s('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>', n),
};
