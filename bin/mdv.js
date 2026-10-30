#!/usr/bin/env node
// mdv — open a Markdown file or folder in a local, live-reloading viewer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR, loadSecret } from '../src/auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..', 'src', 'server.js');
const LOG = path.join(os.homedir(), 'Library', 'Logs', 'mdv.log');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
import { THEME_IDS as THEMES } from '../src/themes.js';

const HELP = `mdv — a quiet Markdown viewer

Usage
  mdv [file.md | folder]     Open a file, or a folder with a sidebar (default: .)

Options
  --port <n>       Port to use (default 4747)
  --theme <name>   ${wrapList(THEMES, 19)}
  --no-open        Don't open the browser, just print the URL
  --editor <app>   App the Edit button opens files in, e.g. "Visual Studio Code" or "Cursor"
                   (saved; --editor "" goes back to your default text editor)
  --stop           Stop the running mdv server
  --foreground     Run the server in this terminal (logs to stdout)
  -h, --help       Show this help
  -v, --version    Show version

Examples
  mdv README.md                 Open one file
  mdv ~/notes --theme sepia     Browse a folder in the sepia theme
  mdv --editor "Cursor"         Make the Edit button open files in Cursor
  mdv --stop                    Stop the server

In the browser
  ⌘K search names, headings and text across the folder
  t  cycle themes        /  filter files        [  show/hide sidebar
  n  next file           p  previous file       e  open in your editor
  r  reveal in Finder    s  reading settings    +  -  text size
  c  next change after a live reload (⇧C previous)    ?  all shortcuts

  The dot in the top bar is live reload: green = connected, amber = reconnecting.
  Drag the sidebar or contents edge to resize; double-click it to reset.
`;

function wrapList(items, indent) {
  const lines = [];
  let line = '';
  for (const item of items) {
    const next = line ? `${line}, ${item}` : item;
    if (next.length > 60 && line) { lines.push(line + ','); line = item; } else line = next;
  }
  lines.push(line);
  return lines.join('\n' + ' '.repeat(indent));
}

function fail(msg, hint) {
  console.error(`mdv: ${msg}`);
  if (hint) console.error(`     ${hint}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { port: 4747, open: true, theme: null, stop: false, foreground: false, target: null, editor: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-v' || a === '--version') { console.log(JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'package.json'), 'utf8')).version); process.exit(0); }
    else if (a === '--port' || a.startsWith('--port=')) opts.port = Number(val());
    else if (a === '--theme' || a.startsWith('--theme=')) opts.theme = val().toLowerCase();
    else if (a === '--editor' || a.startsWith('--editor=')) opts.editor = val();
    else if (a === '--no-open') opts.open = false;
    else if (a === '--stop') opts.stop = true;
    else if (a === '--foreground') opts.foreground = true;
    else if (a.startsWith('-') && a !== '-') fail(`unknown option ${a}`, 'Run mdv --help for usage.');
    else if (opts.target) fail('only one path at a time', 'Run mdv again for each file or folder.');
    else opts.target = a;
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) fail('--port must be a number between 1 and 65535');
  if (opts.theme && !THEMES.includes(opts.theme)) fail(`unknown theme "${opts.theme}"`, `Choose one of: ${THEMES.join(', ')}`);
  return opts;
}

function request(port, method, pathname, body, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method, timeout,
      headers: { 'X-MDV': '1', 'X-MDV-Token': loadSecret(), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(out) }); } catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// true = our server, false = nothing listening, 'other' = port taken by something else
async function probe(port) {
  try {
    const r = await request(port, 'GET', '/api/ping');
    return r.json && r.json.app === 'mdv' ? true : 'other';
  } catch (e) {
    return e.code === 'ECONNREFUSED' ? false : 'other';
  }
}

async function startBackground(port) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const out = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, [SERVER, '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
  });
  child.unref();
  // Another mdv may be starting at the same moment (e.g. several files opened from
  // Finder); whichever server wins the port is fine, so just wait for one to answer.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if ((await probe(port)) === true) return;
  }
  fail(`the server didn't start on port ${port}`, `See the log: ${LOG}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.stop) {
    const state = await probe(opts.port);
    if (state !== true) { console.log(`mdv: no server running on port ${opts.port}`); return; }
    await request(opts.port, 'POST', '/shutdown');
    console.log(`mdv: stopped the server on port ${opts.port}`);
    return;
  }

  if (opts.editor !== null) {
    const app = opts.editor.trim();
    if (app && spawnSync('/usr/bin/open', ['-Ra', app], { stdio: 'ignore' }).status !== 0) {
      fail(`couldn't find an app called "${app}"`, 'Use the name shown in /Applications, e.g. --editor "Visual Studio Code"');
    }
    let config = {};
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
    if (app) config.editor = app; else delete config.editor;
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
    console.log(app ? `mdv: Edit will open files in ${app}` : 'mdv: Edit will use your default text editor');
    if (!opts.target) return;
  }

  const target = path.resolve(opts.target || '.');
  if (!fs.existsSync(target)) fail(`file not found: ${target}`, 'Check the spelling, or run mdv with a folder to browse it.');

  if (opts.foreground) {
    const { start } = await import(SERVER);
    await start(opts.port).catch((e) => fail(e.code === 'EADDRINUSE' ? `port ${opts.port} is already in use` : e.message));
  } else {
    const state = await probe(opts.port);
    if (state === 'other') fail(`port ${opts.port} is in use by another program`, 'Try another one, e.g. mdv --port 4848');
    if (state === false) await startBackground(opts.port);
  }

  const res = await request(opts.port, 'POST', '/open', { path: target });
  if (res.status !== 200 || !res.json?.url) fail(res.json?.error || 'the server refused that path');
  let url = res.json.url;
  if (opts.theme) url += `${url.includes('?') ? '&' : '?'}theme=${opts.theme}`;

  console.log(url);
  if (opts.open) spawn('/usr/bin/open', [url], { stdio: 'ignore', detached: true }).unref();
}

main().catch((e) => fail(e.message));
