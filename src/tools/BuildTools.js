import { stat } from 'fs/promises';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { JXAExecutor } from '../utils/JXAExecutor.js';
import { BuildLogParser } from '../utils/BuildLogParser.js';
import { PathValidator } from '../utils/PathValidator.js';

export class BuildTools {
  static async build(projectPath, schemeName = null, destination = null, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    if (schemeName) {
      const setSchemeScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const schemes = workspace.schemes();
          const targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
          
          if (!targetScheme) {
            throw new Error('Scheme ' + ${JSON.stringify(schemeName)} + ' not found');
          }
          
          workspace.activeScheme = targetScheme;
          return 'Scheme set to ' + ${JSON.stringify(schemeName)};
        })()
      `;
      
      try {
        await JXAExecutor.execute(setSchemeScript);
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${error.message}` }] };
      }
    }

    if (destination) {
      const setDestinationScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const destinations = workspace.runDestinations();
          const targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(destination)});
          
          if (!targetDestination) {
            throw new Error('Destination ' + ${JSON.stringify(destination)} + ' not found');
          }
          
          workspace.activeRunDestination = targetDestination;
          return 'Destination set to ' + ${JSON.stringify(destination)};
        })()
      `;
      
      try {
        await JXAExecutor.execute(setDestinationScript);
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to set destination '${destination}': ${error.message}` }] };
      }
    }

    const buildScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        workspace.build();
        
        return 'Build started';
      })()
    `;
    
    const buildStartTime = Date.now();
    
    try {
      await JXAExecutor.execute(buildScript);
    } catch (error) {
      return { content: [{ type: 'text', text: `Failed to start build: ${error.message}` }] };
    }

    console.error(`Waiting for new build log to appear after build start...`);
    
    let attempts = 0;
    let newLog = null;
    const initialWaitAttempts = 1800;

    while (attempts < initialWaitAttempts) {
      const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
      
      if (currentLog) {
        const logTime = currentLog.mtime.getTime();
        const buildTime = buildStartTime;
        console.error(`Checking log: ${currentLog.path}, log time: ${logTime}, build time: ${buildTime}, diff: ${logTime - buildTime}ms`);
        
        if (logTime > buildTime) {
          newLog = currentLog;
          console.error(`Found new build log created after build start: ${newLog.path}`);
          break;
        }
      } else {
        console.error(`No build log found yet, attempt ${attempts + 1}/${initialWaitAttempts}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `Build started but no new build log appeared within ${initialWaitAttempts} seconds` }] };
    }

    console.error(`Monitoring build completion for log: ${newLog.path}`);
    
    attempts = 0;
    const maxAttempts = 1200;
    let lastLogSize = 0;
    let stableCount = 0;

    while (attempts < maxAttempts) {
      try {
        const logStats = await stat(newLog.path);
        const currentLogSize = logStats.size;
        
        if (currentLogSize === lastLogSize) {
          stableCount++;
          if (stableCount >= 1) {
            console.error(`Log stable for ${stableCount}s, trying to parse...`);
            const results = await BuildLogParser.parseBuildLog(newLog.path);
            console.error(`Parse result has ${results.errors.length} errors, ${results.warnings.length} warnings`);
            const isParseFailure = results.errors.some(error => 
              typeof error === 'string' && error.includes('XCLogParser failed to parse the build log.')
            );
            if (results && !isParseFailure) {
              console.error(`Build completed, log parsed successfully: ${newLog.path}`);
              break;
            }
          }
        } else {
          lastLogSize = currentLogSize;
          stableCount = 0;
        }
      } catch (error) {
        const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
        if (currentLog && currentLog.path !== newLog.path && currentLog.mtime.getTime() > buildStartTime) {
          console.error(`Build log changed to: ${currentLog.path}`);
          newLog = currentLog;
          lastLogSize = 0;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return { content: [{ type: 'text', text: `Build timed out after ${maxAttempts} seconds` }] };
    }
    
    const results = await BuildLogParser.parseBuildLog(newLog.path);
    
    let message = '';
    const schemeInfo = schemeName ? ` for scheme '${schemeName}'` : '';
    const destInfo = destination ? ` and destination '${destination}'` : '';
    
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED${schemeInfo}${destInfo} (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message = `⚠️ BUILD COMPLETED WITH WARNINGS${schemeInfo}${destInfo} (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message = `✅ BUILD SUCCESSFUL${schemeInfo}${destInfo}`;
    }

    return { content: [{ type: 'text', text: message }] };
  }

  static async clean(projectPath, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const actionResult = workspace.clean();
        
        while (true) {
          if (actionResult.completed()) {
            break;
          }
          delay(0.5);
        }
        
        return \`Clean completed. Result ID: \${actionResult.id()}\`;
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async test(projectPath, commandLineArguments = [], openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const result = workspace.test({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.test();`
        }
        return \`Test started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async run(projectPath, commandLineArguments = [], openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const initialLog = await BuildLogParser.getLatestBuildLog(projectPath);
    const initialTime = Date.now();

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const result = workspace.run({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.run();`
        }
        return \`Run started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const runResult = await JXAExecutor.execute(script);

    let newLog = null;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      newLog = await BuildLogParser.getLatestBuildLog(projectPath);
      
      if (newLog && (!initialLog || newLog.path !== initialLog.path || 
                     newLog.mtime.getTime() > initialTime)) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `${runResult}\n\nNote: Run triggered but no build log found (app may have launched without building)` }] };
    }

    let lastModified = 0;
    let stableCount = 0;
    attempts = 0;
    const buildMaxAttempts = 600;

    while (attempts < buildMaxAttempts) {
      const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
      if (currentLog) {
        const currentModified = currentLog.mtime.getTime();
        if (currentModified === lastModified) {
          stableCount++;
          if (stableCount >= 6) {
            break;
          }
        } else {
          lastModified = currentModified;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    const results = await BuildLogParser.parseBuildLog(newLog.path);
    
    let message = `${runResult}\n\n`;
    if (results.errors.length > 0) {
      message += `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message += `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message += '✅ BUILD SUCCESSFUL - App should be launching';
    }

    return { content: [{ type: 'text', text: message }] };
  }

  static async debug(projectPath, scheme, skipBuilding = false, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const hasParams = scheme || skipBuilding;
    let paramsObj = {};
    if (scheme) paramsObj.scheme = scheme;
    if (skipBuilding) paramsObj.skipBuilding = skipBuilding;
    
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasParams 
          ? `const result = workspace.debug(${JSON.stringify(paramsObj)});`
          : `const result = workspace.debug();`
        }
        return \`Debug started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async stop() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        workspace.stop();
        return 'Stop command sent';
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }
}