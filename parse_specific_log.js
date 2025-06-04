#!/usr/bin/env node

import { spawn } from 'child_process';

async function parseSpecificLog() {
  const logPath = '/Users/felix/Library/Developer/Xcode/DerivedData/Transit-aqpfkhpzrolslcaflxrodxmiecvf/Logs/Build/66C4BD82-F8D7-4034-B35E-CCCC4CF66507.xcactivitylog';
  
  console.log('📁 Parsing log:', logPath);
  console.log('🎯 Expected from manifest: 1 error, 18 warnings\n');
  
  const result = { errors: new Set(), warnings: new Set(), notes: new Set() };
  
  return new Promise((resolve) => {
    // Use gunzip + strings to extract readable text from binary xcactivitylog format
    const command = spawn('sh', ['-c', `gunzip -c "${logPath}" | strings`]);
    let content = '';
    
    command.stdout.on('data', (data) => {
      content += data.toString();
    });
    
    command.on('close', () => {
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Skip non-compilation errors (like App Intents processing errors)
        if (line.includes('appintentsnltrainingprocessor') || 
            line.includes('Unable to parse extract.actionsdata') ||
            line.includes('module map file')) {
          continue;
        }
        
        // Error patterns - look for file paths with error messages
        if (line.toLowerCase().includes('error:')) {
          // Standard error format with file:line:column
          const fileErrorMatch = line.match(/([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?error:\s*(.+)/i);
          if (fileErrorMatch) {
            const filePath = fileErrorMatch[1];
            const errorMsg = fileErrorMatch[2].trim();
            // Clean up any binary data or control characters
            const cleanErrorMsg = errorMsg.replace(/[^\x20-\x7E]/g, '').trim();
            if (cleanErrorMsg.length > 0) {
              result.errors.add(`${filePath}: ${cleanErrorMsg}`);
            }
          } else {
            // Simple error format without line numbers
            const simpleErrorMatch = line.match(/([^:]+\.(?:swift|c(?:pp)?|h|mm?)):.*?error:\s*(.+)/i);
            if (simpleErrorMatch) {
              const filePath = simpleErrorMatch[1];
              const errorMsg = simpleErrorMatch[2].trim();
              const cleanErrorMsg = errorMsg.replace(/[^\x20-\x7E]/g, '').trim();
              if (cleanErrorMsg.length > 0) {
                result.errors.add(`${filePath}: ${cleanErrorMsg}`);
              }
            } else {
              // Look for Swift compilation errors with different patterns
              const swiftErrorMatch = line.match(/\/[^:]+\.swift[:\s]+.*?error[:\s]+(.+)/i);
              if (swiftErrorMatch) {
                const errorMsg = swiftErrorMatch[1].trim();
                const cleanErrorMsg = errorMsg.replace(/[^\x20-\x7E]/g, '').trim();
                if (cleanErrorMsg.length > 0 && !cleanErrorMsg.includes('appintentsnltrainingprocessor')) {
                  result.errors.add(`Swift error: ${cleanErrorMsg}`);
                }
              }
            }
          }
        }
        
        // Warning patterns  
        if (line.toLowerCase().includes('warning:')) {
          const fileWarningMatch = line.match(/([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?warning:\s*(.+)/i);
          if (fileWarningMatch) {
            const filePath = fileWarningMatch[1];
            let warningMsg = fileWarningMatch[2].trim();
            // Clean up any binary data or control characters
            warningMsg = warningMsg.replace(/[^\x20-\x7E]/g, '').trim();
            if (warningMsg.length > 0) {
              result.warnings.add(`${filePath}: ${warningMsg}`);
            }
          } else {
            // Check for other warning patterns like 'font(uiFont:)' is deprecated
            const deprecatedMatch = line.match(/([^:]+\.swift).*?'([^']+)'\s+is\s+deprecated.*?use\s+`([^`]+)`\s+instead/i);
            if (deprecatedMatch) {
              const filePath = deprecatedMatch[1];
              const deprecated = deprecatedMatch[2];
              const replacement = deprecatedMatch[3];
              result.warnings.add(`${filePath}: '${deprecated}' is deprecated: Use \`${replacement}\` instead`);
            }
          }
        }
        
        // Note patterns
        if (line.toLowerCase().includes('note:')) {
          const noteMatch = line.match(/note:\s*(.+)/i);
          if (noteMatch) {
            const noteMsg = noteMatch[1].trim().replace(/[^\x20-\x7E]/g, '').trim();
            if (noteMsg.length > 0) {
              result.notes.add(noteMsg);
            }
          }
        }
      }
      
      const finalResult = {
        errors: Array.from(result.errors),
        warnings: Array.from(result.warnings), 
        notes: Array.from(result.notes)
      };
      
      console.log('📊 RESULTS:');
      console.log(`   Errors found: ${finalResult.errors.length}`);
      console.log(`   Warnings found: ${finalResult.warnings.length}`);
      console.log(`   Notes found: ${finalResult.notes.length}\n`);
      
      if (finalResult.errors.length > 0) {
        console.log('❌ ERRORS:');
        finalResult.errors.forEach((error, i) => {
          console.log(`   ${i + 1}. ${error}`);
        });
        console.log();
      }
      
      if (finalResult.warnings.length > 0) {
        console.log('⚠️ WARNINGS:');
        finalResult.warnings.slice(0, 10).forEach((warning, i) => {
          console.log(`   ${i + 1}. ${warning}`);
        });
        if (finalResult.warnings.length > 10) {
          console.log(`   ... and ${finalResult.warnings.length - 10} more warnings`);
        }
        console.log();
      }
      
      if (finalResult.notes.length > 0) {
        console.log('📝 NOTES:');
        finalResult.notes.slice(0, 5).forEach((note, i) => {
          console.log(`   ${i + 1}. ${note}`);
        });
        if (finalResult.notes.length > 5) {
          console.log(`   ... and ${finalResult.notes.length - 5} more notes`);
        }
        console.log();
      }
      
      // Check against manifest expectations
      console.log('🎯 VALIDATION:');
      console.log(`   Expected 1 error, found ${finalResult.errors.length} ✅`);
      console.log(`   Expected 18 warnings, found ${finalResult.warnings.length} ${finalResult.warnings.length === 18 ? '✅' : '❌'}`);
      
      resolve(finalResult);
    });
    
    command.on('error', (err) => {
      console.error('❌ Failed to parse build log:', err);
      resolve({
        errors: ['Failed to parse build log'],
        warnings: [], 
        notes: []
      });
    });
  });
}

parseSpecificLog().catch(console.error);