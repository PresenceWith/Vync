import { vyncInit } from './init.js';
import { vyncOpen, vyncStop, vyncClose } from './open.js';
import { vyncDiff, formatDiffResult } from './diff.js';
import { discoverVyncFiles } from './discover.js';

const USAGE = `Usage: vync <command> [options]

Commands:
  init <file>    Create .vync file in CWD/.vync/
                 --type graph  Create a graph file (default: canvas)
  open [file|.]  Start server and open browser
                 No args or "." discovers .vync files in CWD
                 --foreground  Run in foreground (blocking)
  close [file]   Unregister file (or all files if no file given)
                 --keep-server  Keep server running even if no files left
  stop           Stop the running server
  diff <file>    Show changes since last sync
                 --no-snapshot  Don't update snapshot after diff

Examples:
  vync init plan                # creates .vync/plan.vync (canvas)
  vync init ontology --type graph  # creates .vync/ontology.vync (graph)
  vync open plan        # opens .vync/plan.vync
  vync open             # discovers .vync files in CWD
  vync open .           # same as above
  vync close plan       # unregisters plan.vync (stops server if last file)
  vync close            # unregisters all files and stops server
  vync diff plan        # shows changes since last read
  vync stop`;

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  switch (command) {
    case 'init': {
      const typeIdx = args.indexOf('--type');
      const fileType = typeIdx >= 0 ? args[typeIdx + 1] : undefined;
      const filePath = args.find(
        (a, i) => !a.startsWith('--') && (typeIdx < 0 || i !== typeIdx + 1)
      );
      if (!filePath) {
        console.error('Usage: vync init <file> [--type graph]');
        process.exit(1);
      }
      const created = await vyncInit(filePath, {
        type: fileType === 'graph' ? 'graph' : undefined,
      });
      console.log(`[vync] Created: ${created}`);
      break;
    }
    case 'open': {
      const foreground = args.includes('--foreground');
      const filePath = args.find((a) => !a.startsWith('--'));
      if (!filePath || filePath === '.') {
        // Discover .vync files in CWD
        const discovered = await discoverVyncFiles();
        if (discovered.length === 0) {
          console.error('[vync] No .vync files found in current directory.');
          console.error('[vync] Run "vync init <name>" to create one.');
          process.exit(1);
        }
        let chosen: string;
        if (discovered.length === 1) {
          chosen = discovered[0];
          console.log(`[vync] Found: ${chosen}`);
        } else {
          console.log('[vync] Found .vync files:');
          discovered.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
          const rl = await import('node:readline');
          const iface = rl.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await new Promise<string>((resolve) => {
            iface.question(
              `Select file (1-${discovered.length}), or "a" for all: `,
              resolve
            );
          });
          iface.close();
          if (answer.toLowerCase() === 'a') {
            for (const f of discovered) {
              await vyncOpen(f, { foreground: false });
            }
            break;
          }
          const idx = parseInt(answer, 10) - 1;
          if (isNaN(idx) || idx < 0 || idx >= discovered.length) {
            console.error('[vync] Invalid selection.');
            process.exit(1);
          }
          chosen = discovered[idx];
        }
        await vyncOpen(chosen, { foreground });
      } else {
        await vyncOpen(filePath, { foreground });
      }
      break;
    }
    case 'close': {
      const keepServer = args.includes('--keep-server');
      const filePath = args.find((a) => !a.startsWith('--'));
      await vyncClose(filePath, { keepServer });
      break;
    }
    case 'diff': {
      const noSnapshot = args.includes('--no-snapshot');
      const filePath = args.find((a) => !a.startsWith('--'));
      if (!filePath) {
        console.error('Usage: vync diff <file> [--no-snapshot]');
        process.exit(1);
      }
      const result = await vyncDiff(filePath, { noSnapshot });
      console.log(formatDiffResult(result));
      break;
    }
    case 'stop': {
      await vyncStop();
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[vync] Error: ${err.message}`);
  process.exit(1);
});
