#!/usr/bin/env node

import { spawn } from 'child_process';

async function parseComprehensiveLog() {
  const logPath = '/Users/felix/Library/Developer/Xcode/DerivedData/Transit-aqpfkhpzrolslcaflxrodxmiecvf/Logs/Build/66C4BD82-F8D7-4034-B35E-CCCC4CF66507.xcactivitylog';
  
  console.log('📁 Comprehensive parsing of log:', logPath);
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
      
      console.log(`📝 Processing ${lines.length} lines of extracted text...`);
      
      for (const line of lines) {
        // Skip non-compilation related lines
        if (line.includes('appintentsnltrainingprocessor') || 
            line.includes('Unable to parse extract.actionsdata') ||
            line.includes('builtin-ScanDependencies') ||
            line.includes('ivfsstatcache') ||
            line.includes('fmessage-length') ||
            line.length < 10) {
          continue;
        }
        
        // Look for any line that contains error patterns
        if (line.toLowerCase().includes('error')) {
          // Standard compilation error format
          const fileErrorMatch = line.match(/([\/][^:]*\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?error[:\s]*(.+)/i);
          if (fileErrorMatch) {
            const filePath = fileErrorMatch[1];
            const errorMsg = fileErrorMatch[2].trim().replace(/[^\x20-\x7E]/g, '').trim();
            if (errorMsg.length > 0) {
              result.errors.add(`${filePath}: ${errorMsg}`);
            }
          } else {
            // Look for other error patterns
            const generalErrorMatch = line.match(/error[:\s]*(.+)/i);
            if (generalErrorMatch) {
              const errorMsg = generalErrorMatch[1].trim().replace(/[^\x20-\x7E]/g, '').trim();
              if (errorMsg.length > 10 && !errorMsg.includes('appintentsnltrainingprocessor')) {
                result.errors.add(`General error: ${errorMsg}`);
              }
            }
          }
        }
        
        // Look for warning patterns - be more inclusive
        if (line.toLowerCase().includes('warning')) {
          // Standard compilation warning format
          const fileWarningMatch = line.match(/([\/][^:]*\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?warning[:\s]*(.+)/i);
          if (fileWarningMatch) {
            const filePath = fileWarningMatch[1];
            let warningMsg = fileWarningMatch[2].trim().replace(/[^\x20-\x7E]/g, '').trim();
            if (warningMsg.length > 0) {
              result.warnings.add(`${filePath}: ${warningMsg}`);
            }
          }
        }
        
        // Look for deprecation warnings specifically
        if (line.toLowerCase().includes('deprecated')) {
          // 'font(uiFont:)' is deprecated: Use `textStyle` instead
          const deprecatedMatch = line.match(/'([^']+)'\s+is\s+deprecated[:\s]*(.+)/i);
          if (deprecatedMatch) {
            const deprecated = deprecatedMatch[1];
            const replacement = deprecatedMatch[2].trim().replace(/[^\x20-\x7E]/g, '').trim();
            result.warnings.add(`Deprecated API: '${deprecated}' - ${replacement}`);
          }
        }
        
        // Look for Swift file compilation patterns  
        if (line.includes('.swift') && (line.includes('warning') || line.includes('error'))) {
          // Extract Swift file warnings/errors that might be embedded in binary data
          const swiftMatch = line.match(/([^\/]*\.swift)[^a-zA-Z]*([a-zA-Z].*?(?:warning|error)[^a-zA-Z]*[a-zA-Z].*)/i);
          if (swiftMatch) {
            const fileName = swiftMatch[1];
            let message = swiftMatch[2].trim().replace(/[^\x20-\x7E]/g, '').trim();
            if (message.length > 10) {
              if (line.toLowerCase().includes('warning')) {
                result.warnings.add(`${fileName}: ${message}`);
              } else if (line.toLowerCase().includes('error')) {
                result.errors.add(`${fileName}: ${message}`);
              }
            }
          }
        }
        
        // Note patterns
        if (line.toLowerCase().includes('note:')) {
          const noteMatch = line.match(/note[:\s]*(.+)/i);
          if (noteMatch) {
            const noteMsg = noteMatch[1].trim().replace(/[^\x20-\x7E]/g, '').trim();
            if (noteMsg.length > 0 && noteMsg.length < 200) {
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
      
      console.log('📊 COMPREHENSIVE RESULTS:');
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
        finalResult.warnings.slice(0, 20).forEach((warning, i) => {
          console.log(`   ${i + 1}. ${warning}`);
        });
        if (finalResult.warnings.length > 20) {
          console.log(`   ... and ${finalResult.warnings.length - 20} more warnings`);
        }
        console.log();
      }
      
      console.log('🎯 FINAL VALIDATION:');
      console.log(`   Expected 1 error, found ${finalResult.errors.length} ${finalResult.errors.length === 1 ? '✅' : finalResult.errors.length === 0 ? '❌ (missing)' : '❌ (too many)'}`);
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

parseComprehensiveLog().catch(console.error);