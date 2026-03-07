import { vyncInit } from './init.js';
import { vyncOpen, vyncStop } from './open.js';

const USAGE = `Usage: vync <command> [options]

Commands:
  init <file>    Create an empty .vync canvas file
  open <file>    Start server and open browser
  stop           Stop the running server

Examples:
  vync init plan.vync
  vync open plan.vync
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
      const filePath = args[0];
      if (!filePath) {
        console.error('Usage: vync open <file>');
        process.exit(1);
      }
      await vyncOpen(filePath);
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
