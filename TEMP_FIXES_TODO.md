# Critical Errors to Fix

## 1. **False Success on File Not Found**
- **Issue**: `xcode_open_project` returns "Project opened successfully" even when the file doesn't exist
- **Evidence**: Xcode shows alert "The file 'Transit.xcodeproj' doesn't exist" but tool reports success
- **Root Cause**: JXA `app.open()` doesn't throw an error when file doesn't exist - it just shows an alert
- **Fix Needed**: Add file existence validation before calling `app.open()`

## 2. **False Success After Clean → Build Sequence**
- **Issue**: After running `xcode_clean` followed immediately by `xcode_build_scheme`, the build reports instant success
- **Evidence**: User reported "BUILD SUCCESSFUL" appearing instantly after clean
- **Root Cause**: Build detection logic likely reading stale/cached log files instead of waiting for actual new build
- **Fix Needed**: Improve build completion detection to ensure we're reading from a genuinely new build

## 3. **Build Completion Detection Issues**
- **Issue**: `xcode_build_scheme` sometimes uses old log files instead of waiting for new builds
- **Evidence**: Instant "success" responses that should take 30+ seconds for complex projects
- **Root Cause**: The log file detection/parsing logic may be too eager to use existing logs
- **Fix Needed**: Better timestamp validation and build session tracking

## 4. **Path Existence Validation Missing**
- **Issue**: Tools accept any path without validating file existence first
- **Evidence**: Non-existent paths still attempt to execute and sometimes report false success
- **Fix Needed**: Add `fs.existsSync()` checks before any Xcode operations

## 5. **Error Detection from Xcode Alerts**
- **Issue**: When Xcode shows error alerts, the JXA script doesn't detect them as failures
- **Evidence**: Alert dialogs appear but success is still reported
- **Fix Needed**: Add error detection for common Xcode alert patterns

## Testing Protocol
- **Always test with**: `time (echo 'JSON_REQUEST' | node index.js)` 
- **Never use**: The MCP tools directly (they may use cached/older code)
- **Always verify**: Actual file paths exist before testing
- **Test sequences**: Clean → Build to catch false positives

These issues make the tool unreliable for CI/automation where false positives could mask real build failures.