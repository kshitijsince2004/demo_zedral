const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) return;
    let content = fs.readFileSync(fullPath, 'utf8');
    for (const [search, replace] of Object.entries(replacements)) {
        content = content.split(search).join(replace);
    }
    // Also support regex
    content = content.replace(/requireRole\('ADMIN'\)/g, "requireRole([UserRole.ADMIN])");
    content = content.replace(/requireRole\(\['ADMIN'\]\)/g, "requireRole([UserRole.ADMIN])");
    content = content.replace(/requireRole\('SUPERVISOR'\)/g, "requireRole([UserRole.SUPERVISOR])");
    fs.writeFileSync(fullPath, content);
}

// 1. masterDataRoutes.ts
replaceInFile('src/routes/masterDataRoutes.ts', {
    "const data = await MasterDataService.getAll(req.tableName, includeInactive);": "const includeInactive = req.query.includeInactive === 'true';\n    const data = await MasterDataService.getAll(req.tableName, includeInactive);"
});

// 2. reportRoutes.ts
replaceInFile('src/routes/reportRoutes.ts', {
    "import { getDb } from '../db';": "import { db } from '../db';",
    "const db = getDb();": "",
    "const summary = await ShiftHandoverService.getHandoverSummary();": "const summary = await ShiftHandoverService.getHandoverSummary(req.query.shiftLogId as string);"
});

// 3. shiftLogRoutes.ts
replaceInFile('src/routes/shiftLogRoutes.ts', {
    "ShiftLogService.approve(req.params.id, req.user?.id as string)": "ShiftLogService.approve(req.params.id, req.user?.id as number)"
});

// 4. DashboardService.ts
replaceInFile('src/services/DashboardService.ts', {
    "import Database from 'better-sqlite3';": "import { db } from '../db';",
    "const db = new Database('m1.db');": ""
});

// 5. ExportService.ts
replaceInFile('src/services/ExportService.ts', {
    "AuditTrailService.logEvent(": "AuditTrailService.log("
});

// 6. overrideService.ts
replaceInFile('src/services/overrideService.ts', {
    "import { OverrideRequest } from './authService';": ""
});

// 7. ChangeRequestService.ts
replaceInFile('src/services/ChangeRequestService.ts', {
    "oldValues: existingData,": "oldValues: existingData || null,",
    "newValues: payload.newData,": "newValues: payload.newData || null,"
});

// 8. Fix bigint issue in shiftLogService.ts and ShiftHandoverService.ts
replaceInFile('src/services/shiftLogService.ts', {
    "BigInt(": "String(",
    "bigint": "string"
});
replaceInFile('src/services/ShiftHandoverService.ts', {
    "BigInt(": "String(",
    "bigint": "string"
});

// Fix req.user.id (number) passed as string
const filesToFixUserId = [
    'src/routes/changeRequestRoutes.ts',
    'src/routes/crewRoutes.ts',
    'src/routes/defectRoutes.ts',
    'src/routes/entriesRoutes.ts',
    'src/routes/importRoutes.ts',
    'src/routes/stoppageRoutes.ts'
];

for (const file of filesToFixUserId) {
    replaceInFile(file, {
        "req.user?.id as string": "String(req.user?.id)",
        "req.user!.id": "String(req.user!.id)"
    });
}
