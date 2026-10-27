// Single source for theme and font choices: the CLI validates --theme against it, the page
// renders the pickers from it, and the client reads the choices back from the page.

export const THEMES = [
  { id: 'auto', label: 'System', group: 'System' },
  { id: 'light', label: 'Light', group: 'Light' },
  { id: 'sepia', label: 'Sepia', group: 'Light' },
  { id: 'ink', label: 'Ink', group: 'Light' },
  { id: 'moss', label: 'Moss', group: 'Light' },
  { id: 'solarized-light', label: 'Solarized Light', group: 'Light' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', group: 'Light' },
  { id: 'latte', label: 'Catppuccin Latte', group: 'Light' },
  { id: 'dark', label: 'Dark', group: 'Dark', dark: true },
  { id: 'dusk', label: 'Dusk', group: 'Dark', dark: true },
  { id: 'fjord', label: 'Fjord', group: 'Dark', dark: true },
  { id: 'midnight', label: 'Midnight', group: 'Dark', dark: true },
  { id: 'solarized-dark', label: 'Solarized Dark', group: 'Dark', dark: true },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', group: 'Dark', dark: true },
  { id: 'mocha', label: 'Catppuccin Mocha', group: 'Dark', dark: true },
  { id: 'rose-pine', label: 'Rosé Pine', group: 'Dark', dark: true },
  { id: 'tokyo-night', label: 'Tokyo Night', group: 'Dark', dark: true },
  { id: 'dracula', label: 'Dracula', group: 'Dark', dark: true },
];

// `bundled` fonts ship in node_modules (@fontsource, OFL) and are served by mdv, so they
// work offline on any Mac; the rest are already installed with macOS.
export const FONTS = [
  { id: 'charter', label: 'Charter', group: 'Serif', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
  { id: 'iowan', label: 'Iowan Old Style', group: 'Serif', stack: '"Iowan Old Style", Charter, Georgia, serif' },
  { id: 'newyork', label: 'New York', group: 'Serif', stack: '"New York", ui-serif, Charter, Georgia, serif' },
  { id: 'literata', label: 'Literata', group: 'Serif', bundled: true, stack: '"Literata Variable", Charter, Georgia, serif' },
  { id: 'sourceserif', label: 'Source Serif', group: 'Serif', bundled: true, stack: '"Source Serif 4 Variable", Charter, Georgia, serif' },
  { id: 'palatino', label: 'Palatino', group: 'Serif', stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { id: 'baskerville', label: 'Baskerville', group: 'Serif', stack: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
  { id: 'georgia', label: 'Georgia', group: 'Serif', stack: 'Georgia, serif' },
  { id: 'system', label: 'San Francisco', group: 'Sans', stack: 'system-ui, -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif' },
  { id: 'inter', label: 'Inter', group: 'Sans', bundled: true, stack: '"Inter Variable", system-ui, sans-serif' },
  { id: 'avenir', label: 'Avenir Next', group: 'Sans', stack: '"Avenir Next", Avenir, system-ui, sans-serif' },
  { id: 'helvetica', label: 'Helvetica Neue', group: 'Sans', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'optima', label: 'Optima', group: 'Sans', stack: 'Optima, Candara, system-ui, sans-serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', group: 'Legibility', bundled: true, stack: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { id: 'opendyslexic', label: 'OpenDyslexic', group: 'Legibility', bundled: true, stack: 'OpenDyslexic, system-ui, sans-serif' },
];

export const MONO_FONTS = [
  { id: 'sfmono', label: 'SF Mono', stack: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace' },
  { id: 'menlo', label: 'Menlo', stack: 'Menlo, Monaco, ui-monospace, monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono', bundled: true, stack: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace' },
];

// Font files mdv serves at /_mdv/fonts/<id>/<file>, from these package folders.
export const FONT_PACKAGES = {
  literata: '@fontsource-variable/literata',
  sourceserif: '@fontsource-variable/source-serif-4',
  inter: '@fontsource-variable/inter',
  atkinson: '@fontsource/atkinson-hyperlegible',
  opendyslexic: '@fontsource/opendyslexic',
  jetbrains: '@fontsource-variable/jetbrains-mono',
};

export const THEME_IDS = THEMES.map((t) => t.id);
