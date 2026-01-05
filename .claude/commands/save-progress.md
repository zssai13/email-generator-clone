---
description: Save session progress by updating CHANGELOG.md and ARCHITECTURE.md
allowed-tools: Read, Edit, Write, Glob, Grep
---

# Save Progress

Update project documentation to track session progress.

## Instructions

When this command is invoked, perform both of these actions:

### 1. Update CHANGELOG.md

Add a new dated section at the top (below the header) with:
- **Session Summary**: 1-2 sentence overview of what was accomplished
- **Added**: New files, features, or configurations created
- **Changed**: Modifications to existing files
- **Fixed**: Bug fixes or issue resolutions
- **Technical Notes**: Important implementation details for future sessions
- **Known Issues**: Any unresolved problems or TODOs
- **Current State**: Brief status of where things stand

### 2. Update ARCHITECTURE.md (if needed)

Only update if there were structural changes:
- New files or directories added
- New API routes created
- New dependencies added
- Configuration changes

### Format Example for CHANGELOG.md

```markdown
## [YYYY-MM-DD] - Brief Description

### Session Summary
One or two sentences describing the main accomplishment.

### Added
- `file.js` - Description of what it does

### Changed
- `existing-file.js` - What was modified and why

### Technical Notes
- Important detail for future sessions

### Current State
- **Status**: What state is the project in
- **Next Steps**: What should be done next (if applicable)
```

## Usage

Call this command at the end of any development session to ensure continuity for the next Claude session.
