#!/usr/bin/env node

import { spawn } from 'child_process';

// Test the error handling when xclogparser is not available
async function testMissingXCLogParser() {
  const logPath = '/Users/felix/Library/Developer/Xcode/DerivedData/Transit-aqpfkhpzrolslcaflxrodxmiecvf/Logs/Build/66C4BD82-F8D7-4034-B35E-CCCC4CF66507.xcactivitylog';
  
  return new Promise((resolve) => {
    // Use a non-existent command to simulate xclogparser not being installed
    const command = spawn('xclogparser-missing', ['parse', '--file', logPath, '--reporter', 'issues']);
    let stdout = '';
    let stderr = '';
    
    command.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    command.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    command.on('close', (code) => {
      console.log('Command closed with code:', code);
      console.log('stdout:', stdout);
      console.log('stderr:', stderr);
      resolve({ code, stdout, stderr });
    });
    
    command.on('error', (err) => {
      console.log('Command error (this simulates xclogparser not installed):');
      console.log('Error type:', err.code);
      console.log('Error message:', err.message);
      
      // This simulates what our XcodeMCP would return
      const errorResponse = {
        errors: [
          'XCLogParser is required to parse Xcode build logs but is not installed.',
          '',
          'Please install XCLogParser using one of these methods:',
          '• Homebrew: brew install xclogparser',
          '• From source: https://github.com/MobileNativeFoundation/XCLogParser',
          '',
          'XCLogParser is a professional tool for parsing Xcode\'s binary log format.'
        ],
        warnings: [], 
        notes: []
      };
      
      console.log('\nXcodeMCP would return this error message:');
      console.log('ERRORS:');
      errorResponse.errors.forEach(error => {
        console.log(`  ${error}`);
      });
      
      resolve(errorResponse);
    });
  });
}

testMissingXCLogParser().catch(console.error);