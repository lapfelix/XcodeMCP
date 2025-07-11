import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
export class EnvironmentValidator {
    static validationResults = {
        overall: { valid: false, canOperateInDegradedMode: false, criticalFailures: [], nonCriticalFailures: [] }
    };
    /**
     * Validates the entire environment and returns detailed results
     */
    static async validateEnvironment() {
        const results = {
            os: await this.validateOS(),
            xcode: await this.validateXcode(),
            xclogparser: await this.validateXCLogParser(),
            osascript: await this.validateOSAScript(),
            permissions: await this.validatePermissions(),
            overall: { valid: false, canOperateInDegradedMode: false, criticalFailures: [], nonCriticalFailures: [] }
        };
        // Determine overall validity and degraded mode capability
        const criticalFailures = ['os', 'osascript'].filter(key => !results[key]?.valid);
        const nonCriticalFailures = ['xcode', 'xclogparser', 'permissions'].filter(key => !results[key]?.valid);
        results.overall = {
            valid: criticalFailures.length === 0 && nonCriticalFailures.length === 0,
            canOperateInDegradedMode: criticalFailures.length === 0,
            criticalFailures,
            nonCriticalFailures
        };
        this.validationResults = results;
        return results;
    }
    /**
     * Validates macOS environment
     */
    static async validateOS() {
        if (platform() !== 'darwin') {
            return {
                valid: false,
                message: 'XcodeMCP requires macOS to operate',
                recoveryInstructions: [
                    'This MCP server only works on macOS',
                    'Xcode and its automation features are macOS-exclusive',
                    'Consider using this server on a Mac or macOS virtual machine'
                ]
            };
        }
        return {
            valid: true,
            message: 'macOS environment detected',
            recoveryInstructions: []
        };
    }
    /**
     * Validates Xcode installation
     */
    static async validateXcode() {
        const possibleXcodePaths = [
            '/Applications/Xcode.app',
            '/Applications/Xcode-beta.app'
        ];
        // Also check for versioned Xcode installations
        try {
            const { readdirSync } = await import('fs');
            const appDir = readdirSync('/Applications');
            const versionedXcodes = appDir
                .filter(name => name.startsWith('Xcode-') && name.endsWith('.app'))
                .map(name => `/Applications/${name}`);
            possibleXcodePaths.push(...versionedXcodes);
        }
        catch (error) {
            // Ignore errors when scanning for versioned Xcodes
        }
        let xcodeFound = false;
        let xcodePath = null;
        for (const path of possibleXcodePaths) {
            if (existsSync(path)) {
                xcodeFound = true;
                xcodePath = path;
                break;
            }
        }
        if (!xcodeFound) {
            return {
                valid: false,
                message: 'Xcode not found in /Applications',
                recoveryInstructions: [
                    'Download and install Xcode from the Mac App Store',
                    'Ensure Xcode is installed in /Applications/Xcode.app',
                    'Launch Xcode once to complete installation and accept license',
                    'If using Xcode beta, ensure it is in /Applications/Xcode-beta.app'
                ]
            };
        }
        // Check if Xcode can be launched and get version
        try {
            const version = await this.getXcodeVersion(xcodePath);
            return {
                valid: true,
                message: `Xcode found at ${xcodePath} (version ${version})`,
                recoveryInstructions: []
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                valid: false,
                message: `Xcode found but appears to be corrupted or not properly installed: ${errorMessage}`,
                recoveryInstructions: [
                    'Try launching Xcode manually to complete setup',
                    'Accept the license agreement if prompted',
                    'Install additional components if requested',
                    'Restart Xcode if it hangs on first launch',
                    'Consider reinstalling Xcode if problems persist'
                ]
            };
        }
    }
    /**
     * Validates XCLogParser installation
     */
    static async validateXCLogParser() {
        try {
            // First check if xclogparser exists in PATH
            const whichResult = await this.executeCommand('which', ['xclogparser']);
            const xclogparserPath = whichResult.trim();
            // Try to get version using the 'version' subcommand
            let version;
            try {
                version = await this.executeCommand('xclogparser', ['version']);
            }
            catch (versionError) {
                // Some versions might use different command structure, try help as fallback
                try {
                    await this.executeCommand('xclogparser', ['--help']);
                    // If we get help output, xclogparser is working but version command might be different
                    version = 'Unknown version (tool is working)';
                }
                catch (helpError) {
                    throw new Error(`xclogparser found at ${xclogparserPath} but cannot execute: ${versionError.message}`);
                }
            }
            return {
                valid: true,
                message: `XCLogParser found (${version.trim()})`,
                recoveryInstructions: [],
                metadata: {
                    version: version.trim(),
                    path: xclogparserPath
                }
            };
        }
        catch (error) {
            // Add more detailed error information for debugging
            const errorDetails = [];
            let xclogparserLocation = null;
            // Check if it's a PATH issue
            try {
                const whichResult = await this.executeCommand('which', ['xclogparser']);
                xclogparserLocation = whichResult.trim();
                errorDetails.push(`xclogparser found at ${xclogparserLocation} but failed to execute`);
                errorDetails.push(`Error: ${error.message}`);
                // Check if it's a permission issue
                try {
                    await this.executeCommand('test', ['-x', xclogparserLocation]);
                }
                catch (permError) {
                    errorDetails.push(`Permission issue: ${xclogparserLocation} is not executable`);
                    errorDetails.push('Try: chmod +x ' + xclogparserLocation);
                }
            }
            catch (whichError) {
                errorDetails.push('xclogparser not found in PATH');
                errorDetails.push(`Current PATH: ${process.env.PATH}`);
                // Check common installation locations
                const commonPaths = [
                    '/usr/local/bin/xclogparser',
                    '/opt/homebrew/bin/xclogparser',
                    '/usr/bin/xclogparser',
                    '/opt/local/bin/xclogparser' // MacPorts
                ];
                for (const checkPath of commonPaths) {
                    try {
                        await this.executeCommand('test', ['-f', checkPath]);
                        xclogparserLocation = checkPath;
                        errorDetails.push(`Found at ${checkPath} but not in PATH`);
                        // Check if it's executable
                        try {
                            await this.executeCommand('test', ['-x', checkPath]);
                            errorDetails.push('Add to PATH: export PATH="$PATH:' + path.dirname(checkPath) + '"');
                        }
                        catch (execError) {
                            errorDetails.push(`File exists but not executable: chmod +x ${checkPath}`);
                        }
                        break;
                    }
                    catch (testError) {
                        // File doesn't exist at this path
                    }
                }
                if (!xclogparserLocation) {
                    // Check if Homebrew is installed and where it would put xclogparser
                    try {
                        const brewPrefix = await this.executeCommand('brew', ['--prefix']);
                        const brewPath = path.join(brewPrefix.trim(), 'bin/xclogparser');
                        errorDetails.push(`Homebrew detected at: ${brewPrefix.trim()}`);
                        errorDetails.push(`Expected xclogparser location: ${brewPath}`);
                    }
                    catch (brewError) {
                        // Homebrew not found or not working
                    }
                }
            }
            return {
                valid: false,
                message: 'XCLogParser not found or not executable',
                recoveryInstructions: [
                    'Install XCLogParser using Homebrew: brew install xclogparser',
                    'Or download from GitHub: https://github.com/MobileNativeFoundation/XCLogParser',
                    'Ensure xclogparser is in your PATH',
                    'Note: Build log parsing will be unavailable without XCLogParser',
                    '',
                    'Debugging information:',
                    ...errorDetails.map(detail => `  • ${detail}`)
                ],
                degradedMode: {
                    available: true,
                    limitations: ['Build logs cannot be parsed', 'Error details from builds will be limited']
                }
            };
        }
    }
    /**
     * Validates osascript availability
     */
    static async validateOSAScript() {
        try {
            const version = await this.executeCommand('osascript', ['-l', 'JavaScript', '-e', '"test"']);
            if (version.trim() === 'test') {
                return {
                    valid: true,
                    message: 'JavaScript for Automation (JXA) is available',
                    recoveryInstructions: []
                };
            }
            else {
                throw new Error('Unexpected output from osascript');
            }
        }
        catch (error) {
            return {
                valid: false,
                message: 'JavaScript for Automation (JXA) not available',
                recoveryInstructions: [
                    'Ensure you are running on macOS (osascript is a macOS system tool)',
                    'Check if JavaScript for Automation is enabled in System Preferences',
                    'Try running "osascript -l JavaScript -e \\"return \'test\'\\"" manually',
                    'This is a critical component - the server cannot function without it'
                ]
            };
        }
    }
    /**
     * Get the actual Xcode application path
     */
    static async getXcodePath() {
        try {
            // First try to get from xcode-select
            const developerDir = await this.executeCommand('xcode-select', ['-p']);
            const xcodeAppPath = developerDir.trim().replace('/Contents/Developer', '');
            // Verify this Xcode app exists
            await this.executeCommand('test', ['-d', xcodeAppPath]);
            return xcodeAppPath;
        }
        catch {
            // Fall back to searching /Applications for any Xcode app
            try {
                const result = await this.executeCommand('find', ['/Applications', '-name', 'Xcode*.app', '-type', 'd', '-maxdepth', '1']);
                const xcodePaths = result.trim().split('\n').filter(path => path.length > 0);
                if (xcodePaths.length > 0 && xcodePaths[0]) {
                    // Return the first Xcode found
                    return xcodePaths[0];
                }
            }
            catch {
                // Last resort - try the standard path
                return '/Applications/Xcode.app';
            }
        }
        return '/Applications/Xcode.app';
    }
    /**
     * Validates automation permissions
     */
    static async validatePermissions() {
        try {
            // Get the actual Xcode path first
            const xcodePath = await this.getXcodePath();
            // Try a simple Xcode automation command to test permissions using the actual path
            const result = await this.executeCommand('osascript', [
                '-l', 'JavaScript', '-e',
                `Application("${xcodePath}").version()`
            ]);
            if (result && result.trim()) {
                return {
                    valid: true,
                    message: 'Xcode automation permissions are working',
                    recoveryInstructions: []
                };
            }
            else {
                throw new Error('No version returned from Xcode');
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            if (errorMessage.includes('not allowed assistive access') ||
                errorMessage.includes('not authorized') ||
                errorMessage.includes('permission')) {
                return {
                    valid: false,
                    message: 'Automation permissions not granted',
                    recoveryInstructions: [
                        'Open System Preferences → Privacy & Security → Automation',
                        'Find your terminal application (Terminal, iTerm, VS Code, etc.)',
                        'Enable permission to control "Xcode"',
                        'You may need to restart your terminal after granting permission',
                        'If using VS Code, look for "Code" in the automation list'
                    ]
                };
            }
            else if (errorMessage.includes("application isn't running")) {
                return {
                    valid: false,
                    message: 'Cannot test permissions - Xcode not running',
                    recoveryInstructions: [
                        'Launch Xcode to test automation permissions',
                        'Permissions will be validated when Xcode operations are attempted',
                        'This is not critical for server startup'
                    ],
                    degradedMode: {
                        available: true,
                        limitations: ['Permission validation deferred until Xcode operations']
                    }
                };
            }
            else {
                const errorMsg = error instanceof Error ? error.message : String(error);
                return {
                    valid: false,
                    message: `Permission check failed: ${errorMsg}`,
                    recoveryInstructions: [
                        'Ensure Xcode is properly installed',
                        'Try launching Xcode manually first',
                        'Check System Preferences → Privacy & Security → Automation',
                        'Grant permission for your terminal to control Xcode'
                    ]
                };
            }
        }
    }
    /**
     * Gets Xcode version
     */
    static async getXcodeVersion(xcodePath) {
        const infoPlistPath = path.join(xcodePath, 'Contents/Info.plist');
        if (!existsSync(infoPlistPath)) {
            throw new Error('Info.plist not found');
        }
        try {
            const result = await this.executeCommand('defaults', [
                'read', infoPlistPath, 'CFBundleShortVersionString'
            ]);
            return result.trim();
        }
        catch (error) {
            // Fallback to plutil if defaults doesn't work
            try {
                const result = await this.executeCommand('plutil', [
                    '-extract', 'CFBundleShortVersionString', 'raw', infoPlistPath
                ]);
                return result.trim();
            }
            catch (fallbackError) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                throw new Error(`Cannot read Xcode version: ${fallbackErrorMessage}`);
            }
        }
    }
    /**
     * Executes a command and returns stdout
     */
    static async executeCommand(command, args = [], timeout = 5000) {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args);
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                process.kill();
                reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
            }, timeout);
            process.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            process.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            process.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout);
                }
                else {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr || 'No error details'}`));
                }
            });
            process.on('error', (error) => {
                clearTimeout(timer);
                reject(new Error(`Failed to start command: ${error.message}`));
            });
        });
    }
    /**
     * Generates a human-readable validation summary
     */
    static generateValidationSummary(results) {
        const summary = ['XcodeMCP Environment Validation Report', ''];
        // Overall status
        if (results.overall.valid) {
            summary.push('✅ All systems operational');
        }
        else if (results.overall.canOperateInDegradedMode) {
            summary.push('⚠️  Can operate with limitations');
        }
        else {
            summary.push('❌ Critical failures detected - server cannot operate');
        }
        summary.push('');
        // Component status
        Object.entries(results).forEach(([component, result]) => {
            if (component === 'overall' || !result)
                return;
            // Type guard to check if this is an EnvironmentValidationResult
            if ('valid' in result) {
                const validationResult = result;
                const status = validationResult.valid ? '✅' : '❌';
                summary.push(`${status} ${component.toUpperCase()}: ${validationResult.message || 'Status unknown'}`);
                if (!validationResult.valid && validationResult.recoveryInstructions && validationResult.recoveryInstructions.length > 0) {
                    summary.push('   Recovery instructions:');
                    validationResult.recoveryInstructions.forEach((instruction) => {
                        summary.push(`   • ${instruction}`);
                    });
                    summary.push('');
                }
            }
        });
        return summary.join('\n');
    }
    /**
     * Checks if the environment can operate in degraded mode
     */
    static canOperateInDegradedMode(results = null) {
        const validationResults = results || this.validationResults;
        return validationResults.overall?.canOperateInDegradedMode ?? false;
    }
    /**
     * Gets the list of features unavailable in current environment
     */
    static getUnavailableFeatures(results = null) {
        const validationResults = results || this.validationResults;
        const unavailable = [];
        if (!validationResults.xclogparser?.valid) {
            unavailable.push('Build log parsing and detailed error reporting');
        }
        if (!validationResults.xcode?.valid) {
            unavailable.push('All Xcode operations (build, test, run, debug)');
        }
        if (!validationResults.permissions?.valid) {
            unavailable.push('Xcode automation (may work after granting permissions)');
        }
        return unavailable;
    }
    /**
     * Gets the version from package.json
     */
    static getVersion() {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const packageJsonPath = path.join(__dirname, '../../package.json');
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
            return packageJson.version || 'unknown';
        }
        catch (error) {
            return 'unknown';
        }
    }
    /**
     * Creates a configuration health check report
     */
    static async createHealthCheckReport() {
        const results = await this.validateEnvironment();
        const version = this.getVersion();
        const report = [
            `XcodeMCP Configuration Health Check (v${version})`,
            '='.repeat(50),
            '',
            this.generateValidationSummary(results),
            ''
        ];
        if (!results.overall.valid) {
            report.push('IMMEDIATE ACTIONS REQUIRED:');
            results.overall.criticalFailures.forEach(component => {
                const result = results[component];
                if (result && 'valid' in result) {
                    const validationResult = result;
                    report.push(`\n${component.toUpperCase()} FAILURE:`);
                    validationResult.recoveryInstructions?.forEach((instruction) => {
                        report.push(`• ${instruction}`);
                    });
                }
            });
            if (results.overall.nonCriticalFailures.length > 0) {
                report.push('\nOPTIONAL IMPROVEMENTS:');
                results.overall.nonCriticalFailures.forEach(component => {
                    const result = results[component];
                    if (result && 'valid' in result) {
                        const validationResult = result;
                        report.push(`\n${component.toUpperCase()}:`);
                        validationResult.recoveryInstructions?.forEach((instruction) => {
                            report.push(`• ${instruction}`);
                        });
                    }
                });
            }
        }
        const unavailableFeatures = this.getUnavailableFeatures(results);
        if (unavailableFeatures.length > 0) {
            report.push('\nLIMITED FUNCTIONALITY:');
            unavailableFeatures.forEach(feature => {
                report.push(`• ${feature}`);
            });
        }
        return report.join('\n');
    }
}
//# sourceMappingURL=EnvironmentValidator.js.map