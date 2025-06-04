#!/usr/bin/env node

import { spawn } from 'child_process';

/**
 * Final comprehensive parser for Xcode xcactivitylog files
 * Uses gunzip + strings to extract text from binary format,
 * then applies careful filtering to find real compilation errors and warnings
 */
async function parseFinalLog() {
  const logPath = '/Users/felix/Library/Developer/Xcode/DerivedData/Transit-aqpfkhpzrolslcaflxrodxmiecvf/Logs/Build/66C4BD82-F8D7-4034-B35E-CCCC4CF66507.xcactivitylog';
  
  console.log('🔍 Final parsing of:', logPath);
  console.log('🎯 Expected: 1 error, 18 warnings\n');
  
  const result = { errors: new Set(), warnings: new Set() };
  
  return new Promise((resolve) => {
    const command = spawn('sh', ['-c', `gunzip -c "${logPath}" | strings`]);
    let content = '';
    
    command.stdout.on('data', (data) => {
      content += data.toString();
    });
    
    command.on('close', () => {
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Clean the line and skip noise
        const cleanLine = line.trim();
        if (cleanLine.length < 20 ||
            cleanLine.includes('appintentsnltrainingprocessor') ||
            cleanLine.includes('Unable to parse extract.actionsdata') ||
            cleanLine.includes('builtin-ScanDependencies') ||
            cleanLine.includes('ivfsstatcache') ||
            cleanLine.includes('fmessage-length') ||
            cleanLine.includes('SwiftCompile normal') ||
            cleanLine.includes('in target') ||
            cleanLine.includes('/Applications/Xcode') ||
            cleanLine.includes('--output-format')) {
          continue;
        }
        
        // Real compilation error patterns
        if (cleanLine.toLowerCase().includes('error:')) {
          // Standard Swift/C++ error: /path/file.ext:line:col: error: message
          const fileErrorMatch = cleanLine.match(/^([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+:\s*error:\s*(.+)$/i);
          if (fileErrorMatch) {
            const filePath = fileErrorMatch[1];
            const errorMsg = fileErrorMatch[2].trim();
            result.errors.add(`${filePath}: ${errorMsg}`);
          }
        }
        
        // Real compilation warning patterns
        if (cleanLine.toLowerCase().includes('warning:')) {
          // Standard Swift/C++ warning: /path/file.ext:line:col: warning: message
          const fileWarningMatch = cleanLine.match(/^([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+:\s*warning:\s*(.+)$/i);
          if (fileWarningMatch) {
            const filePath = fileWarningMatch[1];
            const warningMsg = fileWarningMatch[2].trim();
            result.warnings.add(`${filePath}: ${warningMsg}`);
          }
        }
        
        // Deprecation warnings (often don't follow standard format)
        if (cleanLine.includes("'") && cleanLine.includes("deprecated")) {
          const deprecatedMatch = cleanLine.match(/'([^']+)'\s+is\s+deprecated[^:]*:\s*(.+)/i);
          if (deprecatedMatch) {
            const deprecated = deprecatedMatch[1];
            const replacement = deprecatedMatch[2].trim();
            result.warnings.add(`Deprecated API: '${deprecated}' - ${replacement}`);
          }
        }
      }
      
      const finalResult = {
        errors: Array.from(result.errors),
        warnings: Array.from(result.warnings)
      };
      
      console.log('📊 FINAL RESULTS:');
      console.log(`   Errors: ${finalResult.errors.length}`);
      console.log(`   Warnings: ${finalResult.warnings.length}\n`);
      
      if (finalResult.errors.length > 0) {
        console.log('❌ ERRORS:');
        finalResult.errors.forEach((error, i) => {
          console.log(`   ${i + 1}. ${error}`);
        });
        console.log();
      }
      
      if (finalResult.warnings.length > 0) {
        console.log('⚠️ WARNINGS:');
        finalResult.warnings.forEach((warning, i) => {
          console.log(`   ${i + 1}. ${warning}`);
        });
        console.log();
      }
      
      console.log('🎯 VALIDATION:');
      console.log(`   Expected 1 error, found ${finalResult.errors.length} ${finalResult.errors.length === 1 ? '✅' : '❌'}`);
      console.log(`   Expected 18 warnings, found ${finalResult.warnings.length} ${finalResult.warnings.length === 18 ? '✅' : '❌'}`);
      
      if (finalResult.errors.length !== 1 || finalResult.warnings.length !== 18) {
        console.log('\n🔍 The binary xcactivitylog format may contain additional encoded data');
        console.log('   that requires more sophisticated parsing than strings extraction.');
        console.log('   Consider using xcrun actool or specialized Xcode log parsers.');
      }
      
      resolve(finalResult);
    });
    
    command.on('error', (err) => {
      console.error('❌ Failed to parse build log:', err);
      resolve({ errors: ['Failed to parse build log'], warnings: [] });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  parseFinalLog().catch(console.error);
}

export { parseFinalLog };