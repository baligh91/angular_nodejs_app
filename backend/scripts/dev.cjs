const ts = require('typescript');
const { spawn } = require('node:child_process');

let server;
let closing = false;
let restarting = false;
const host = ts.createWatchCompilerHost(
  'tsconfig.json', { noEmitOnError: true }, ts.sys, ts.createEmitAndSemanticDiagnosticsBuilderProgram,
);
const compile = host.afterProgramCreate;
host.afterProgramCreate = (program) => {
  compile(program);
  if (ts.getPreEmitDiagnostics(program.getProgram()).some((diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error)) return;
  const start = () => {
    restarting = false;
    const nodeOptions = new Set((process.env.NODE_OPTIONS || '').split(/\s+/).filter(Boolean));
    nodeOptions.add('--use-system-ca');
    if (!closing) server = spawn(process.execPath, ['dist/main.js'], {
      stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: [...nodeOptions].join(' ') },
    });
  };
  if (restarting) return;
  if (server && server.exitCode === null && server.signalCode === null) {
    restarting = true;
    server.once('exit', start);
    server.kill();
  } else start();
};
const watcher = ts.createWatchProgram(host);
const shutdown = () => {
  closing = true;
  watcher.close();
  if (server) server.kill();
  process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
process.on('message', (message) => { if (message === 'shutdown') shutdown(); });
