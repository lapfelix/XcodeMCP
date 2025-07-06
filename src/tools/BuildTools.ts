import { stat } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { JXAExecutor } from '../utils/JXAExecutor.js';
import { BuildLogParser } from '../utils/BuildLogParser.js';
import { PathValidator } from '../utils/PathValidator.js';
import { ErrorHelper } from '../utils/ErrorHelper.js';
import { ParameterNormalizer } from '../utils/ParameterNormalizer.js';
import { Logger } from '../utils/Logger.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import type { McpResult, OpenProjectCallback } from '../types/index.js';

export class BuildTools {
  public static async build(
    projectPath: string, 
    schemeName: string, 
    destination: string | null = null, 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Normalize the scheme name for better matching
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const schemes = workspace.schemes();
          const schemeNames = schemes.map(scheme => scheme.name());
          
          // Try exact match first
          let targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(normalizedSchemeName)});
          
          // If not found, try original name
          if (!targetScheme) {
            targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
          }
          
          if (!targetScheme) {
            throw new Error('Scheme not found. Available: ' + JSON.stringify(schemeNames));
          }
          
          workspace.activeScheme = targetScheme;
          return 'Scheme set to ' + targetScheme.name();
        })()
      `;
      
      try {
        await JXAExecutor.execute(setSchemeScript);
      } catch (error) {
        const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('not found')) {
          try {
            // Get available schemes
            const availableSchemes = await this._getAvailableSchemes();
              
            // Try to find a close match with fuzzy matching
            const bestMatch = ParameterNormalizer.findBestMatch(schemeName, availableSchemes);
            let message = `❌ Scheme '${schemeName}' not found\n\nAvailable schemes:\n`;
            
            availableSchemes.forEach(scheme => {
              if (scheme === bestMatch) {
                message += `  • ${scheme} ← Did you mean this?\n`;
              } else {
                message += `  • ${scheme}\n`;
              }
            });
            
            return { content: [{ type: 'text', text: message }] };
          } catch {
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, ErrorHelper.getSchemeNotFoundGuidance(schemeName)) }] };
          }
        }
        
        return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${errorMessage}` }] };
      }

    if (destination) {
      // Normalize the destination name for better matching
      const normalizedDestination = ParameterNormalizer.normalizeDestinationName(destination);
      
      const setDestinationScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const destinations = workspace.runDestinations();
          const destinationNames = destinations.map(dest => dest.name());
          
          // Try exact match first
          let targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(normalizedDestination)});
          
          // If not found, try original name
          if (!targetDestination) {
            targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(destination)});
          }
          
          if (!targetDestination) {
            throw new Error('Destination not found. Available: ' + JSON.stringify(destinationNames));
          }
          
          workspace.activeRunDestination = targetDestination;
          return 'Destination set to ' + targetDestination.name();
        })()
      `;
      
      try {
        await JXAExecutor.execute(setDestinationScript);
      } catch (error) {
        const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('not found')) {
          try {
            // Extract available destinations from error message if present
            let availableDestinations: string[] = [];
            if (errorMessage.includes('Available:')) {
              const availablePart = errorMessage.split('Available: ')[1];
              // Find the JSON array part
              const jsonMatch = availablePart?.match(/\[.*?\]/);
              if (jsonMatch) {
                try {
                  availableDestinations = JSON.parse(jsonMatch[0]);
                } catch {
                  availableDestinations = await this._getAvailableDestinations();
                }
              }
            } else {
              availableDestinations = await this._getAvailableDestinations();
            }
              
            // Try to find a close match with fuzzy matching
            const bestMatch = ParameterNormalizer.findBestMatch(destination, availableDestinations);
            let guidance = ErrorHelper.getDestinationNotFoundGuidance(destination, availableDestinations);
            
            if (bestMatch && bestMatch !== destination) {
              guidance += `\n• Did you mean '${bestMatch}'?`;
            }
            
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Destination '${destination}' not found`, guidance) }] };
          } catch {
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Destination '${destination}' not found`, ErrorHelper.getDestinationNotFoundGuidance(destination)) }] };
          }
        }
        
        return { content: [{ type: 'text', text: `Failed to set destination '${destination}': ${errorMessage}` }] };
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
      
      // Check for and handle "replace existing build" alert
      await this._handleReplaceExistingBuildAlert();
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Failed to start build: ${errorMessage}` }] };
    }

    Logger.info('Waiting for new build log to appear after build start...');
    
    let attempts = 0;
    let newLog = null;
    const initialWaitAttempts = 3600; // 1 hour max to wait for build log

    while (attempts < initialWaitAttempts) {
      const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
      
      if (currentLog) {
        const logTime = currentLog.mtime.getTime();
        const buildTime = buildStartTime;
        Logger.debug(`Checking log: ${currentLog.path}, log time: ${logTime}, build time: ${buildTime}, diff: ${logTime - buildTime}ms`);
        
        if (logTime > buildTime) {
          newLog = currentLog;
          Logger.info(`Found new build log created after build start: ${newLog.path}`);
          break;
        }
      } else {
        Logger.debug(`No build log found yet, attempt ${attempts + 1}/${initialWaitAttempts}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Build started but no new build log appeared within ${initialWaitAttempts} seconds`, ErrorHelper.getBuildLogNotFoundGuidance()) }] };
    }

    Logger.info(`Monitoring build completion for log: ${newLog.path}`);
    
    attempts = 0;
    const maxAttempts = 3600; // 1 hour max for build completion
    let lastLogSize = 0;
    let stableCount = 0;

    while (attempts < maxAttempts) {
      try {
        const logStats = await stat(newLog.path);
        const currentLogSize = logStats.size;
        
        if (currentLogSize === lastLogSize) {
          stableCount++;
          if (stableCount >= 1) {
            Logger.debug(`Log stable for ${stableCount}s, trying to parse...`);
            const results = await BuildLogParser.parseBuildLog(newLog.path);
            Logger.debug(`Parse result has ${results.errors.length} errors, ${results.warnings.length} warnings`);
            const isParseFailure = results.errors.some(error => 
              typeof error === 'string' && error.includes('XCLogParser failed to parse the build log.')
            );
            if (results && !isParseFailure) {
              Logger.info(`Build completed, log parsed successfully: ${newLog.path}`);
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
          Logger.debug(`Build log changed to: ${currentLog.path}`);
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
    
    Logger.info(`Build completed${schemeInfo}${destInfo} - ${results.errors.length} errors, ${results.warnings.length} warnings`);
    
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED${schemeInfo}${destInfo} (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
        Logger.error('Build error:', error);
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message = `⚠️ BUILD COMPLETED WITH WARNINGS${schemeInfo}${destInfo} (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
        Logger.warn('Build warning:', warning);
      });
    } else {
      message = `✅ BUILD SUCCESSFUL${schemeInfo}${destInfo}`;
    }

    return { content: [{ type: 'text', text: message }] };
  }

  public static async clean(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
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

  public static async test(
    projectPath: string, 
    commandLineArguments: string[] = [], 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Get initial xcresult files to detect new ones
    const initialXCResults = await this._findXCResultFiles(projectPath);
    const testStartTime = Date.now();
    Logger.info(`Test start time: ${new Date(testStartTime).toISOString()}, found ${initialXCResults.length} initial XCResult files`);

    // Start the test action

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const actionResult = workspace.test({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const actionResult = workspace.test();`
        }
        
        // Return immediately - we'll monitor the build separately
        return JSON.stringify({ 
          actionId: actionResult.id(),
          message: 'Test started'
        });
      })()
    `;
    
    try {
      const startResult = await JXAExecutor.execute(script);
      const { actionId, message } = JSON.parse(startResult);
      
      Logger.info(`${message} with action ID: ${actionId}`);
      
      // Check for and handle "replace existing build" alert
      await this._handleReplaceExistingBuildAlert();
      
      // Check for build errors with polling approach
      Logger.info('Monitoring for build logs...');
      
      // Poll for build logs for up to 30 seconds
      let foundLogs = false;
      for (let i = 0; i < 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const logs = await BuildLogParser.getRecentBuildLogs(projectPath, testStartTime);
        if (logs.length > 0) {
          Logger.info(`Found ${logs.length} build logs after ${(i + 1) * 5} seconds`);
          foundLogs = true;
          break;
        }
        Logger.info(`No logs found after ${(i + 1) * 5} seconds, continuing to wait...`);
      }
      
      if (!foundLogs) {
        Logger.info('No build logs found after 30 seconds - build may not have started yet');
      }
      
      Logger.info('Build monitoring complete, proceeding to analysis...');
      
      // Get ALL recent build logs for analysis (test might create multiple logs)
      Logger.info(`DEBUG: testStartTime = ${testStartTime} (${new Date(testStartTime)})`);
      Logger.info(`DEBUG: projectPath = ${projectPath}`);
      
      // First check if we can find DerivedData
      const derivedData = await BuildLogParser.findProjectDerivedData(projectPath);
      Logger.info(`DEBUG: derivedData = ${derivedData}`);
      
      const recentLogs = await BuildLogParser.getRecentBuildLogs(projectPath, testStartTime);
      Logger.info(`DEBUG: recentLogs.length = ${recentLogs.length}`);
      if (recentLogs.length > 0) {
        Logger.info(`Analyzing ${recentLogs.length} recent build logs created during test...`);
        
        let totalErrors: string[] = [];
        let totalWarnings: string[] = [];
        
        // Analyze each recent log to catch build errors in any of them
        for (const log of recentLogs) {
          try {
            Logger.info(`Analyzing build log: ${log.path}`);
            const results = await BuildLogParser.parseBuildLog(log.path);
            Logger.info(`Log analysis: ${results.errors.length} errors, ${results.warnings.length} warnings`);
            
            // Accumulate errors and warnings from all logs
            totalErrors.push(...results.errors);
            totalWarnings.push(...results.warnings);
            
          } catch (error) {
            Logger.warn(`Failed to parse build log ${log.path}: ${error instanceof Error ? error.message : error}`);
          }
        }
        
        Logger.info(`Total build analysis: ${totalErrors.length} errors, ${totalWarnings.length} warnings`);
        
        Logger.info(`DEBUG: totalErrors = ${JSON.stringify(totalErrors)}`);
        Logger.info(`DEBUG: totalErrors.length = ${totalErrors.length}`);
        Logger.info(`DEBUG: totalErrors.length > 0 = ${totalErrors.length > 0}`);
        
        if (totalErrors.length > 0) {
          let message = `❌ TEST BUILD FAILED (${totalErrors.length} errors)\n\nERRORS:\n`;
          totalErrors.forEach(error => {
            message += `  • ${error}\n`;
            Logger.error('Test build error:', error);
          });
          
          if (totalWarnings.length > 0) {
            message += `\n⚠️ WARNINGS (${totalWarnings.length}):\n`;
            totalWarnings.slice(0, 10).forEach(warning => {
              message += `  • ${warning}\n`;
              Logger.warn('Test build warning:', warning);
            });
            if (totalWarnings.length > 10) {
              message += `  ... and ${totalWarnings.length - 10} more warnings\n`;
            }
          }
          
          Logger.error('ABOUT TO THROW McpError for test build failure');
          throw new McpError(ErrorCode.InternalError, message);
        } else if (totalWarnings.length > 0) {
          Logger.warn(`Test build completed with ${totalWarnings.length} warnings`);
          totalWarnings.slice(0, 10).forEach(warning => {
            Logger.warn('Test build warning:', warning);
          });
          if (totalWarnings.length > 10) {
            Logger.warn(`... and ${totalWarnings.length - 10} more warnings`);
          }
        }
      } else {
        Logger.info(`DEBUG: No recent build logs found since ${new Date(testStartTime)}`);
      }

      // Since build passed, now wait for test execution to complete
      Logger.info('Build succeeded, waiting for test execution to complete...');
      
      // Monitor test completion with proper AppleScript checking and 6-hour safety timeout
      const maxTestTime = 21600000; // 6 hours safety timeout
      let testCompleted = false;
      let monitoringSeconds = 0;
      
      Logger.info('Monitoring test completion with 6-hour safety timeout...');
      
      while (!testCompleted && (Date.now() - testStartTime) < maxTestTime) {
        try {
          // Check test completion via AppleScript every 30 seconds
          const checkScript = `
            (function() {
              const app = Application('Xcode');
              const workspace = app.activeWorkspaceDocument();
              if (!workspace) return 'No workspace';
              
              const actions = workspace.schemeActionResults();
              for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
                if (action.id() === "${actionId}") {
                  const status = action.status();
                  const completed = action.completed();
                  return status + ':' + completed;
                }
              }
              return 'Action not found';
            })()
          `;
          
          const result = await JXAExecutor.execute(checkScript, 15000);
          const [status, completed] = result.split(':');
          
          // Log progress every 2 minutes
          if (monitoringSeconds % 120 === 0) {
            Logger.info(`Test monitoring: ${Math.floor(monitoringSeconds/60)}min - Action ${actionId}: status=${status}, completed=${completed}`);
          }
          
          // Check if test is complete
          if (completed === 'true' && (status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'error occurred')) {
            testCompleted = true;
            Logger.info(`Test completed after ${Math.floor(monitoringSeconds/60)} minutes: status=${status}`);
            break;
          }
          
        } catch (error) {
          Logger.warn(`Test monitoring error at ${Math.floor(monitoringSeconds/60)}min: ${error instanceof Error ? error.message : error}`);
        }
        
        // Wait 30 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 30000));
        monitoringSeconds += 30;
      }
      
      if (!testCompleted) {
        Logger.warn('Test monitoring reached 6-hour timeout - proceeding anyway');
      }
      
      Logger.info('Test monitoring result: Test completion detected or timeout reached');
      
      // Only AFTER test completion is confirmed, look for the xcresult file
      Logger.info('Test execution completed, now looking for XCResult file...');
      let newXCResult = await this._findNewXCResultFile(projectPath, initialXCResults, testStartTime);
      
      // If no xcresult found yet, wait for it to appear (should be quick now that tests are done)
      if (!newXCResult) {
        Logger.info('No xcresult file found yet, waiting for it to appear...');
        let attempts = 0;
        const maxWaitAttempts = 15; // 15 seconds to find the file after test completion
        
        while (attempts < maxWaitAttempts && !newXCResult) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          newXCResult = await this._findNewXCResultFile(projectPath, initialXCResults, testStartTime);
          attempts++;
        }
        
        // If still no XCResult found, the test likely didn't run at all
        if (!newXCResult) {
          Logger.warn('No XCResult file found - test may not have run or current scheme has no tests');
          return { 
            content: [{ 
              type: 'text', 
              text: `⚠️ TEST EXECUTION UNCLEAR\n\nNo XCResult file was created, which suggests:\n• The current scheme may not have test targets configured\n• Tests may have been skipped\n• There may be configuration issues\n\n💡 Try:\n• Use a scheme with test targets (look for schemes ending in '-Tests')\n• Check that the project has test targets configured\n• Run tests manually in Xcode first to verify setup\n\nAvailable schemes: Use 'xcode_get_schemes' to see all schemes` 
            }] 
          };
        }
      }
      
      let testResult: { status: string, error: string | undefined } = { status: 'completed', error: undefined };
      
      if (newXCResult) {
        Logger.info(`Found xcresult file: ${newXCResult}, waiting for it to be fully written...`);
        
        // Calculate how long the test took
        const testEndTime = Date.now();
        const testDurationMs = testEndTime - testStartTime;
        const testDurationMinutes = Math.round(testDurationMs / 60000);
        
        // Wait 8% of test duration before even attempting to read XCResult
        // This gives Xcode plenty of time to finish writing everything
        const proportionalWaitMs = Math.round(testDurationMs * 0.08);
        const proportionalWaitSeconds = Math.round(proportionalWaitMs / 1000);
        
        Logger.info(`Test ran for ${testDurationMinutes} minutes`);
        Logger.info(`Applying 8% wait time: ${proportionalWaitSeconds} seconds before checking XCResult`);
        Logger.info(`This prevents premature reads that could contribute to file corruption`);
        
        await new Promise(resolve => setTimeout(resolve, proportionalWaitMs));
        
        // Now use the robust waiting method with the test duration for context
        const isReady = await XCResultParser.waitForXCResultReadiness(newXCResult, testDurationMs); // Pass test duration for proportional timeouts
        
        if (isReady) {
          // File is ready, verify analysis works
          try {
            Logger.info('XCResult file is ready, performing final verification...');
            const parser = new XCResultParser(newXCResult);
            const analysis = await parser.analyzeXCResult();
          
            if (analysis && analysis.totalTests >= 0) {
              Logger.info(`XCResult parsing successful! Found ${analysis.totalTests} tests`);
              testResult = { status: 'completed', error: undefined };
            } else {
              Logger.error('XCResult parsed but incomplete test data found');
              testResult = { 
                status: 'failed', 
                error: `XCResult file exists but contains incomplete test data. This may indicate an Xcode bug.` 
              };
            }
          } catch (parseError) {
            Logger.error(`XCResult file appears to be corrupt: ${parseError instanceof Error ? parseError.message : parseError}`);
            testResult = { 
              status: 'failed', 
              error: `XCResult file is corrupt or unreadable. This is likely an Xcode bug. Parse error: ${parseError instanceof Error ? parseError.message : parseError}` 
            };
          }
        } else {
          Logger.error('XCResult file failed to become ready within 3 minutes');
          testResult = { 
            status: 'failed', 
            error: `XCResult file failed to become readable within 3 minutes despite multiple verification attempts. This indicates an Xcode bug where the file remains corrupt or incomplete.` 
          };
        }
      } else {
        Logger.warn('No xcresult file found after test completion');
        testResult = { status: 'completed', error: 'No XCResult file found' };
      }
      
      if (newXCResult) {
        Logger.info(`Found xcresult: ${newXCResult}`);
        
        // Check if the xcresult file is corrupt
        if (testResult.status === 'failed' && testResult.error) {
          // XCResult file is corrupt
          let message = `❌ XCODE BUG DETECTED${hasArgs ? ` (test with arguments ${JSON.stringify(commandLineArguments)})` : ''}\n\n`;
          message += `XCResult Path: ${newXCResult}\n\n`;
          message += `⚠️ ${testResult.error}\n\n`;
          message += `This is a known Xcode issue where the .xcresult file becomes corrupt even though Xcode reports test completion.\n\n`;
          message += `💡 Troubleshooting steps:\n`;
          message += `  1. Restart Xcode and retry\n`;
          message += `  2. Delete DerivedData and retry\n\n`;
          message += `The corrupt XCResult file is at:\n${newXCResult}`;
          
          return { content: [{ type: 'text', text: message }] };
        }
        
        // We already confirmed the xcresult is readable in our completion detection loop
        // No need to wait again - proceed directly to analysis
        if (testResult.status === 'completed') {
          try {
            // Use shared utility to format test results with individual test details
            const parser = new XCResultParser(newXCResult);
            const testSummary = await parser.formatTestResultsSummary(true, 5);
            
            let message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
            message += `XCResult Path: ${newXCResult}\n`;
            message += testSummary + `\n\n`;
            
            const analysis = await parser.analyzeXCResult();
            if (analysis.failedTests > 0) {
              message += `💡 Inspect test results:\n`;
              message += `  • Browse results: xcresult_browse <path>\n`;
              message += `  • Get console output: xcresult_browser_get_console <path> <test-id>\n`;
              message += `  • Get screenshots: xcresult_get_screenshot <path> <test-id> <timestamp>\n`;
              message += `  • Get UI hierarchy: xcresult_get_ui_hierarchy <path> <test-id> <timestamp>\n`;
              message += `  • Get element details: xcresult_get_ui_element <hierarchy-json> <index>\n`;
              message += `  • List attachments: xcresult_list_attachments <path> <test-id>\n`;
              message += `  • Export attachments: xcresult_export_attachment <path> <test-id> <index>\n`;
              message += `  • Quick summary: xcresult_summary <path>\n`;
              message += `\n💡 Tip: Use console output to find failure timestamps for screenshots and UI hierarchies`;
            } else {
              message += `✅ All tests passed!\n\n`;
              message += `💡 Explore test results:\n`;
              message += `  • Browse results: xcresult_browse <path>\n`;
              message += `  • Get console output: xcresult_browser_get_console <path> <test-id>\n`;
              message += `  • Get screenshots: xcresult_get_screenshot <path> <test-id> <timestamp>\n`;
              message += `  • Get UI hierarchy: xcresult_get_ui_hierarchy <path> <test-id> <timestamp>\n`;
              message += `  • Get element details: xcresult_get_ui_element <hierarchy-json> <index>\n`;
              message += `  • List attachments: xcresult_list_attachments <path> <test-id>\n`;
              message += `  • Export attachments: xcresult_export_attachment <path> <test-id> <index>\n`;
              message += `  • Quick summary: xcresult_summary <path>`;
            }
            
            return { content: [{ type: 'text', text: message }] };
          } catch (parseError) {
            Logger.warn(`Failed to parse xcresult: ${parseError}`);
            // Fall back to basic result
            let message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
            message += `XCResult Path: ${newXCResult}\n`;
            message += `Status: ${testResult.status}\n\n`;
            message += `Note: XCResult parsing failed, but test file is available for manual inspection.\n\n`;
            message += `💡 Inspect test results:\n`;
            message += `  • Browse results: xcresult_browse <path>\n`;
            message += `  • Get console output: xcresult_browser_get_console <path> <test-id>\n`;
            message += `  • Get screenshots: xcresult_get_screenshot <path> <test-id> <timestamp>\n`;
            message += `  • Get UI hierarchy: xcresult_get_ui_hierarchy <path> <test-id> <timestamp>\n`;
            message += `  • Get element details: xcresult_get_ui_element <hierarchy-json> <index>\n`;
            message += `  • List attachments: xcresult_list_attachments <path> <test-id>\n`;
            message += `  • Export attachments: xcresult_export_attachment <path> <test-id> <index>\n`;
            message += `  • Quick summary: xcresult_summary <path>`;
            
            return { content: [{ type: 'text', text: message }] };
          }
        } else {
          // Test completion detection timed out
          let message = `🧪 TESTS ${testResult.status.toUpperCase()}${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
          message += `XCResult Path: ${newXCResult}\n`;
          message += `Status: ${testResult.status}\n\n`;
          message += `⚠️ Test completion detection timed out, but XCResult file is available.\n\n`;
          message += `💡 Inspect test results:\n`;
          message += `  • Browse results: xcresult_browse <path>\n`;
          message += `  • Get console output: xcresult_browser_get_console <path> <test-id>\n`;
          message += `  • Get screenshots: xcresult_get_screenshot <path> <test-id> <timestamp>\n`;
          message += `  • Get UI hierarchy: xcresult_get_ui_hierarchy <path> <test-id> <timestamp>\n`;
          message += `  • Get element details: xcresult_get_ui_element <hierarchy-json> <index>\n`;
          message += `  • List attachments: xcresult_list_attachments <path> <test-id>\n`;
          message += `  • Export attachments: xcresult_export_attachment <path> <test-id> <index>\n`;
          message += `  • Quick summary: xcresult_summary <path>`;
          
          return { content: [{ type: 'text', text: message }] };
        }
      } else {
        // No xcresult found - fall back to basic result
        if (testResult.status === 'failed') {
          return { content: [{ type: 'text', text: `❌ TEST FAILED\n\n${testResult.error || 'Test execution failed'}\n\nNote: No XCResult file found for detailed analysis.` }] };
        }
        
        const message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\nStatus: ${testResult.status}\n\nNote: No XCResult file found for detailed analysis.`;
        return { content: [{ type: 'text', text: message }] };
      }
    } catch (error) {
      // Re-throw McpErrors to properly signal build failures
      if (error instanceof McpError) {
        throw error;
      }
      
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Failed to run tests: ${errorMessage}` }] };
    }
  }

  public static async run(
    projectPath: string, 
    schemeName: string,
    commandLineArguments: string[] = [], 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Set the scheme
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const schemeNames = schemes.map(scheme => scheme.name());
        
        // Try exact match first
        let targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(normalizedSchemeName)});
        
        // If not found, try original name
        if (!targetScheme) {
          targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
        }
        
        if (!targetScheme) {
          throw new Error('Scheme not found. Available: ' + JSON.stringify(schemeNames));
        }
        
        workspace.activeScheme = targetScheme;
        return 'Scheme set to ' + targetScheme.name();
      })()
    `;
    
    try {
      await JXAExecutor.execute(setSchemeScript);
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found')) {
        try {
          // Get available schemes
          const availableSchemes = await this._getAvailableSchemes();
            
          // Try to find a close match with fuzzy matching
          const bestMatch = ParameterNormalizer.findBestMatch(schemeName, availableSchemes);
          let message = `❌ Scheme '${schemeName}' not found\n\nAvailable schemes:\n`;
          
          availableSchemes.forEach(scheme => {
            if (scheme === bestMatch) {
              message += `  • ${scheme} ← Did you mean this?\n`;
            } else {
              message += `  • ${scheme}\n`;
            }
          });
          
          return { content: [{ type: 'text', text: message }] };
        } catch {
          return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, ErrorHelper.getSchemeNotFoundGuidance(schemeName)) }] };
        }
      }
      
      return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${errorMessage}` }] };
    }

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
    
    // Check for and handle "replace existing build" alert
    await this._handleReplaceExistingBuildAlert();

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
    const buildMaxAttempts = 7200; // 1 hour max for run operation build (600 attempts × 500ms = 5min -> 7200 × 500ms = 1hr)

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
    Logger.info(`Run build completed - ${results.errors.length} errors, ${results.warnings.length} warnings`);
    
    if (results.errors.length > 0) {
      message += `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
        Logger.error('Run build error:', error);
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message += `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
        Logger.warn('Run build warning:', warning);
      });
    } else {
      message += '✅ BUILD SUCCESSFUL - App should be launching';
    }

    return { content: [{ type: 'text', text: message }] };
  }

  public static async debug(
    projectPath: string, 
    scheme?: string, 
    skipBuilding = false, 
    openProject?: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    if (openProject) {
      await openProject(projectPath);
    }

    const hasParams = scheme || skipBuilding;
    let paramsObj: { scheme?: string; skipBuilding?: boolean } = {};
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
    
    // Check for and handle "replace existing build" alert
    await this._handleReplaceExistingBuildAlert();
    
    return { content: [{ type: 'text', text: result }] };
  }

  public static async stop(): Promise<McpResult> {
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

  private static async _getAvailableSchemes(): Promise<string[]> {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) return JSON.stringify([]);
        
        const schemes = workspace.schemes();
        const schemeNames = schemes.map(scheme => scheme.name());
        return JSON.stringify(schemeNames);
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  private static async _getAvailableDestinations(): Promise<string[]> {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) return [];
        
        const destinations = workspace.runDestinations();
        return destinations.map(dest => dest.name());
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  private static async _findXCResultFiles(projectPath: string): Promise<{ path: string; mtime: number; size?: number }[]> {
    const xcresultFiles: { path: string; mtime: number; size?: number }[] = [];
    
    try {
      // Use existing BuildLogParser logic to find the correct DerivedData directory
      const derivedData = await BuildLogParser.findProjectDerivedData(projectPath);
      
      if (derivedData) {
        // Look for xcresult files in the Test logs directory
        const testLogsDir = join(derivedData, 'Logs', 'Test');
        try {
          const files = await readdir(testLogsDir);
          const xcresultDirs = files.filter(file => file.endsWith('.xcresult'));
          
          for (const xcresultDir of xcresultDirs) {
            const fullPath = join(testLogsDir, xcresultDir);
            try {
              const stats = await stat(fullPath);
              xcresultFiles.push({
                path: fullPath,
                mtime: stats.mtime.getTime(),
                size: stats.size
              });
            } catch {
              // Ignore files we can't stat
            }
          }
        } catch (error) {
          Logger.debug(`Could not read test logs directory: ${error}`);
        }
      }
    } catch (error) {
      Logger.warn(`Error finding xcresult files: ${error}`);
    }
    
    return xcresultFiles.sort((a, b) => b.mtime - a.mtime);
  }


  private static async _findNewXCResultFile(
    projectPath: string, 
    initialFiles: { path: string; mtime: number }[], 
    testStartTime: number
  ): Promise<string | null> {
    const maxAttempts = 30; // 30 seconds
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const currentFiles = await this._findXCResultFiles(projectPath);
      
      // Look for new files created after test start
      for (const file of currentFiles) {
        const wasInitialFile = initialFiles.some(initial => 
          initial.path === file.path && initial.mtime === file.mtime
        );
        
        if (!wasInitialFile && file.mtime >= testStartTime - 5000) { // 5s buffer
          Logger.info(`Found new xcresult file: ${file.path}, mtime: ${new Date(file.mtime)}, test start: ${new Date(testStartTime)}`);
          return file.path;
        } else if (!wasInitialFile) {
          Logger.warn(`Found xcresult file but too old: ${file.path}, mtime: ${new Date(file.mtime)}, test start: ${new Date(testStartTime)}, diff: ${file.mtime - testStartTime}ms`);
        } else {
          Logger.debug(`Skipping initial file: ${file.path}, mtime: ${new Date(file.mtime)}`);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    // If no new file found, look for files created AFTER test start time
    const allFiles = await this._findXCResultFiles(projectPath);
    
    // Find files created after the test started (not just within the timeframe)
    const filesAfterTestStart = allFiles.filter(file => file.mtime > testStartTime);
    
    if (filesAfterTestStart.length > 0) {
      // Return the newest file that was created after the test started
      const mostRecentAfterTest = filesAfterTestStart[0]; // Already sorted newest first
      if (mostRecentAfterTest) {
        Logger.warn(`Using most recent xcresult file created after test start: ${mostRecentAfterTest.path}`);
        return mostRecentAfterTest.path;
      }
    } else if (allFiles.length > 0) {
      const mostRecent = allFiles[0];
      if (mostRecent) {
        Logger.debug(`Most recent file too old: ${mostRecent.path}, mtime: ${new Date(mostRecent.mtime)}, test start: ${new Date(testStartTime)}`);
      }
    }
    
    return null;
  }

  /**
   * Find XCResult files for a given project
   */
  public static async findXCResults(projectPath: string): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    try {
      const xcresultFiles = await this._findXCResultFiles(projectPath);
      
      if (xcresultFiles.length === 0) {
        return { 
          content: [{ 
            type: 'text', 
            text: `No XCResult files found for project: ${projectPath}\n\nXCResult files are created when you run tests. Try running tests first with 'xcode_test'.`
          }] 
        };
      }

      let message = `🔍 Found ${xcresultFiles.length} XCResult file(s) for project: ${projectPath}\n\n`;
      message += `📁 XCResult Files (sorted by newest first):\n`;
      message += '='.repeat(80) + '\n';

      xcresultFiles.forEach((file, index) => {
        const date = new Date(file.mtime);
        const timeAgo = this._getTimeAgo(file.mtime);
        
        message += `${index + 1}. ${file.path}\n`;
        message += `   📅 Created: ${date.toLocaleString()} (${timeAgo})\n`;
        message += `   📊 Size: ${this._formatFileSize(file.size || 0)}\n\n`;
      });

      message += `💡 Usage:\n`;
      message += `  • View results: xcresult_browse "<path>"\n`;
      message += `  • Get console: xcresult_browser_get_console "<path>" <test-id>\n`;
      
      return { content: [{ type: 'text', text: message }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { 
        content: [{ 
          type: 'text', 
          text: `Failed to find XCResult files: ${errorMessage}` 
        }] 
      };
    }
  }

  private static _getTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  private static _formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 bytes';
    
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  /**
   * Handle alerts that appear when starting builds/tests while another operation is in progress.
   * This includes "replace existing build" alerts and similar dialog overlays.
   */
  private static async _handleReplaceExistingBuildAlert(): Promise<void> {
    const alertScript = `
      (function() {
        try {
          // Use System Events approach first as it's more reliable for sheet dialogs
          const systemEvents = Application('System Events');
          const xcodeProcesses = systemEvents.processes.whose({name: 'Xcode'});
          
          if (xcodeProcesses.length > 0) {
            const xcodeProcess = xcodeProcesses[0];
            const windows = xcodeProcess.windows();
            
            // Check for sheets in regular windows (most common case)
            for (let i = 0; i < windows.length; i++) {
              try {
                const window = windows[i];
                const sheets = window.sheets();
                
                if (sheets && sheets.length > 0) {
                  const sheet = sheets[0];
                  const buttons = sheet.buttons();
                  
                  // Look for Replace, Continue, OK, Yes buttons (in order of preference)
                  const preferredButtons = ['Replace', 'Continue', 'OK', 'Yes', 'Stop and Replace'];
                  
                  for (const preferredButton of preferredButtons) {
                    for (let b = 0; b < buttons.length; b++) {
                      try {
                        const button = buttons[b];
                        const buttonTitle = button.title();
                        
                        if (buttonTitle === preferredButton) {
                          button.click();
                          return 'Sheet alert handled: clicked ' + buttonTitle;
                        }
                      } catch (e) {
                        // Continue to next button
                      }
                    }
                  }
                  
                  // If no preferred button found, try partial matches
                  for (let b = 0; b < buttons.length; b++) {
                    try {
                      const button = buttons[b];
                      const buttonTitle = button.title();
                      
                      if (buttonTitle && (
                        buttonTitle.toLowerCase().includes('replace') ||
                        buttonTitle.toLowerCase().includes('continue') ||
                        buttonTitle.toLowerCase().includes('stop') ||
                        buttonTitle.toLowerCase() === 'ok' ||
                        buttonTitle.toLowerCase() === 'yes'
                      )) {
                        button.click();
                        return 'Sheet alert handled: clicked ' + buttonTitle + ' (partial match)';
                      }
                    } catch (e) {
                      // Continue to next button
                    }
                  }
                  
                  // Log available buttons for debugging
                  const availableButtons = [];
                  for (let b = 0; b < buttons.length; b++) {
                    try {
                      availableButtons.push(buttons[b].title());
                    } catch (e) {
                      availableButtons.push('(unnamed)');
                    }
                  }
                  
                  return 'Sheet found but no suitable button. Available: ' + JSON.stringify(availableButtons);
                }
              } catch (e) {
                // Continue to next window
              }
            }
            
            // Check for modal dialogs
            const dialogs = xcodeProcess.windows.whose({subrole: 'AXDialog'});
            for (let d = 0; d < dialogs.length; d++) {
              try {
                const dialog = dialogs[d];
                const buttons = dialog.buttons();
                
                for (let b = 0; b < buttons.length; b++) {
                  try {
                    const button = buttons[b];
                    const buttonTitle = button.title();
                    
                    if (buttonTitle && (
                      buttonTitle.toLowerCase().includes('replace') ||
                      buttonTitle.toLowerCase().includes('continue') ||
                      buttonTitle.toLowerCase().includes('stop') ||
                      buttonTitle.toLowerCase() === 'ok' ||
                      buttonTitle.toLowerCase() === 'yes'
                    )) {
                      button.click();
                      return 'Dialog alert handled: clicked ' + buttonTitle;
                    }
                  } catch (e) {
                    // Continue to next button
                  }
                }
              } catch (e) {
                // Continue to next dialog
              }
            }
          }
          
          // Fallback to Xcode app approach for embedded alerts
          const app = Application('Xcode');
          const windows = app.windows();
          
          for (let i = 0; i < windows.length; i++) {
            try {
              const window = windows[i];
              const sheets = window.sheets();
              
              if (sheets && sheets.length > 0) {
                const sheet = sheets[0];
                const buttons = sheet.buttons();
                
                for (let j = 0; j < buttons.length; j++) {
                  try {
                    const button = buttons[j];
                    const buttonName = button.name();
                    
                    if (buttonName && (
                      buttonName.toLowerCase().includes('replace') ||
                      buttonName.toLowerCase().includes('continue') ||
                      buttonName.toLowerCase().includes('stop') ||
                      buttonName.toLowerCase() === 'ok' ||
                      buttonName.toLowerCase() === 'yes'
                    )) {
                      button.click();
                      return 'Xcode app sheet handled: clicked ' + buttonName;
                    }
                  } catch (e) {
                    // Continue to next button
                  }
                }
              }
            } catch (e) {
              // Continue to next window
            }
          }
          
          return 'No alert found';
          
        } catch (error) {
          return 'Alert check failed: ' + error.message;
        }
      })()
    `;
    
    try {
      Logger.info('Running alert detection script...');
      const result = await JXAExecutor.execute(alertScript);
      Logger.info(`Alert detection result: ${result}`);
      if (result && result !== 'No alert found') {
        Logger.info(`Alert handling: ${result}`);
      } else {
        Logger.info('No alerts detected');
      }
    } catch (error) {
      // Don't fail the main operation if alert handling fails
      Logger.info(`Alert handling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}