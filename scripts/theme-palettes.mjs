// Candidate dark palettes: neutral black / grey families, no blue cast.
// Only the neutral tokens differ; accent, status colours and tints stay as in
// css/app.css. Used by scripts/theme-preview.mjs to render side-by-side
// screenshots before one of them is applied to the app.
//
// Sources for the families: Tailwind neutral / zinc / stone scales, Radix
// Colors gray (dark), Vercel Geist's near-black neutrals, Material's #121212
// surface baseline, VS Code Dark+ / macOS window greys, plain OLED black.

export const PALETTES = [
  {
    id: 'neutral',
    name: 'Neutral',
    note: 'Pure grey, Vercel / Tailwind neutral',
    tokens: {
      bg: '#0a0a0a', 'bg-2': '#0e0e0e', surface: '#141414', 'surface-2': '#1a1a1a', 'surface-3': '#222222',
      border: '#262626', 'border-strong': '#363636',
      text: '#ededed', 'text-2': '#b5b5b5', muted: '#9a9a9a', 'control-border': '#757575', 'code-bg': '#0c0c0c',
    },
  },
  {
    id: 'zinc',
    name: 'Zinc',
    note: 'shadcn/ui, a hair cooler than neutral',
    tokens: {
      bg: '#09090b', 'bg-2': '#0e0e11', surface: '#141417', 'surface-2': '#1b1b1f', 'surface-3': '#232328',
      border: '#27272a', 'border-strong': '#3f3f46',
      text: '#f4f4f5', 'text-2': '#b4b4bc', muted: '#a1a1aa', 'control-border': '#71717a', 'code-bg': '#0c0c0f',
    },
  },
  {
    id: 'radix',
    name: 'Radix Gray',
    note: 'Radix Colors dark gray scale',
    tokens: {
      bg: '#111111', 'bg-2': '#151515', surface: '#191919', 'surface-2': '#222222', 'surface-3': '#2a2a2a',
      border: '#313131', 'border-strong': '#484848',
      text: '#eeeeee', 'text-2': '#b4b4b4', muted: '#9a9a9a', 'control-border': '#737373', 'code-bg': '#141414',
    },
  },
  {
    id: 'charcoal',
    name: 'Charcoal',
    note: 'Material #121212 baseline, softer than black',
    tokens: {
      bg: '#121212', 'bg-2': '#161616', surface: '#1e1e1e', 'surface-2': '#242424', 'surface-3': '#2d2d2d',
      border: '#2f2f2f', 'border-strong': '#424242',
      text: '#e6e6e6', 'text-2': '#bdbdbd', muted: '#9e9e9e', 'control-border': '#7a7a7a', 'code-bg': '#181818',
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    note: 'VS Code Dark+ / macOS window grey, lighter',
    tokens: {
      bg: '#1e1e1e', 'bg-2': '#222222', surface: '#262626', 'surface-2': '#2d2d2d', 'surface-3': '#363636',
      border: '#3a3a3a', 'border-strong': '#505050',
      text: '#e8e8e8', 'text-2': '#c2c2c2', muted: '#a6a6a6', 'control-border': '#858585', 'code-bg': '#1a1a1a',
    },
  },
  {
    id: 'stone',
    name: 'Stone',
    note: 'Warm graphite, Tailwind stone',
    tokens: {
      bg: '#0c0a09', 'bg-2': '#110f0e', surface: '#181514', 'surface-2': '#1f1c1a', 'surface-3': '#292524',
      border: '#2c2826', 'border-strong': '#44403c',
      text: '#f5f5f4', 'text-2': '#c9c5c1', muted: '#a8a29e', 'control-border': '#78716c', 'code-bg': '#0e0c0b',
    },
  },
  {
    id: 'oled',
    name: 'OLED Black',
    note: 'True black base, thin grey layers',
    tokens: {
      bg: '#000000', 'bg-2': '#050505', surface: '#0d0d0d', 'surface-2': '#141414', 'surface-3': '#1c1c1c',
      border: '#242424', 'border-strong': '#333333',
      text: '#f2f2f2', 'text-2': '#b0b0b0', muted: '#8e8e8e', 'control-border': '#6d6d6d', 'code-bg': '#000000',
    },
  },
];

// Same pairs test/contrast.test.js measures for the dark theme.
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export function audit(tokens) {
  const problems = [];
  const surfaces = ['bg', 'bg-2', 'surface', 'surface-2', 'surface-3'];
  for (const s of surfaces) {
    for (const t of ['text', 'text-2', 'muted']) {
      const r = ratio(tokens[t], tokens[s]);
      if (r < 4.5) problems.push(`${t} on ${s}: ${r.toFixed(2)}:1 (needs 4.5)`);
    }
  }
  for (const s of ['bg', 'bg-2', 'surface', 'surface-2']) {
    const r = ratio(tokens['control-border'], tokens[s]);
    if (r < 3) problems.push(`control-border on ${s}: ${r.toFixed(2)}:1 (needs 3)`);
  }
  return problems;
}

export const css = (tokens, overlay = 'rgba(0, 0, 0, .62)') =>
  `:root:root{${Object.entries(tokens).map(([k, v]) => `--${k}:${v}`).join(';')}}.overlay{background:${overlay}}`;
