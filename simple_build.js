#!/usr/bin/env node

import { spawn } from 'child_process';

// Simple build trigger without log parsing
async function executeJXA(script) {
  return new Promise((resolve, reject) => {
    const osascript = spawn('osascript', ['-l', 'JavaScript', '-e', script]);
    let stdout = '';
    let stderr = '';

    osascript.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    osascript.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    osascript.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`JXA execution failed: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function triggerBuild() {
  const script = `
    const app = Application('Xcode');
    const docs = app.workspaceDocuments();
    if (docs.length === 0) throw new Error('No workspace document open');
    
    const workspace = docs[0];
    workspace.build();
    'Build triggered successfully';
  `;
  
  return await executeJXA(script);
}

triggerBuild()
  .then(result => console.log(result))
  .catch(error => console.error('Error:', error.message));