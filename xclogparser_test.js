#!/usr/bin/env node

import { spawn } from 'child_process';

async function parseWithXCLogParser() {
  const logPath = '/Users/felix/Library/Developer/Xcode/DerivedData/Transit-aqpfkhpzrolslcaflxrodxmiecvf/Logs/Build/66C4BD82-F8D7-4034-B35E-CCCC4CF66507.xcactivitylog';
  
  console.log('🔍 Parsing with xclogparser:', logPath);
  console.log('🎯 Expected: 1 error, 18 warnings\n');
  
  return new Promise((resolve, reject) => {
    // Use xclogparser with issues reporter to get errors and warnings
    const command = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
    let stdout = '';
    let stderr = '';
    
    command.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    command.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    command.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ xclogparser failed with code:', code);
        console.error('Error output:', stderr);
        reject(new Error(`xclogparser failed: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        
        console.log('📊 XCLOGPARSER RESULTS:');
        console.log(`   Errors: ${result.errors ? result.errors.length : 0}`);
        console.log(`   Warnings: ${result.warnings ? result.warnings.length : 0}\n`);
        
        if (result.errors && result.errors.length > 0) {
          console.log('❌ ERRORS:');
          result.errors.forEach((error, i) => {
            console.log(`   ${i + 1}. ${error.title}`);
            if (error.documentURL) {
              console.log(`      File: ${error.documentURL}`);
            }
            if (error.detail) {
              console.log(`      Detail: ${error.detail.replace(/\r/g, '').trim()}`);
            }
          });
          console.log();
        }
        
        if (result.warnings && result.warnings.length > 0) {
          console.log('⚠️ WARNINGS:');
          result.warnings.forEach((warning, i) => {
            console.log(`   ${i + 1}. ${warning.title}`);
            if (warning.documentURL) {
              console.log(`      File: ${warning.documentURL}`);
            }
          });
          console.log();
        }
        
        console.log('🎯 VALIDATION:');
        const errorCount = result.errors ? result.errors.length : 0;
        const warningCount = result.warnings ? result.warnings.length : 0;
        console.log(`   Expected 1 error, found ${errorCount} ${errorCount === 1 ? '✅' : '❌'}`);
        console.log(`   Expected 18 warnings, found ${warningCount} ${warningCount === 18 ? '✅' : '❌'}`);
        
        resolve(result);
      } catch (parseError) {
        console.error('❌ Failed to parse xclogparser output:', parseError);
        console.error('Raw output:', stdout);
        reject(parseError);
      }
    });
    
    command.on('error', (err) => {
      console.error('❌ Failed to run xclogparser:', err);
      reject(err);
    });
  });
}

parseWithXCLogParser().catch(console.error);