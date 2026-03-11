export function outlinedSvg(content, viewBox = "0 0 24 24") {
  return `
    <svg viewBox="${viewBox}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      ${content}
    </svg>
  `;
}

export function noteIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55c-2.21 0-4 1.79-4 4s1.79 4 4 4s4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  `;
}

export function heartIcon(filled) {
  if (filled) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5A4.5 4.5 0 0 1 6.5 4C8.24 4 9.91 4.81 11 6.09 12.09 4.81 13.76 4 15.5 4A4.5 4.5 0 0 1 20 8.5c0 3.78-3.4 6.86-8.55 11.54Z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="m12 20.7-.8-.73c-4.85-4.4-8.05-7.31-8.05-11.22A4.23 4.23 0 0 1 7.4 4.5c1.68 0 3.28.78 4.3 2.01A5.62 5.62 0 0 1 16 4.5a4.23 4.23 0 0 1 4.25 4.25c0 3.91-3.2 6.82-8.05 11.22ZM7.4 6.25a2.46 2.46 0 0 0-2.48 2.5c0 3.13 2.84 5.71 7.08 9.58 4.24-3.87 7.08-6.45 7.08-9.58A2.46 2.46 0 0 0 16.6 6.25c-1.3 0-2.55.84-3.03 2.03h-1.14A3.6 3.6 0 0 0 9.4 6.25Z"/>
    </svg>
  `;
}

export function dotsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>
    </svg>
  `;
}

export function shareIcon() {
  return outlinedSvg(`
      <circle cx="18" cy="5" r="2.5"/>
      <circle cx="6" cy="12" r="2.5"/>
      <circle cx="18" cy="19" r="2.5"/>
      <path d="m8.2 11 7.6-4.4"/>
      <path d="m8.2 13 7.6 4.4"/>
    `);
}

export function getPreviousIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 6c.55 0 1 .45 1 1v10c0 .55-.45 1-1 1s-1-.45-1-1V7c0-.55.45-1 1-1zm3.66 6.82l5.77 4.07c.66.47 1.58-.01 1.58-.82V7.93c0-.81-.91-1.28-1.58-.82l-5.77 4.07a1 1 0 0 0 0 1.64z"/>
    </svg>
  `;
}

export function getNextIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.58 16.89l5.77-4.07c.56-.4.56-1.24 0-1.63L7.58 7.11C6.91 6.65 6 7.12 6 7.93v8.14c0 .81.91 1.28 1.58.82zM16 7v10c0 .55.45 1 1 1s1-.45 1-1V7c0-.55-.45-1-1-1s-1 .45-1 1z"/>
    </svg>
  `;
}

export function getNavigationBackIcon() {
  return outlinedSvg(`
      <path d="m15 18-6-6 6-6"/>
    `);
}

export function getNavigationForwardIcon() {
  return outlinedSvg(`
      <path d="m9 18 6-6-6-6"/>
    `);
}

export function getWindowMaximizeIcon(isMaximized) {
  if (isMaximized) {
    return outlinedSvg(`
        <path d="M8 8h9v9H8Z"/>
        <path d="M11 8V5h8v8h-2"/>
      `);
  }

  return outlinedSvg(`
      <rect x="6" y="6" width="12" height="12" rx="1.5"/>
    `);
}

export function getPlayButtonIcon({ isPlaying, isBuffering } = {}) {
  if (isPlaying || isBuffering) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M8 19c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2v10c0 1.1.9 2 2 2zm6-12v10c0 1.1.9 2 2 2s2-.9 2-2V7c0-1.1-.9-2-2-2s-2 .9-2 2z"/>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.998.998 0 0 0 8 6.82z"/>
    </svg>
  `;
}

export function playGlyphIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.998.998 0 0 0 8 6.82z"/>
    </svg>
  `;
}

export function closeSmallIcon() {
  return outlinedSvg(`
      <path d="M18 6 6 18"/>
      <path d="m6 6 12 12"/>
    `);
}

export function getShuffleIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10.59 9.17L6.12 4.7a.996.996 0 1 0-1.41 1.41l4.46 4.46l1.42-1.4zm4.76-4.32l1.19 1.19L4.7 17.88a.996.996 0 1 0 1.41 1.41L17.96 7.46l1.19 1.19a.5.5 0 0 0 .85-.36V4.5c0-.28-.22-.5-.5-.5h-3.79a.5.5 0 0 0-.36.85zm-.52 8.56l-1.41 1.41l3.13 3.13l-1.2 1.2a.5.5 0 0 0 .36.85h3.79c.28 0 .5-.22.5-.5v-3.79c0-.45-.54-.67-.85-.35l-1.19 1.19l-3.13-3.14z"/>
    </svg>
  `;
}

export function getRepeatIcon(repeatMode) {
  if (repeatMode === "one") {
    return outlinedSvg(`
      <path d="m17 3 4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="m7 21-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      <path d="M12 10h1.5v6"/>
      <path d="m12 10-1.2.9"/>
    `);
  }

  return outlinedSvg(`
      <path d="m17 3 4 4-4 4"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <path d="m7 21-4-4 4-4"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    `);
}

export function getVolumeIcon({ muted, volume } = {}) {
  const effectiveVolume = muted ? 0 : Number(volume || 0);

  if (effectiveVolume === 0) {
    return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="m17 9 4 6"/>
      <path d="m21 9-4 6"/>
    `);
  }

  if (effectiveVolume <= 0.35) {
    return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="M16.5 12a3.5 3.5 0 0 0-2-3.15"/>
      <path d="M14.5 15.15A3.5 3.5 0 0 0 16.5 12"/>
    `);
  }

  return outlinedSvg(`
      <path d="M11 5 6 9H3v6h3l5 4V5Z"/>
      <path d="M16 9.5a4.5 4.5 0 0 1 0 5"/>
      <path d="M18.9 7a8 8 0 0 1 0 10"/>
    `);
}

export function saveToApolloIcon() {
  return outlinedSvg(`
      <path d="M12 3v12"/>
      <path d="m7 10 5 5 5-5"/>
      <path d="M5 21h14"/>
    `);
}
