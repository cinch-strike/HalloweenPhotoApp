// Runs the API dev server and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '-w', 'api'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', 'web'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0); }));
