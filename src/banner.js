'use strict';

// Big block banner in the style of Hermes Agent: yellow-to-orange gradient, 256-color ANSI.
const LINES = [
  ' ███████╗ █████╗ ███╗   ██╗████████╗██████╗ ██╗    ███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  ' ██╔════╝██╔══██╗████╗  ██║╚══██╔══╝██╔══██╗██║    ██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  ' ███████╗███████║██╔██╗ ██║   ██║   ██████╔╝██║    ███████╗█████╔╝ ██║██║     ██║     ███████╗',
  ' ╚════██║██╔══██║██║╚██╗██║   ██║   ██╔══██╗██║    ╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  ' ███████║██║  ██║██║ ╚████║   ██║   ██║  ██║██║    ███████║██║  ██╗██║███████╗███████╗███████║',
  ' ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝    ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
];
const GRADIENT = [226, 220, 214, 214, 208, 202];

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor() ? `\x1b[38;5;${code}m${s}\x1b[0m` : s);
const c = {
  gold: (s) => paint(220, s),
  orange: (s) => paint(208, s),
  green: (s) => paint(42, s),
  red: (s) => paint(196, s),
  dim: (s) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
};

function banner(version) {
  const narrow = (process.stdout.columns || 120) < 96;
  const art = narrow ? ['  S A N T R I   S K I L L S'] : LINES;
  const out = art.map((l, i) => paint(GRADIENT[i] || 208, l));
  out.push('');
  out.push(`  ${c.bold(c.gold('Santriverse Skills'))} ${c.dim(`v${version}`)}  ${c.dim('·')}  ${c.orange('Agent Skills + MCP untuk Google Antigravity')}`);
  out.push(`  ${c.dim('Apps Script Skills · Pedoman Monorepo · github.com/askiya')}`);
  out.push('');
  return out.join('\n');
}

module.exports = { banner, c };
