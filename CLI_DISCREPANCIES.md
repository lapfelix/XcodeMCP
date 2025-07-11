# CLI Parameter Naming Discrepancies

## Summary
Found multiple inconsistencies in CLI parameter naming conventions after fixing the main xcresult-path bug.

## Issues Found

### 1. Schema Property Naming Inconsistencies

**Problem**: Some tools use camelCase in schema instead of snake_case
- `xcode_open_file`: Uses `filePath` and `lineNumber` (should be `file_path` and `line_number`)
- `xcode_test`: Uses `commandLineArguments` (should be `command_line_arguments`)

**Current Behavior**:
```bash
xcodecontrol open-file --filePath file.swift --lineNumber 10  # Works
xcodecontrol open-file --file-path file.swift --line-number 10  # Error: unknown option
```

**Expected Behavior**: All parameters should follow kebab-case in CLI:
```bash
xcodecontrol open-file --file-path file.swift --line-number 10
```

### 2. Usage Instructions Still Reference Old Format

**Location**: `src/tools/XCResultTools.ts` - UI element help text
```
--hierarchy-json-path <value>  ... (the full version saved by xcresult_get_ui_hierarchy)
```

**Problem**: References `xcresult_get_ui_hierarchy` (underscore) instead of `xcresult-get-ui-hierarchy` (CLI command)

**Location**: Find XCResults output 
```
💡 Usage:
  • View results: xcresult_browse "<path>"
  • Get console: xcresult_browser_get_console "<path>" <test-id>
```

**Problem**: Shows underscore format instead of dash format for CLI commands

### 3. Mixed Parameter Conventions

**Current State**:
- Most tools: `xcresult_path` → `--xcresult-path` ✅
- `xcode_open_file`: `filePath` → `--filePath` ❌ 
- `xcode_test`: `commandLineArguments` → `--commandLineArguments` ❌

## Affected Commands

1. **open-file**: `--filePath`, `--lineNumber`
2. **test**: `--commandLineArguments`  
3. **run**: `--commandLineArguments`
4. **set-active-scheme**: `--schemeName`
5. **debug**: `--skipBuilding`
6. **xcresult-get-ui-element**: Help text references `xcresult_get_ui_hierarchy`
7. **xcresult-export-attachment**: Help text references `xcresult_list_attachments`
8. **find-xcresults**: Output usage references `xcresult_browse`, `xcresult_browser_get_console`

## Root Cause

1. **Schema inconsistency**: Some tools use camelCase properties instead of snake_case
2. **Help text inconsistency**: References internal tool names instead of CLI command names
3. **Missing standardization**: No enforcement of snake_case in schema definitions

## Fix Strategy

1. **Standardize schema properties** to snake_case:
   - `filePath` → `file_path`
   - `lineNumber` → `line_number` 
   - `commandLineArguments` → `command_line_arguments`

2. **Update help text** to reference CLI command names:
   - `xcresult_get_ui_hierarchy` → `xcresult-get-ui-hierarchy`
   - `xcresult_browse` → `xcresult-browse`

3. **Update all help text references** to use CLI command names:
   - `xcresult_get_ui_hierarchy` → `xcresult-get-ui-hierarchy`
   - `xcresult_list_attachments` → `xcresult-list-attachments` 
   - `xcresult_browse` → `xcresult-browse`
   - `xcresult_browser_get_console` → `xcresult-browser-get-console`

4. **Add validation** to prevent future camelCase in schemas

5. **Update integration tests** to cover all parameter formats

## Impact

- **Breaking change**: CLI users using `--filePath` will need to use `--file-path`
- **Consistency improvement**: All CLI parameters will follow kebab-case convention
- **User experience**: More predictable parameter naming across all commands