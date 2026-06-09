const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) return;
    let content = fs.readFileSync(fullPath, 'utf8');
    for (const [search, replace] of Object.entries(replacements)) {
        content = content.split(search).join(replace);
    }
    fs.writeFileSync(fullPath, content);
}

// 1. reportRoutes.ts
replaceInFile('src/routes/reportRoutes.ts', {
    "ShiftHandoverService.getHandoverSummary()": "ShiftHandoverService.getHandoverSummary(req.query.shiftLogId as string)"
});

// 2. ExportService.ts
replaceInFile('src/services/ExportService.ts', {
    "this.auditService.logEvent(": "AuditTrailService.log(",
    "      'SYSTEM',": "      'audit.export_job',\n      scope,\n      'INSERT',\n      null,",
    "      { format, requestedBy: user }": "      { format, requestedBy: user },\n      1",
    "private auditService": "// private auditService"
});

// 3. overrideService.ts
replaceInFile('src/services/overrideService.ts', {
    "import { OverrideRequest, AuthUser } } from './authService';": "import { AuthUser } from './authService';\nexport interface OverrideRequest { field: string; reason: string; }",
    "import { OverrideRequest, AuthUser } from './authService';": "import { AuthUser } from './authService';\nexport interface OverrideRequest { field: string; reason: string; }"
});

// 4. shiftLogRoutes.ts
replaceInFile('src/routes/shiftLogRoutes.ts', {
    "log.process_id as string": "String(log.process_id)"
});

// 5. ChangeRequestService.ts
replaceInFile('src/services/ChangeRequestService.ts', {
    "oldRecord,": "oldRecord as Record<string, any> | null,",
    "{ ...oldRecord, ...changes },": "{ ...oldRecord, ...changes } as Record<string, any> | null,"
});
