import fs from 'node:fs';
import path from 'node:path';
import {createInstaller} from './cli.js';
import {launchWindows} from './windows-service.js';
// The login entry launches the same detached, logged runtime as the installer.
try {
  const stateFile = path.resolve(process.argv[2]);
  if (fs.lstatSync(stateFile).isSymbolicLink()) throw Error('Refusing symlink runtime state');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (process.argv[3] === 'open')
    await createInstaller({
      runtimeRoot: path.dirname(stateFile),
      project: state.sourceProject || state.project,
    }).execute({command: 'open'});
  else await launchWindows(state, stateFile, path.join(path.dirname(stateFile), 'service.log'));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
