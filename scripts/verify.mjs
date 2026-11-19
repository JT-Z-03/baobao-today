import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Use the running npm's JS entry point so Windows does not need a shell or cmd quoting.
export function runChecks(checks, options = {}) {
  for (const { name, command, args } of checks) {
    console.log(`\n[verify] ${name}`);
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error || result.signal || result.status !== 0) {
      console.error(`[verify] ${name} failed${result.error ? `: ${result.error.message}` : ''}`);
      return result.status || 1;
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const npm = process.env.npm_execpath;
  if (!npm) {
    console.error('Run this gate through npm run verify.');
    process.exitCode = 1;
  } else {
    const scripts = ['test', 'test:schema', 'typecheck', 'lint', 'test:assets', 'test:ui-assets', 'test:native-patches', 'test:tooling', 'test:release-baseline'];
    process.exitCode = runChecks(scripts.map((name) => ({
      name, command: process.execPath,
      args: [npm, 'run', name, ...(name === 'test' ? ['--', '--runInBand'] : [])],
    })));
  }
}
