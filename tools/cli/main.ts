import { vyncInit } from './init.js';
import { vyncOpen, vyncStop, vyncClose } from './open.js';
import { vyncDiff, formatDiffResult } from './diff.js';

const USAGE = `Usage: vync <command> [options]

Commands:
  init <file>    Create .vync canvas in CWD/.vync/
  open <file>    Start server and open browser
                 --foreground  Run in foreground (blocking)
  close [file]   Unregister file (or all files if no file given)
                 --keep-server  Keep server running even if no files left
  stop           Stop the running server
  diff <file>    Show changes since last sync
                 --no-snapshot  Don't update snapshot after diff

Examples:
  vync init plan        # creates .vync/plan.vync
  vync open plan        # opens .vync/plan.vync
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
      const filePath = args[0];
      if (!filePath) {
        console.error('Usage: vync init <file>');
        process.exit(1);
      }
      const created = await vyncInit(filePath);
      console.log(`[vync] Created: ${created}`);
      break;
    }
    case 'open': {
      const foreground = args.includes('--foreground');
      const filePath = args.find((a) => !a.startsWith('--'));
      if (!filePath) {
        console.error('Usage: vync open <file> [--foreground]');
        process.exit(1);
      }
      await vyncOpen(filePath, { foreground });
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
