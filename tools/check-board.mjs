/**
 * Run every board check in one pass.
 *
 * The board tools arrived separately and each takes its own invocation,
 * which in practice means one gets run and the others do not. This runs
 * both against a live board: the structural audit, and the section counts
 * a caller expects.
 *
 * Usage:
 *   MIRVA_URL=... MIRVA_TOKEN=... node tools/check-board.mjs <boardId> \
 *     [<sectionPrefix>=<count> ...]
 *
 * With no expectations it runs the audit alone.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const [boardId, ...claims] = process.argv.slice(2);
if (!boardId) {
  console.error('usage: node tools/check-board.mjs <boardId> [<prefix>=<count> ...]');
  process.exit(2);
}

/** A tool's exit code and combined output. */
function run(script, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(HERE, script), ...args], {
      env: process.env,
    });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('close', code => resolve({ code, output }));
  });
}

const checks = [['structure', 'audit-board.mjs', [boardId]]];
if (claims.length) checks.push(['section counts', 'verify-claims.mjs', [boardId, ...claims]]);

const failed = [];
for (const [name, script, args] of checks) {
  const { code, output } = await run(script, args);
  const lines = output.trim().split('\n').filter(l => l.trim());
  if (code === 0) {
    console.log(`  ok   ${name.padEnd(15)} ${lines[lines.length - 1]}`);
  } else {
    failed.push(name);
    console.log(`  FAIL ${name}`);
    // Reprint only the lines that say what went wrong, not the whole run.
    for (const line of lines) {
      if (/WRONG|MISSING|overlap|referenced by/.test(line)) {
        console.log(`         ${line.trim()}`);
      }
    }
  }
}

console.log();
if (failed.length) {
  console.log(`${failed.length} of ${checks.length} checks failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`all ${checks.length} board check${checks.length === 1 ? '' : 's'} pass`);
