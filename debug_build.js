#!/usr/bin/env node

import { readdir, stat } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

async function findProjectDerivedData(projectPath) {
  const projectName = path.basename(projectPath, path.extname(projectPath));
  const derivedDataPath = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
  
  try {
    const dirs = await readdir(derivedDataPath);
    const matches = dirs.filter(dir => dir.startsWith(`${projectName}-`));
    
    if (matches.length === 0) return null;
    
    // Find the most recently modified directory
    let latestDir = null;
    let latestTime = 0;
    
    for (const match of matches) {
      const fullPath = path.join(derivedDataPath, match);
      const stats = await stat(fullPath);
      if (stats.mtime.getTime() > latestTime) {
        latestTime = stats.mtime.getTime();
        latestDir = fullPath;
      }
    }
    
    return latestDir;
  } catch (error) {
    return null;
  }
}

async function getLatestBuildLog(projectPath) {
  const derivedData = await findProjectDerivedData(projectPath);
  if (!derivedData) return null;
  
  const logsDir = path.join(derivedData, 'Logs', 'Build');
  
  try {
    const files = await readdir(logsDir);
    const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
    
    if (logFiles.length === 0) return null;
    
    // Find the most recently modified log file
    let latestLog = null;
    let latestTime = 0;
    
    for (const logFile of logFiles) {
      const fullPath = path.join(logsDir, logFile);
      const stats = await stat(fullPath);
      if (stats.mtime.getTime() > latestTime) {
        latestTime = stats.mtime.getTime();
        latestLog = { path: fullPath, mtime: stats.mtime };
      }
    }
    
    return latestLog;
  } catch (error) {
    return null;
  }
}

async function parseBuildLog(logPath) {
  const result = { errors: new Set(), warnings: new Set(), notes: new Set() };
  
  return new Promise((resolve) => {
    // Use system gunzip command to avoid Node.js streaming issues
    const gunzip = spawn('gunzip', ['-c', logPath]);
    let content = '';
    
    gunzip.stdout.on('data', (data) => {
      content += data.toString();
    });
    
    gunzip.on('close', () => {
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Error patterns - look for file paths with error messages
        if (line.toLowerCase().includes('error:')) {
          const fileErrorMatch = line.match(/([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?error:\s*(.+)/i);
          if (fileErrorMatch) {
            result.errors.add(`${fileErrorMatch[1]}:${fileErrorMatch[2].trim()}`);
          }
        }
        
        // Warning patterns  
        if (line.toLowerCase().includes('warning:')) {
          const fileWarningMatch = line.match(/([^:]+\.(?:swift|c(?:pp)?|h|mm?)):\d+:\d+.*?warning:\s*(.+)/i);
          if (fileWarningMatch) {
            result.warnings.add(`${fileWarningMatch[1]}:${fileWarningMatch[2].trim()}`);
          }
        }
      }
      
      resolve({
        errors: Array.from(result.errors),
        warnings: Array.from(result.warnings), 
        notes: Array.from(result.notes)
      });
    });
    
    gunzip.on('error', () => {
      resolve({
        errors: ['Failed to parse build log'],
        warnings: [], 
        notes: []
      });
    });
  });
}

async function main() {
  const projectPath = '/Users/felix/Gits/Transit/Transit-iOS-2/Transit.xcodeproj';
  
  console.log('Finding DerivedData...');
  const derivedData = await findProjectDerivedData(projectPath);
  console.log('DerivedData:', derivedData);
  
  console.log('Getting latest build log...');
  const log = await getLatestBuildLog(projectPath);
  console.log('Latest log:', log);
  
  if (log) {
    console.log('Parsing build log...');
    const results = await parseBuildLog(log.path);
    console.log('Results:', results);
    
    if (results.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      results.errors.forEach(error => console.log(`  • ${error}`));
    }
    
    if (results.warnings.length > 0) {
      console.log('\n⚠️ WARNINGS:');
      results.warnings.forEach(warning => console.log(`  • ${warning}`));
    }
    
    if (results.errors.length === 0 && results.warnings.length === 0) {
      console.log('\n✅ No errors or warnings found');
    }
  }
}

main().catch(console.error);