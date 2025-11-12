import { stat, readdir, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { spawn, execFile } from 'child_process';
import { tmpdir, homedir } from 'os';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { JXAExecutor } from '../utils/JXAExecutor.js';
import { BuildLogParser } from '../utils/BuildLogParser.js';
import PathValidator from '../utils/PathValidator.js';
import ErrorHelper from '../utils/ErrorHelper.js';
import { ParameterNormalizer } from '../utils/ParameterNormalizer.js';
import Logger from '../utils/Logger.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import { getWorkspaceByPathScript } from '../utils/JXAHelpers.js';
import type { BuildLogInfo, McpResult, OpenProjectCallback, ParsedBuildResults } from '../types/index.js';
import BuildLogStore, { BuildLogRecord } from '../utils/BuildLogStore.js';
import LockManager from '../utils/LockManager.js';

const FAILURE_STATUS_TOKENS = ['fail', 'error', 'cancel', 'terminate', 'abort'];

export class BuildTools {
  private static pendingTestOptions: {
    testPlanPath?: string;
    selectedTests?: string[];
    selectedTestClasses?: string[];
    testTargetIdentifier?: string;
    testTargetName?: string;
    schemeName?: string;
    deviceType?: string;
    osVersion?: string;
  } | null = null;

  public static setPendingTestOptions(options: {
    testPlanPath?: string;
    selectedTests?: string[];
    selectedTestClasses?: string[];
    testTargetIdentifier?: string;
    testTargetName?: string;
    schemeName?: string;
    deviceType?: string;
    osVersion?: string;
  }): void {
    Logger.debug(`Pending test options set: ${JSON.stringify(options)}`);
    this.pendingTestOptions = options;
  }

  public static async build(
    projectPath: string,
    schemeName: string,
    reason: string,
    destination: string | null = null,
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    let logRecord: BuildLogRecord | null = null;
    let lockFooterText: string | null = null;
    let autoReleaseNote: string | null = null;
    const applyLockMessaging = (message: string): string => {
      if (autoReleaseNote) {
        const note = `🔓 Lock automatically released: ${autoReleaseNote}\nNo manual release command is required for this attempt.`;
        return `${message}\n\n${note}`;
      }
      return LockManager.appendFooter(message, lockFooterText);
    };
    const attachLogHint = (message: string): string => {
      if (!logRecord) return applyLockMessaging(message);
      const hintLines = [
        '🪵 Build Log Metadata',
        `  • Log ID: ${logRecord.id}`,
        `  • Path: ${logRecord.logPath}`,
      ];
      if (logRecord.schemeName) {
        hintLines.splice(1, 0, `  • Scheme: ${logRecord.schemeName}`);
      }
      if (logRecord.destination) {
        hintLines.splice(hintLines.length - 1, 0, `  • Destination: ${logRecord.destination}`);
      }
      hintLines.push(`  • View: xcodecontrol view-build-log --log-id ${logRecord.id}`);
      return applyLockMessaging(`${message}\n\n${hintLines.join('\n')}`);
    };
    const finalizeLogStatus = (status: 'active' | 'completed' | 'failed', buildStatus?: string | null) => {
      const extras =
        buildStatus === undefined
          ? undefined
          : {
              buildStatus,
            };
      BuildLogStore.updateStatus(logRecord?.id, status, extras);
    };

    // Normalize the scheme name for better matching
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
        (function() {
          ${getWorkspaceByPathScript(projectPath)}
          
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
            const availableSchemes = await this._getAvailableSchemes(projectPath);
              
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
      // Pre-compute destination name candidates for flexible matching
      const destinationCandidates = ParameterNormalizer.getDestinationNameCandidates(destination);
      
      const setDestinationScript = `
        (function() {
          ${getWorkspaceByPathScript(projectPath)}
          
          const destinations = workspace.runDestinations();
          const destinationNames = destinations.map(dest => dest.name());
          const candidateNames = ${JSON.stringify(destinationCandidates)};
          
          const findMatch = (names) => {
            if (!names || !names.length) {
              return null;
            }
            for (const name of names) {
              const match = destinations.find(dest => dest.name() === name);
              if (match) {
                return match;
              }
            }
            return null;
          };
          
          // Try exact match first
          let targetDestination = findMatch(candidateNames);
          
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
                  availableDestinations = await this._getAvailableDestinations(projectPath);
                }
              }
            } else {
              availableDestinations = await this._getAvailableDestinations(projectPath);
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

    const { footerText: buildLockFooter } = await LockManager.acquireLock(projectPath, reason, 'xcode_build');
    lockFooterText = buildLockFooter;
    let lockReleased = false;
    const releaseLockNow = async (): Promise<void> => {
      if (lockReleased) {
        return;
      }
      try {
        await LockManager.releaseLock(projectPath);
      } catch (error) {
        Logger.warn(
          `Failed to release build lock for ${projectPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        lockReleased = true;
      }
    };
    const markAutoRelease = async (reasonText: string): Promise<void> => {
      autoReleaseNote = reasonText;
      await releaseLockNow();
    };

    const buildScript = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
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
        await markAutoRelease('Failed to start the build in Xcode');
        return {
          content: [{ type: 'text', text: applyLockMessaging(enhancedError) }],
        };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      await markAutoRelease('Failed to start the build in Xcode');
      return {
        content: [{ type: 'text', text: applyLockMessaging(`Failed to start build: ${errorMessage}`) }],
      };
    }

    Logger.info('Waiting for new build log to appear after build start...');
    
    let attempts = 0;
    let newLog: BuildLogInfo | null = null;
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
      await markAutoRelease('Build log never appeared');
      return {
        content: [
          {
            type: 'text',
            text: applyLockMessaging(
              ErrorHelper.createErrorWithGuidance(
                `Build started but no new build log appeared within ${initialWaitAttempts} seconds`,
                ErrorHelper.getBuildLogNotFoundGuidance(),
              ),
            ),
          },
        ],
      };
    }

    if (!logRecord) {
      logRecord = BuildLogStore.registerLog({
        projectPath,
        logPath: newLog.path,
        schemeName,
        destination,
        action: 'build',
        logKind: 'build',
      });
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
      finalizeLogStatus('failed', 'timeout');
      await markAutoRelease('Build timed out');
      return {
        content: [{ type: 'text', text: attachLogHint(`Build timed out after ${maxAttempts} seconds`) }],
      };
    }
    
    const results = await BuildLogParser.parseBuildLog(newLog.path, 0, 6, { timeoutMs: 45000 });

    const normalizedStatus = results.buildStatus ? results.buildStatus.toLowerCase() : null;
    const statusIndicatesFailure = normalizedStatus
      ? normalizedStatus !== 'stopped' &&
        normalizedStatus !== 'interrupted' &&
        FAILURE_STATUS_TOKENS.some(token => normalizedStatus.includes(token))
      : false;
    const summaryIndicatesFailure = typeof results.errorCount === 'number' && results.errorCount > 0;

    if (results.errors.length === 0 && (statusIndicatesFailure || summaryIndicatesFailure)) {
      const descriptor = results.buildStatus
        ? `Xcode reported build status '${results.buildStatus}'`
        : 'Xcode reported build errors in the log summary';
      results.errors = [
        `${descriptor} for log ${newLog.path}. Open the log in Xcode for full details.`,
      ];
    }
    
    let message = '';
    const schemeInfo = schemeName ? ` for scheme '${schemeName}'` : '';
    const destInfo = destination ? ` and destination '${destination}'` : '';
    
    Logger.info(`Build completed${schemeInfo}${destInfo} - ${results.errors.length} errors, ${results.warnings.length} warnings, status: ${results.buildStatus || 'unknown'}`);
    
    // Handle stopped/interrupted builds
    if (results.buildStatus === 'stopped') {
      message = `⏹️ BUILD INTERRUPTED${schemeInfo}${destInfo}\n\nThe build was stopped or interrupted before completion.\n\n💡 This may happen when:\n  • The build was cancelled manually\n  • Xcode was closed during the build\n  • System resources were exhausted\n\nTry running the build again to complete it.`;
      finalizeLogStatus('failed', results.buildStatus);
      await markAutoRelease('Build was interrupted');
      return { content: [{ type: 'text', text: attachLogHint(message) }] };
    }
    
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED${schemeInfo}${destInfo} (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
        Logger.error('Build error:', error);
      });
      finalizeLogStatus('failed', results.buildStatus ?? 'failed');
      await markAutoRelease('Build failed with errors');
      throw new McpError(
        ErrorCode.InternalError,
        attachLogHint(message)
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

    finalizeLogStatus('completed', results.buildStatus ?? null);
    return { content: [{ type: 'text', text: attachLogHint(message) }] };
  }

  public static async clean(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
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
    destination: string | null,
    commandLineArguments: string[] = [],
    _openProject: OpenProjectCallback,
    options?: {
      testPlanPath?: string;
      selectedTests?: string[];
      selectedTestClasses?: string[];
      testTargetIdentifier?: string;
      testTargetName?: string;
      schemeName?: string;
      deviceType?: string;
      osVersion?: string;
    }
  ): Promise<McpResult> {
    if ((!options || Object.keys(options).length === 0) && this.pendingTestOptions) {
      Logger.debug(`Using pending test options fallback: ${JSON.stringify(this.pendingTestOptions)}`);
      options = this.pendingTestOptions;
      this.pendingTestOptions = null;
    } else {
      this.pendingTestOptions = null;
    }

    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    const requestedScheme = options?.schemeName;
    if (!requestedScheme || requestedScheme.trim().length === 0) {
      return {
        content: [{
          type: 'text',
          text: `Error: scheme parameter is required when running tests with xcodebuild.\n\n💡 Pass --scheme or set XCODE_MCP_PREFERRED_SCHEME.`
        }]
      };
    }

    const requestedDeviceType = options?.deviceType ? options.deviceType.trim() : '';
    const requestedOsVersion = options?.osVersion ? options.osVersion.trim() : '';

    let destinationArgs: string[] | null = null;
    let destinationLabel = destination ?? '';

    if (requestedDeviceType) {
      const deviceSelection = await this._buildDestinationArgsForDevice(requestedDeviceType, requestedOsVersion || null);
      if (!deviceSelection) {
        return {
          content: [{
            type: 'text',
            text: `Error: Unable to find a simulator for device '${requestedDeviceType}'${requestedOsVersion ? ` with OS ${requestedOsVersion}` : ''}.\n\n💡 Open Simulator.app to download the desired runtime, or supply an explicit destination string.`
          }]
        };
      }
      destinationArgs = deviceSelection.args;
      destinationLabel = deviceSelection.label;
    } else if (destination && destination.trim().length > 0) {
      destinationArgs = await this._buildDestinationArgs(destination);
      if (!destinationArgs) {
        return {
          content: [{
            type: 'text',
            text: `Error: Could not determine destination from '${destination}'.\n\n💡 Provide a full xcodebuild destination string (e.g., platform=iOS Simulator,name iPhone 16) or a recognizable simulator name.`
          }]
        };
      }
      if (destinationArgs.length > 1) {
        destinationLabel = destinationArgs[1] ?? destinationArgs[0] ?? (destination ?? 'unspecified destination');
      } else {
        destinationLabel = destination ?? (destinationArgs[0] ?? 'unspecified destination');
      }
    } else {
      return {
        content: [{
          type: 'text',
          text: 'Error: destination or device_type is required.\n\nSupply an explicit destination string or provide device_type (iphone, ipad, mac, etc.) and os_version.'
        }]
      };
    }

    if (!destinationArgs) {
      return {
        content: [{ type: 'text', text: 'Error: Unable to compute a destination for the requested device.' }],
      };
    }

    const finalDestinationArgs = destinationArgs;

    let buildContainerPath = projectPath;
    let projectFlag: '-workspace' | '-project' | null = null;

    if (projectPath.endsWith('.xcworkspace')) {
      projectFlag = '-workspace';
    } else if (projectPath.endsWith('.xcodeproj')) {
      const workspaceCandidate = join(dirname(projectPath), `${basename(projectPath, '.xcodeproj')}.xcworkspace`);
      if (await this._pathExists(workspaceCandidate)) {
        projectFlag = '-workspace';
        buildContainerPath = workspaceCandidate;
        Logger.info(`Detected workspace at ${workspaceCandidate} – using it for xcodebuild to ensure shared schemes load correctly`);
      } else {
        projectFlag = '-project';
      }
    }

    if (!projectFlag) {
      return {
        content: [{
          type: 'text',
          text: `Error: Unsupported project type. Expected .xcodeproj or .xcworkspace, received: ${projectPath}`
        }]
      };
    }

    const schemeResolution = await this._resolveSchemeName(projectFlag, buildContainerPath, requestedScheme);
    if (!schemeResolution.ok) {
      return schemeResolution.result;
    }

    const schemeName = schemeResolution.schemeName;
    if (options) {
      options.schemeName = schemeName;
    }

    if (options?.testPlanPath) {
      Logger.info(`Ignoring test plan path '${options.testPlanPath}' when invoking xcodebuild. Using -only-testing to target specific tests.`);
    }

    const testStartTime = Date.now();

    const sanitizedArgs: string[] = [];
    const onlyTestingIdentifiers = new Set<string>();

    if (commandLineArguments && commandLineArguments.length > 0) {
      for (let i = 0; i < commandLineArguments.length; i += 1) {
        const rawArg = commandLineArguments[i];
        if (!rawArg || typeof rawArg !== 'string') {
          continue;
        }

        const arg = rawArg.trim();
        if (arg.length === 0) {
          continue;
        }

        if (arg === '-only-testing') {
          const next = commandLineArguments[i + 1];
          if (typeof next === 'string' && next.trim().length > 0) {
            onlyTestingIdentifiers.add(next.trim());
            i += 1;
          }
          continue;
        }

        if (arg.startsWith('-only-testing:')) {
          const identifier = arg.slice('-only-testing:'.length).trim();
          if (identifier.length > 0) {
            onlyTestingIdentifiers.add(identifier);
          }
          continue;
        }

        sanitizedArgs.push(arg);
      }
    }

    if (options?.selectedTests?.length) {
      for (const testIdentifier of options.selectedTests) {
        if (typeof testIdentifier === 'string' && testIdentifier.trim().length > 0) {
          onlyTestingIdentifiers.add(testIdentifier.trim());
        }
      }
    }

    if (options?.selectedTestClasses?.length) {
      let targetPrefix: string | null = options.testTargetName ?? null;

      if (!targetPrefix && options.testTargetIdentifier) {
        targetPrefix = options.testTargetIdentifier;
      }

      if (!targetPrefix && options.selectedTests?.length) {
        for (const identifier of options.selectedTests) {
          if (typeof identifier === 'string' && identifier.includes('/')) {
            targetPrefix = identifier.split('/')[0] ?? null;
            if (targetPrefix) {
              break;
            }
          }
        }
      }

      for (const className of options.selectedTestClasses) {
        if (typeof className !== 'string' || className.trim().length === 0) {
          continue;
        }

        const trimmed = className.trim();
        const identifier = trimmed.includes('/')
          ? trimmed
          : targetPrefix
            ? `${targetPrefix}/${trimmed}`
            : trimmed;

        if (identifier.length > 0) {
          onlyTestingIdentifiers.add(identifier);
        }
      }
    }

    if (onlyTestingIdentifiers.size > 0) {
      Logger.info(`Applying -only-testing filter for ${onlyTestingIdentifiers.size} test identifier(s).`);
    }

    const spawnEnv = {
      ...process.env,
      NSUnbufferedIO: 'YES'
    } as NodeJS.ProcessEnv;

    if (!('SIMCTL_CHILD_wait_for_debugger' in spawnEnv) || !spawnEnv.SIMCTL_CHILD_wait_for_debugger) {
      spawnEnv.SIMCTL_CHILD_wait_for_debugger = '0';
    }
    if (!('SIMCTL_CHILD_WAIT_FOR_DEBUGGER' in spawnEnv) || !spawnEnv.SIMCTL_CHILD_WAIT_FOR_DEBUGGER) {
      spawnEnv.SIMCTL_CHILD_WAIT_FOR_DEBUGGER = '0';
    }

    const buildWorkingDirectory = dirname(buildContainerPath);
    const fallbackNotices: string[] = [];
    let finalAttempt: {
      exitCode: number;
      stdoutBuffer: string;
      stderrBuffer: string;
      resultBundlePath: string;
    } | null = null;
    let disableParallel = false;
    let attempt = 0;

    while (attempt < 2) {
      attempt += 1;
      const resultBundlePath = await this._createTemporaryResultBundlePath(
        `test-${disableParallel ? 'serial' : 'parallel'}`,
      );

      const xcodebuildArgs: string[] = [
        'test',
        projectFlag,
        buildContainerPath,
        '-scheme',
        schemeName,
        ...finalDestinationArgs,
        '-resultBundlePath',
        resultBundlePath
      ];

      if (sanitizedArgs.length > 0) {
        xcodebuildArgs.push(...sanitizedArgs);
      }

      if (onlyTestingIdentifiers.size > 0) {
        for (const identifier of onlyTestingIdentifiers) {
          xcodebuildArgs.push(`-only-testing:${identifier}`);
        }
      }

      if (disableParallel) {
        if (!this._hasArgument(xcodebuildArgs, '-parallel-testing-enabled')) {
          xcodebuildArgs.push('-parallel-testing-enabled', 'NO');
        }
        if (!this._hasArgument(xcodebuildArgs, '-maximum-concurrent-test-simulator-destinations')) {
          xcodebuildArgs.push('-maximum-concurrent-test-simulator-destinations', '1');
        }
        if (!this._hasArgument(xcodebuildArgs, '-disable-concurrent-testing')) {
          xcodebuildArgs.push('-disable-concurrent-testing');
        }
      }

      Logger.info(`Starting xcodebuild test attempt #${attempt} for scheme '${schemeName}' with destination '${destinationLabel}'${disableParallel ? ' (parallel testing disabled)' : ''}`);

      let stdoutBuffer = '';
      let stderrBuffer = '';

      const child = spawn('xcodebuild', xcodebuildArgs, {
        cwd: buildWorkingDirectory,
        env: spawnEnv
      });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', data => {
        stdoutBuffer += data;
        data.split(/\r?\n/).filter(Boolean).forEach((line: string) => Logger.info(`[xcodebuild] ${line}`));
      });

      child.stderr.on('data', data => {
        stderrBuffer += data;
        data.split(/\r?\n/).filter(Boolean).forEach((line: string) => Logger.warn(`[xcodebuild] ${line}`));
      });

      const exitCode: number = await new Promise(resolve => {
        child.on('close', code => resolve(code ?? 0));
        child.on('error', err => {
          Logger.error(`xcodebuild failed to start: ${err instanceof Error ? err.message : String(err)}`);
          resolve(1);
        });
      });

      Logger.info(`xcodebuild attempt #${attempt} completed with exit code ${exitCode}`);

      if (!disableParallel) {
        const cloneFailure = this._detectSimulatorCloneFailure(`${stdoutBuffer}\n${stderrBuffer}`);
        if (cloneFailure.matched) {
          const notice = `ℹ️ Detected simulator clone failure for ${cloneFailure.deviceName ?? 'the requested simulator'}; retrying with parallel testing disabled.`;
          fallbackNotices.push(notice);
          Logger.warn(`Simulator clone failure detected for ${cloneFailure.deviceName ?? 'unknown simulator'} – retrying with parallel testing disabled.`);
          disableParallel = true;
          continue;
        }
      }

      finalAttempt = {
        exitCode,
        stdoutBuffer,
        stderrBuffer,
        resultBundlePath
      };
      break;
    }

    if (!finalAttempt) {
      throw new McpError(
        ErrorCode.InternalError,
        'xcodebuild did not complete successfully after retrying with parallel testing disabled.'
      );
    }

    const { exitCode, stdoutBuffer, stderrBuffer, resultBundlePath } = finalAttempt;

    const testDurationMs = Date.now() - testStartTime;
    const xcresultExists = await this._pathExists(resultBundlePath);
    const derivedDataPath =
      (await BuildLogParser.findProjectDerivedData(buildContainerPath)) ??
      join(tmpdir(), 'xcodemcp-derived-data', 'unknown');

    try {
      if (!xcresultExists) {
        const header = exitCode === 0
          ? '✅ TESTS COMPLETED'
          : exitCode === 65
            ? '❌ TESTS FAILED'
            : `❌ xcodebuild exited with code ${exitCode}`;
        let message = `${header}\n\n`;
        message += `xcodebuild did not produce a result bundle at:\n${resultBundlePath}\n\n`;
        if (stdoutBuffer.trim().length > 0) {
          message += `xcodebuild output:\n${stdoutBuffer.trim()}\n\n`;
        }
        if (stderrBuffer.trim().length > 0) {
          message += `stderr:\n${stderrBuffer.trim()}\n`;
        }
        if (fallbackNotices.length > 0) {
          message += `\n${fallbackNotices.join('\n')}`;
        }
        return { content: [{ type: 'text', text: message }] };
      }

      const ready = await XCResultParser.waitForXCResultReadiness(resultBundlePath, testDurationMs);
      if (!ready) {
        let message = `❌ XCODE BUG DETECTED\n\n`;
        message += `XCResult Path: ${resultBundlePath}\n\n`;
        message += `The result bundle was created but never became readable.\n`;
        message += `Try deleting DerivedData (${derivedDataPath}) and re-running the tests.\n`;
        if (fallbackNotices.length > 0) {
          message += `\n${fallbackNotices.join('\n')}`;
        }
        return { content: [{ type: 'text', text: message }] };
      }

      try {
        const parser = new XCResultParser(resultBundlePath);
        const testSummary = await parser.formatTestResultsSummary(true, 5);
        const analysis = await parser.analyzeXCResult();

        const header = analysis.failedTests > 0
          ? `❌ TESTS FAILED (${analysis.failedTests} test${analysis.failedTests === 1 ? '' : 's'} failed)`
          : '✅ All tests passed';

        let message = `🧪 TESTS COMPLETED (xcodebuild exit code ${exitCode})\n\n`;
        message += `${header}\n`;
        message += `XCResult Path: ${resultBundlePath}\n\n`;
        message += `${testSummary}\n\n`;

        if (analysis.failedTests > 0) {
          message += `💡 Inspect test results:\n`;
          message += `  • Browse results: xcresult-browse --xcresult-path "${resultBundlePath}"\n`;
          message += `  • Get console output: xcresult-browser-get-console --xcresult-path "${resultBundlePath}" --test-id <test-id>\n`;
          message += `  • Get screenshots: xcresult-get-screenshot --xcresult-path "${resultBundlePath}" --test-id <test-id> --timestamp <timestamp>\n`;
          message += `  • Get UI hierarchy: xcresult-get-ui-hierarchy --xcresult-path "${resultBundlePath}" --test-id <test-id>\n`;
          message += `  • Export attachments: xcresult-export-attachment --xcresult-path "${resultBundlePath}" --test-id <test-id> --index <index>\n`;
          message += `  • Quick summary: xcresult-summary --xcresult-path "${resultBundlePath}"\n`;
        } else {
          message += `💡 Explore test results:\n`;
          message += `  • Browse results: xcresult-browse --xcresult-path "${resultBundlePath}"\n`;
          message += `  • Get console output: xcresult-browser-get-console --xcresult-path "${resultBundlePath}" --test-id <test-id>\n`;
          message += `  • Get screenshots: xcresult-get-screenshot --xcresult-path "${resultBundlePath}" --test-id <test-id> --timestamp <timestamp>\n`;
          message += `  • Quick summary: xcresult-summary --xcresult-path "${resultBundlePath}"\n`;
        }

        if (analysis.failedTests === 0 && exitCode !== 0 && stdoutBuffer.trim().length > 0) {
          message += `\n⚠️ xcodebuild exit code ${exitCode} despite passing tests.\n`;
          message += `xcodebuild output:\n${stdoutBuffer.trim()}\n`;
        }

        if (fallbackNotices.length > 0) {
          message += `\n${fallbackNotices.join('\n')}`;
        }

        return { content: [{ type: 'text', text: message }] };
      } catch (error) {
        Logger.warn(`Failed to parse xcresult: ${error instanceof Error ? error.message : String(error)}`);
        let message = `🧪 TESTS COMPLETED (xcodebuild exit code ${exitCode})\n\n`;
        message += `XCResult Path: ${resultBundlePath}\n\n`;
        message += `Result bundle is available but could not be parsed automatically.`;
        if (stdoutBuffer.trim().length > 0) {
          message += `\n\nxcodebuild output:\n${stdoutBuffer.trim()}`;
        }
        if (fallbackNotices.length > 0) {
          message += `\n\n${fallbackNotices.join('\n')}`;
        }
        return { content: [{ type: 'text', text: message }] };
      }
    } finally {
      // keep result bundles available for inspection; no cleanup required
    }
  }

  public static async run(
    projectPath: string,
    schemeName: string,
    reason: string,
    commandLineArguments: string[] = [],
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    let logRecord: BuildLogRecord | null = null;
    let runLogRecord: BuildLogRecord | null = null;
    let lockFooterText: string | null = null;
    let autoReleaseNote: string | null = null;
    const applyLockFooter = (message: string): string => {
      if (autoReleaseNote) {
        const note = `🔓 Lock automatically released: ${autoReleaseNote}\nNo manual release command is required for this attempt.`;
        return `${message}\n\n${note}`;
      }
      return LockManager.appendFooter(message, lockFooterText);
    };
    const attachLogHint = (message: string): string => {
      if (!logRecord) return applyLockFooter(message);
      const hintLines = [
        '🪵 Build Log Metadata',
        `  • Log ID: ${logRecord.id}`,
        `  • Path: ${logRecord.logPath}`,
      ];
      if (logRecord.schemeName) {
        hintLines.splice(1, 0, `  • Scheme: ${logRecord.schemeName}`);
      }
      hintLines.push(`  • View: xcodecontrol view-build-log --log-id ${logRecord.id}`);
      return applyLockFooter(`${message}\n\n${hintLines.join('\n')}`);
    };
    const attachRunLogHint = (message: string): string => {
      if (!runLogRecord) return applyLockFooter(message);
      const hintLines = [
        '🪵 Run Log Metadata',
        `  • Log ID: ${runLogRecord.id}`,
        `  • Path: ${runLogRecord.logPath}`,
        `  • View: xcodecontrol view-run-log --log-id ${runLogRecord.id}`,
      ];
      if (runLogRecord.schemeName) {
        hintLines.splice(1, 0, `  • Scheme: ${runLogRecord.schemeName}`);
      }
      return applyLockFooter(`${message}\n\n${hintLines.join('\n')}`);
    };
    const attachAllHints = (message: string): string => attachRunLogHint(attachLogHint(message));
    const finalizeLogStatus = (status: 'active' | 'completed' | 'failed', buildStatus?: string | null) => {
      const extras =
        buildStatus === undefined
          ? undefined
          : {
              buildStatus,
            };
      BuildLogStore.updateStatus(logRecord?.id, status, extras);
    };

    // Set the scheme
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
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
          const availableSchemes = await this._getAvailableSchemes(projectPath);
            
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

    // Note: No longer need to track initial log since we use AppleScript completion detection
    const { footerText: runLockFooter } = await LockManager.acquireLock(projectPath, reason, 'xcode_build_and_run');
    lockFooterText = runLockFooter;
    let runLockReleased = false;
    const releaseRunLock = async (): Promise<void> => {
      if (runLockReleased) {
        return;
      }
      try {
        await LockManager.releaseLock(projectPath);
      } catch (error) {
        Logger.warn(
          `Failed to release run lock for ${projectPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        runLockReleased = true;
      }
    };
    const markRunAutoRelease = async (reasonText: string): Promise<void> => {
      autoReleaseNote = reasonText;
      await releaseRunLock();
    };

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
        ${hasArgs 
          ? `const result = workspace.run({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.run();`
        }
        return \`Run started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const runResult = await JXAExecutor.execute(script);
    
    // Extract the action ID from the result
    const actionIdMatch = runResult.match(/Result ID: (.+)/);
    const actionId = actionIdMatch ? actionIdMatch[1] : null;
    
    if (!actionId) {
      await markRunAutoRelease('Failed to read the run identifier from Xcode');
      return {
        content: [
          {
            type: 'text',
            text: applyLockFooter(`${runResult}\n\nError: Could not extract action ID from run result`),
          },
        ],
      };
    }
    
    Logger.info(`Run started with action ID: ${actionId}`);
    
    // Check for and handle "replace existing build" alert
    await this._handleReplaceExistingBuildAlert();

    // Monitor run completion using AppleScript instead of build log detection
    const maxRunTime = 3600000; // 1 hour safety timeout
    const runMonitorTimeoutMs = 50000; // exit early to avoid MCP call timeout
    const runStartTime = Date.now();
    const checkIntervalMs = 3000;
    const runningConfirmationMs = 6000;
    Logger.info(
      `Monitoring run completion using AppleScript for action ID: ${actionId} (interval=${checkIntervalMs}ms, running confirmation=${runningConfirmationMs}ms, guardrail=${runMonitorTimeoutMs}ms)`,
    );
    let runCompleted = false;
    let monitoringElapsedMs = 0;
    let runningObservedAt: number | null = null;
    let monitoringAbortedForTimeout = false;
    let lastStatus: string | null = null;
    let lastCompleted: string | null = null;
    let iteration = 0;
    
    while (!runCompleted && (Date.now() - runStartTime) < maxRunTime) {
      try {
        iteration += 1;
        // Check run completion via AppleScript at the configured interval
        const checkScript = `
          (function() {
            ${getWorkspaceByPathScript(projectPath)}
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
        
        const result = await JXAExecutor.execute(checkScript, 10000);
        const parts = result.split(':');
        const status = parts[0] ?? 'unknown';
        const completed: string | null = parts.length > 1 ? (parts[1] ?? '') : null;
        if (result === 'No workspace') {
          Logger.warn(`Run monitoring iteration ${iteration}: workspace not available yet.`);
        } else if (result === 'Action not found') {
          Logger.debug(`Run monitoring iteration ${iteration}: action ${actionId} not visible yet.`);
        }
        
        // Emit a log whenever status changes or every 2 minutes
        if (status !== lastStatus || completed !== lastCompleted) {
          Logger.info(
            `Run status update after ${Math.round((Date.now() - runStartTime) / 1000)}s: action=${actionId}, status=${status}, completed=${completed ?? 'n/a'}`,
          );
          lastStatus = status;
          lastCompleted = completed;
        } else if ((monitoringElapsedMs % 120000) === 0) {
          Logger.info(
            `Run status heartbeat at ${Math.floor(monitoringElapsedMs / 60000)}min: action=${actionId}, status=${status}, completed=${completed ?? 'n/a'}`,
          );
        }
        
        // For run actions, we need different completion logic than build/test
        // Run actions stay "running" even after successful app launch
        if (completed === 'true' && (status === 'failed' || status === 'cancelled' || status === 'error occurred')) {
          // Run failed/cancelled - this is a true completion
          runCompleted = true;
          Logger.info(
            `Run completed after ${Math.floor(monitoringElapsedMs / 60000)} minutes: status=${status}`,
          );
          break;
        } else if (status === 'running') {
          if (!runningObservedAt) {
            runningObservedAt = Date.now();
            Logger.info('Run reported status "running"; waiting briefly to confirm app launch.');
          } else if ((Date.now() - runningObservedAt) >= runningConfirmationMs) {
            // Assume the app launched successfully once we've seen "running" for long enough
            runCompleted = true;
            const elapsedMs = Date.now() - runStartTime;
            Logger.info(`Run appears successful after ${Math.round(elapsedMs / 1000)}s (status stayed 'running' for ~${Math.round((Date.now() - runningObservedAt) / 1000)}s)`);
            break;
          }
        } else if (status === 'succeeded') {
          // This might happen briefly during transition, wait a bit more
          Logger.info(`Run status shows 'succeeded', waiting to see if it transitions to 'running'...`);
        } else {
          runningObservedAt = null;
        }
        
      } catch (error) {
        Logger.warn(
          `Run monitoring error at ${Math.floor(monitoringElapsedMs / 60000)}min: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }

      if (!runCompleted && (Date.now() - runStartTime) >= runMonitorTimeoutMs) {
        monitoringAbortedForTimeout = true;
        Logger.warn(
          `Run monitoring exceeded 50s guardrail – returning early to avoid MCP timeout (last status: ${lastStatus ?? 'unknown'}, completed=${lastCompleted ?? 'n/a'})`,
        );
        break;
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
      monitoringElapsedMs += checkIntervalMs;
    }
    
    if (!runCompleted) {
      if (monitoringAbortedForTimeout) {
        Logger.warn(
          `Run monitoring exited early after ${Math.round((Date.now() - runStartTime) / 1000)}s (status=${lastStatus ?? 'unknown'}, completed=${lastCompleted ?? 'n/a'})`,
        );
        return {
          content: [
            {
              type: 'text',
              text: attachRunLogHint(`${runResult}\n\n⏳ Run is still in progress after approximately ${
              Math.round((Date.now() - runStartTime) / 1000)
              } seconds (last known status: ${lastStatus ?? 'unknown'}, completed=${lastCompleted ?? 'n/a'}).\n\nThe app should keep launching in Xcode/Simulator. Check Xcode's report navigator for the final build status or rerun this command once the launch completes.`),
            },
          ],
        };
      }
      Logger.warn('Run monitoring reached 1-hour timeout - proceeding anyway');
    }
    // Now find the build log that was created during this run
    Logger.info('Searching for build logs created during run...');
    const logSearchStart = Date.now();
    const logWaitTimeoutMs = 3600 * 1000; // 1 hour
    let newLog = null;
    while (Date.now() - logSearchStart < logWaitTimeoutMs) {
      const recentLogs = await BuildLogParser.getRecentBuildLogs(projectPath, runStartTime);
      const newestLog = recentLogs[0];
      if (newestLog) {
        Logger.info(
          `Found run build log created after start: ${newestLog.path} (mtime=${newestLog.mtime.toISOString()})`,
        );
        newLog = newestLog;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!newLog) {
      Logger.warn('Run completed but no new build log appeared; falling back to latest log.');
      newLog = await BuildLogParser.getLatestBuildLog(projectPath);
      if (!newLog) {
        return {
          content: [
            {
              type: 'text',
              text: attachRunLogHint(`${runResult}\n\nNote: Run completed but no build log was found (app may have launched without building).`),
            },
          ],
        };
      }
    }
    
    if (!logRecord) {
      logRecord = BuildLogStore.registerLog({
        projectPath,
        logPath: newLog.path,
        schemeName,
        action: 'run',
        logKind: 'build',
      });
    }

    const runConsoleLog = await BuildLogParser.getLatestRunLog(projectPath, runStartTime);
    if (runConsoleLog) {
      runLogRecord = BuildLogStore.registerLog({
        projectPath,
        logPath: runConsoleLog.path,
        schemeName,
        action: 'run',
        logKind: 'run',
      });
      BuildLogStore.updateStatus(runLogRecord.id, 'completed', { buildStatus: null });
    } else {
      Logger.warn('Unable to locate run console log for this session.');
    }

    Logger.info(`Run completed, parsing build log: ${newLog.path}`);

    const parseStart = Date.now();
    const parseTimeoutMs = 20000;
    let parseTimedOut = false;
    let parseError: unknown = null;
    let results: ParsedBuildResults | null = null;

    const parsePromise = BuildLogParser.parseBuildLog(newLog.path);

    parsePromise.catch(error => {
      parseError = error;
      Logger.error(`Build log parsing failed: ${error instanceof Error ? error.message : error}`);
    });

    try {
      results = await Promise.race<ParsedBuildResults | null>([
        parsePromise,
        new Promise(resolve => {
          setTimeout(() => {
            parseTimedOut = true;
            resolve(null);
          }, parseTimeoutMs);
        }),
      ]);
    } catch (error) {
      parseError = error;
      Logger.warn(
        `Build log parsing threw an error after ${Math.round((Date.now() - parseStart) / 1000)}s: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    if (parseTimedOut) {
      Logger.warn(
        `Build log parsing exceeded ${parseTimeoutMs / 1000}s guardrail for ${newLog.path}; returning early while parsing continues in background.`,
      );
      void parsePromise
        .then(finalResult => {
          Logger.info(
            `Deferred build log parse completed after ${Math.round((Date.now() - parseStart) / 1000)}s - errors=${finalResult.errors.length}, warnings=${finalResult.warnings.length}`,
          );
        })
        .catch(err => {
          Logger.warn(
            `Deferred build log parse failed: ${err instanceof Error ? err.message : err}`,
          );
        });
    } else if (results) {
      Logger.info(
        `Build log parsed in ${Math.round((Date.now() - parseStart) / 1000)}s - errors=${results.errors.length}, warnings=${results.warnings.length}`,
      );
    }
    
    let message = `${runResult}\n\n`;
    if (!results) {
      if (parseTimedOut) {
        message += '⏳ Build log parsing is still in progress (took longer than 20 seconds).\n\n';
        message += `Open the log in Xcode for full details:\n  • ${newLog.path}`;
      } else {
        message += '⚠️ Unable to summarize the build log automatically.\n\n';
        if (parseError instanceof Error) {
          message += `Reason: ${parseError.message}\n\n`;
        }
        message += `You can open the log manually in Xcode:\n  • ${newLog.path}`;
      }
      finalizeLogStatus('completed', null);
      return { content: [{ type: 'text', text: attachAllHints(message) }] };
    }

    Logger.info(
      `Run build completed - ${results.errors.length} errors, ${results.warnings.length} warnings, status: ${results.buildStatus || 'unknown'}`,
    );

    const normalizedStatus = results.buildStatus ? results.buildStatus.toLowerCase() : null;
    const statusIndicatesFailure = normalizedStatus
      ? normalizedStatus !== 'stopped' &&
        normalizedStatus !== 'interrupted' &&
        FAILURE_STATUS_TOKENS.some(token => normalizedStatus.includes(token))
      : false;
    const summaryIndicatesFailure =
      typeof results.errorCount === 'number' && results.errorCount > 0;

    if (results.errors.length === 0 && (statusIndicatesFailure || summaryIndicatesFailure)) {
      const descriptor = results.buildStatus
        ? `Xcode reported build status '${results.buildStatus}'`
        : 'Xcode reported build errors in the log summary';
      results.errors = [
        `${descriptor} for log ${newLog.path}. Open the log in Xcode for full details.`,
      ];
    }
    
    // Handle stopped/interrupted builds
    if (results.buildStatus === 'stopped') {
      message += `⏹️ BUILD INTERRUPTED\n\nThe build was stopped or interrupted before completion.\n\n💡 This may happen when:\n  • The build was cancelled manually\n  • Xcode was closed during the build\n  • System resources were exhausted\n\nTry running the build again to complete it.`;
      finalizeLogStatus('failed', results.buildStatus);
      await markRunAutoRelease('Run was interrupted');
      return { content: [{ type: 'text', text: attachLogHint(message) }] };
    }
    
    if (results.errors.length > 0) {
      message += `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      finalizeLogStatus('failed', results.buildStatus ?? 'failed');
      await markRunAutoRelease('Run build failed with errors');
      throw new McpError(
        ErrorCode.InternalError,
        attachAllHints(message)
      );
    } else if (results.warnings.length > 0) {
      message += `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message += '✅ BUILD SUCCESSFUL - App should be launching';
    }

    finalizeLogStatus('completed', results.buildStatus ?? null);
    return { content: [{ type: 'text', text: attachAllHints(message) }] };
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
        ${getWorkspaceByPathScript(projectPath)}
        
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

  public static async stop(projectPath: string): Promise<McpResult> {
    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
        workspace.stop();
        return 'Stop command sent';
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  private static async _getAvailableSchemes(projectPath: string): Promise<string[]> {
    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
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

  private static async _getAvailableDestinations(projectPath: string): Promise<string[]> {
    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
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
      message += `  • View results: xcresult-browse --xcresult-path "<path>"\n`;
      message += `  • Get console: xcresult-browser-get-console --xcresult-path "<path>" --test-id <test-id>\n`;
      
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

  private static async _pathExists(targetPath: string): Promise<boolean> {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private static async _buildDestinationArgs(destination: string): Promise<string[] | null> {
    if (!destination || typeof destination !== 'string') {
      return null;
    }

    const trimmed = destination.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.includes('=')) {
      return ['-destination', trimmed];
    }

    let name = trimmed;
    let osVersion: string | null = null;
    const parenMatch = trimmed.match(/^(.*)\(([^)]+)\)$/);
    if (parenMatch) {
      name = parenMatch[1]?.trim() ?? trimmed;
      osVersion = parenMatch[2]?.trim() ?? null;
    }

    const lowerName = name.toLowerCase();
    let platform = 'iOS Simulator';
    if (lowerName.includes('watch')) {
      platform = 'watchOS Simulator';
    } else if (lowerName.includes('tv')) {
      platform = 'tvOS Simulator';
    } else if (lowerName.includes('mac')) {
      platform = 'macOS';
    }

    if (platform === 'macOS') {
      let destinationValue = `platform=${platform}`;
      if (osVersion) {
        destinationValue += `,OS=${osVersion}`;
      }
      return ['-destination', destinationValue];
    }

    const originalInput = trimmed;
    let resolved = await this._findBestSimulatorId(name, osVersion, platform);
    if (!resolved && osVersion) {
      resolved = await this._findBestSimulatorId(name, null, platform);
    }
    if (!resolved && originalInput !== name) {
      resolved = await this._findBestSimulatorId(originalInput, null, platform);
    }
    if (resolved) {
      let destinationValue = `platform=${platform},id=${resolved.id}`;
      if (resolved.osVersion) {
        destinationValue += `,OS=${resolved.osVersion}`;
      } else if (osVersion) {
        destinationValue += `,OS=${osVersion}`;
      }
      return ['-destination', destinationValue];
    }

    let destinationValue = `platform=${platform},name=${name}`;
    if (osVersion) {
      destinationValue += `,OS=${osVersion}`;
    }
    return ['-destination', destinationValue];
  }

  private static async _buildDestinationArgsForDevice(
    deviceType: string,
    osVersion: string | null,
  ): Promise<{ args: string[]; label: string } | null> {
    const normalizedType = deviceType.trim().toLowerCase();
    if (normalizedType.length === 0) {
      return null;
    }

    const normalizedOs = osVersion && osVersion.trim().length > 0 ? osVersion.trim() : null;

    if (normalizedType.startsWith('mac')) {
      let destinationValue = 'platform=macOS';
      if (normalizedOs) {
        destinationValue += `,OS=${normalizedOs}`;
      }
      return { args: ['-destination', destinationValue], label: destinationValue };
    }

    let platform: 'iOS Simulator' | 'watchOS Simulator' | 'tvOS Simulator' | 'visionOS Simulator';
    let familyMatcher: (name: string) => boolean;

    if (normalizedType.startsWith('iphone') || normalizedType === 'ios' || normalizedType === 'phone') {
      platform = 'iOS Simulator';
      familyMatcher = name => name.toLowerCase().startsWith('iphone');
    } else if (normalizedType.startsWith('ipad')) {
      platform = 'iOS Simulator';
      familyMatcher = name => name.toLowerCase().startsWith('ipad');
    } else if (normalizedType.includes('watch')) {
      platform = 'watchOS Simulator';
      familyMatcher = name => name.toLowerCase().includes('apple watch');
    } else if (normalizedType.includes('tv')) {
      platform = 'tvOS Simulator';
      familyMatcher = name => name.toLowerCase().includes('apple tv');
    } else if (normalizedType.includes('vision')) {
      platform = 'visionOS Simulator';
      familyMatcher = name => name.toLowerCase().includes('vision');
    } else {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unsupported device_type '${deviceType}'. Expected values include iphone, ipad, mac, watch, tv, or vision.`,
      );
    }

    const inventory = await this._getSimulatorInventory();
    if (inventory.length === 0) {
      return null;
    }

    const preferenceKey = this._buildSimulatorPreferenceKey(platform, normalizedType, normalizedOs);
    const preferences = await this._loadSimulatorPreferences();
    const remembered = preferences[preferenceKey];

    const candidates = inventory
      .filter(device => device.platform === platform && familyMatcher(device.name) && device.isAvailable)
      .map(device => ({
        ...device,
        versionMatch: normalizedOs && device.runtimeVersion
          ? this._runtimeMatchesRequested(device.runtimeVersion, normalizedOs)
          : normalizedOs === null,
      }));

    if (candidates.length === 0) {
      return null;
    }

    const versionMatches = normalizedOs
      ? candidates.filter(candidate => candidate.versionMatch)
      : candidates;
    const candidatePool = versionMatches.length > 0 ? versionMatches : candidates;
    const allBooted = candidatePool.every(candidate => candidate.state.toLowerCase() === 'booted');

    let selected = null as (typeof candidates)[number] | null;
    if (remembered) {
      selected = candidatePool.find(candidate => candidate.udid === remembered.udid) ?? null;
      if (selected && selected.state.toLowerCase() === 'booted' && !allBooted) {
        selected = null;
      }
    }

    if (!selected) {
      const idleCandidates = candidatePool.filter(candidate => candidate.state.toLowerCase() !== 'booted');
      const rankingPool = idleCandidates.length > 0 ? idleCandidates : candidatePool;
      rankingPool.sort((a, b) => this._scoreSimulatorCandidate(b, normalizedOs) - this._scoreSimulatorCandidate(a, normalizedOs));
      selected = rankingPool[0] ?? null;
    }

    if (!selected) {
      return null;
    }

    const destinationOs = normalizedOs || selected.runtimeVersion || undefined;
    let destinationValue = `platform=${platform},id=${selected.udid}`;
    if (destinationOs) {
      destinationValue += `,OS=${destinationOs}`;
    }

    const rememberPayload: { udid: string; name?: string; runtimeVersion?: string } = {
      udid: selected.udid,
    };
    if (selected.name) {
      rememberPayload.name = selected.name;
    }
    if (selected.runtimeVersion) {
      rememberPayload.runtimeVersion = selected.runtimeVersion;
    }
    await this._rememberSimulatorSelection(preferenceKey, rememberPayload);

    const label = `${selected.name}${selected.runtimeVersion ? ` (${selected.runtimeVersion})` : ''}`;
    return { args: ['-destination', destinationValue], label };
  }

  private static async _findBestSimulatorId(
    name: string,
    osVersion: string | null,
    platform: string
  ): Promise<{ id: string; osVersion?: string } | null> {
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile('xcrun', ['simctl', 'list', 'devices', '--json'], (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      const parsed = JSON.parse(stdout) as {
        devices?: Record<string, Array<{ name: string; udid: string; isAvailable?: boolean; state?: string }>>;
      };

      if (parsed.devices) {
        const normalizedName = name.toLowerCase();
        let bestMatch: { id: string; osVersion?: string } | null = null;

        const desiredPrefix = platform.startsWith('watchOS')
          ? 'com.apple.CoreSimulator.SimRuntime.watchOS'
          : platform.startsWith('tvOS')
            ? 'com.apple.CoreSimulator.SimRuntime.tvOS'
            : 'com.apple.CoreSimulator.SimRuntime.iOS';

        for (const [runtime, devices] of Object.entries(parsed.devices)) {
          if (!runtime.startsWith(desiredPrefix)) {
            continue;
          }

          const runtimeVersionMatch = runtime.match(/-(\d+)-(\d+)/);
          const runtimeVersion = runtimeVersionMatch ? `${runtimeVersionMatch[1]}.${runtimeVersionMatch[2]}` : null;

          for (const device of devices ?? []) {
            if (!device || typeof device.name !== 'string' || typeof device.udid !== 'string') {
              continue;
            }

            if (device.isAvailable === false) {
              continue;
            }

            if (device.state && typeof device.state === 'string' && device.state.toLowerCase() === 'creating') {
              continue;
            }

            if (device.name.toLowerCase() !== normalizedName) {
              continue;
            }

            if (osVersion && runtimeVersion) {
              if (osVersion === runtimeVersion) {
                return { id: device.udid, osVersion: runtimeVersion };
              }

              if (!bestMatch) {
                bestMatch = { id: device.udid, osVersion: runtimeVersion };
              }
              continue;
            }

            if (!bestMatch) {
              bestMatch = runtimeVersion
                ? { id: device.udid, osVersion: runtimeVersion }
                : { id: device.udid };
            }
          }
        }

        if (bestMatch) {
          return bestMatch;
        }
      }
    } catch (error) {
      Logger.warn(`Failed to query simulator list: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile('xcrun', ['simctl', 'list', 'devices'], (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^\\s*${escapedName} \\(([0-9A-F-]+)\\)`, 'mi');
      const match = stdout.match(regex);
      if (match && match[1]) {
        return { id: match[1] };
      }
    } catch (error) {
      Logger.warn(`Failed to parse textual simulator list: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
  }

  private static async _getSchemesViaXcodebuild(
    projectFlag: '-workspace' | '-project',
    containerPath: string
  ): Promise<string[]> {
    return await new Promise(resolve => {
      const args = ['-list', projectFlag, containerPath];
      const child = spawn('xcodebuild', args);
      let stdoutBuffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        stdoutBuffer += chunk;
      });
      child.on('close', () => {
        const sections = stdoutBuffer.split('Schemes:');
        if (sections.length < 2) {
          resolve([]);
          return;
        }
        const schemesSection = sections[1] ?? '';
        const lines = schemesSection
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);
        resolve(lines);
      });
      child.on('error', () => resolve([]));
    });
  }

  private static async _resolveSchemeName(
    projectFlag: '-workspace' | '-project',
    containerPath: string,
    requestedScheme: string
  ): Promise<{ ok: true; schemeName: string } | { ok: false; result: McpResult }> {
    const availableSchemes = await this._getSchemesViaXcodebuild(projectFlag, containerPath);

    if (availableSchemes.length === 0) {
      return {
        ok: false,
        result: {
          content: [{
            type: 'text',
            text: `❌ No shared schemes found when inspecting ${basename(containerPath)}.\n\nMake sure the scheme is shared (Product → Scheme → Manage Schemes… → "Shared") and try again.`
          }]
        }
      };
    }

    const exact = availableSchemes.find(name => name === requestedScheme);
    if (exact) {
      return { ok: true, schemeName: exact };
    }

    const caseInsensitive = availableSchemes.find(name => name.toLowerCase() === requestedScheme.toLowerCase());
    if (caseInsensitive) {
      Logger.debug(`Resolved scheme '${requestedScheme}' to '${caseInsensitive}' (case-insensitive match)`);
      return { ok: true, schemeName: caseInsensitive };
    }

    const bestMatch = ParameterNormalizer.findBestMatch(requestedScheme, availableSchemes);
    let message = `❌ Scheme '${requestedScheme}' not found.`;
    message += '\n\nAvailable schemes:\n';
    for (const scheme of availableSchemes) {
      if (scheme === bestMatch) {
        message += `  • ${scheme} ← Did you mean this?\n`;
      } else {
        message += `  • ${scheme}\n`;
      }
    }

    return {
      ok: false,
      result: {
        content: [{ type: 'text', text: message }]
      }
    };
  }

  private static _hasArgument(args: string[], flag: string): boolean {
    return args.some(entry => {
      if (entry === flag) {
        return true;
      }
      if (entry.startsWith(`${flag}=`) || entry.startsWith(`${flag} `) || entry.startsWith(`${flag}:`)) {
        return true;
      }
      return false;
    });
  }

  private static async _createTemporaryResultBundlePath(prefix: string): Promise<string> {
    const root = join(tmpdir(), 'xcodemcp-test-results');
    await mkdir(root, { recursive: true });
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const bundlePath = join(root, `${prefix}-${uniqueSuffix}.xcresult`);
    try {
      await rm(bundlePath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors; the file will be overwritten by xcodebuild
    }
    return bundlePath;
  }

  private static simulatorPreferenceCache: {
    loaded: boolean;
    data: Record<string, { udid: string; name?: string; runtimeVersion?: string; updatedAt: number }>;
  } = { loaded: false, data: {} };

  private static _buildSimulatorPreferenceKey(platform: string, deviceType: string, osVersion: string | null): string {
    const normalizedPlatform = platform.toLowerCase().replace(/\s+/g, '-');
    const normalizedDevice = deviceType.toLowerCase().replace(/\s+/g, '-');
    const normalizedOs = osVersion ? osVersion.toLowerCase() : 'any';
    return `${normalizedPlatform}:${normalizedDevice}:${normalizedOs}`;
  }

  private static _getSimulatorPreferenceFile(): { dir: string; file: string } {
    const dir = join(homedir(), 'Library', 'Application Support', 'XcodeMCP');
    const file = join(dir, 'simulator-preferences.json');
    return { dir, file };
  }

  private static async _loadSimulatorPreferences(): Promise<Record<string, { udid: string; name?: string; runtimeVersion?: string; updatedAt: number }>> {
    if (this.simulatorPreferenceCache.loaded) {
      return this.simulatorPreferenceCache.data;
    }

    const { file } = this._getSimulatorPreferenceFile();
    try {
      const content = await readFile(file, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        this.simulatorPreferenceCache = {
          loaded: true,
          data: parsed as Record<string, { udid: string; name?: string; runtimeVersion?: string; updatedAt: number }>,
        };
        return this.simulatorPreferenceCache.data;
      }
    } catch {
      // Ignore missing or invalid preference files
    }

    this.simulatorPreferenceCache = { loaded: true, data: {} };
    return this.simulatorPreferenceCache.data;
  }

  private static async _rememberSimulatorSelection(
    key: string,
    value: { udid: string; name?: string; runtimeVersion?: string },
  ): Promise<void> {
    const preferences = await this._loadSimulatorPreferences();
    const entry: { udid: string; name?: string; runtimeVersion?: string; updatedAt: number } = {
      udid: value.udid,
      updatedAt: Date.now(),
    };
    if (value.name) {
      entry.name = value.name;
    }
    if (value.runtimeVersion) {
      entry.runtimeVersion = value.runtimeVersion;
    }
    preferences[key] = entry;

    const { dir, file } = this._getSimulatorPreferenceFile();
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(preferences, null, 2), 'utf8');
    this.simulatorPreferenceCache = { loaded: true, data: preferences };
  }

  private static _versionScore(version: string): number {
    const parts = version.split('.').map(part => parseInt(part, 10)).filter(n => !Number.isNaN(n));
    const [major = 0, minor = 0, patch = 0] = parts;
    return major * 10000 + minor * 100 + patch;
  }

  private static _runtimeMatchesRequested(runtime: string, requested: string): boolean {
    const normalizedRequested = requested.trim().toLowerCase();
    const normalizedRuntime = runtime.trim().toLowerCase();
    if (normalizedRuntime === normalizedRequested) {
      return true;
    }
    return normalizedRuntime.startsWith(`${normalizedRequested}.`);
  }

  private static _scoreSimulatorCandidate(
    candidate: { runtimeVersion: string | null; name: string; state: string },
    requestedVersion: string | null,
  ): number {
    const base = candidate.runtimeVersion ? this._versionScore(candidate.runtimeVersion) : 0;
    const idleBonus = candidate.state.toLowerCase() === 'booted' ? -50 : 10;
    const matchBonus = requestedVersion && candidate.runtimeVersion
      ? (this._runtimeMatchesRequested(candidate.runtimeVersion, requestedVersion) ? 100 : 0)
      : 0;
    const deviceBonus = candidate.name.toLowerCase().includes('pro') ? 1 : 0;
    return base + idleBonus + matchBonus + deviceBonus;
  }

  private static _extractRuntimeVersion(runtimeIdentifier: string): string | null {
    const match = runtimeIdentifier.match(/-(\d+)(?:-(\d+))?(?:-(\d+))?/);
    if (!match) {
      return null;
    }
    const major = match[1] ?? '0';
    const minor = match[2] ?? '0';
    const patch = match[3];
    const components = [major, minor, patch].filter((component): component is string => typeof component === 'string' && component.length > 0);
    return components.map(component => component.replace(/^0+/, '') || '0').join('.');
  }

  private static _platformForRuntime(runtimeIdentifier: string):
    | 'iOS Simulator'
    | 'watchOS Simulator'
    | 'tvOS Simulator'
    | 'visionOS Simulator'
    | null {
    if (runtimeIdentifier.includes('iOS')) {
      return 'iOS Simulator';
    }
    if (runtimeIdentifier.includes('watchOS')) {
      return 'watchOS Simulator';
    }
    if (runtimeIdentifier.includes('tvOS')) {
      return 'tvOS Simulator';
    }
    if (runtimeIdentifier.includes('visionOS')) {
      return 'visionOS Simulator';
    }
    return null;
  }

  private static async _getSimulatorInventory(): Promise<
    Array<{
      name: string;
      udid: string;
      platform: 'iOS Simulator' | 'watchOS Simulator' | 'tvOS Simulator' | 'visionOS Simulator';
      runtimeIdentifier: string;
      runtimeVersion: string | null;
      state: string;
      isAvailable: boolean;
    }>
  > {
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile('xcrun', ['simctl', 'list', 'devices', '--json'], (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      const parsed = JSON.parse(stdout) as {
        devices?: Record<string, Array<{ name: string; udid: string; isAvailable?: boolean; availability?: string; state?: string }>>;
      };

      const inventory: Array<{
        name: string;
        udid: string;
        platform: 'iOS Simulator' | 'watchOS Simulator' | 'tvOS Simulator' | 'visionOS Simulator';
        runtimeIdentifier: string;
        runtimeVersion: string | null;
        state: string;
        isAvailable: boolean;
      }> = [];

      for (const [runtimeIdentifier, devices] of Object.entries(parsed.devices ?? {})) {
        const platform = this._platformForRuntime(runtimeIdentifier);
        if (!platform) {
          continue;
        }

        const runtimeVersion = this._extractRuntimeVersion(runtimeIdentifier);

        for (const device of devices ?? []) {
          if (!device || typeof device.name !== 'string' || typeof device.udid !== 'string') {
            continue;
          }
          const isAvailable = device.isAvailable !== false && (!device.availability || !device.availability.includes('unavailable'));
          inventory.push({
            name: device.name,
            udid: device.udid,
            platform,
            runtimeIdentifier,
            runtimeVersion,
            state: typeof device.state === 'string' ? device.state : 'Unknown',
            isAvailable,
          });
        }
      }

      return inventory;
    } catch (error) {
      Logger.warn(`Failed to query simulator list: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private static _detectSimulatorCloneFailure(output: string): { matched: boolean; deviceName?: string } {
    if (!output || output.trim().length === 0) {
      return { matched: false };
    }

    const match = output.match(/Failed to clone device named '([^']+)'/);
    if (match && match[1]) {
      return { matched: true, deviceName: match[1] };
    }

    return { matched: false };
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

export default BuildTools;
