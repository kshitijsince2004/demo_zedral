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

// 1. authMiddleware.ts
replaceInFile('src/middleware/authMiddleware.ts', {
    "allowedRoles.includes(role)": "allowedRoles.includes(role as UserRole)",
    "req.user.roles.includes(UserRole.ADMIN)": "req.user.roles.includes(UserRole.ADMIN as string)",
    "req.user.roles.includes(UserRole.SUPERVISOR)": "req.user.roles.includes(UserRole.SUPERVISOR as string)",
    "req.user.roles.includes(UserRole.PLANT_HEAD)": "req.user.roles.includes(UserRole.PLANT_HEAD as string)",
    "req.user.roles.includes(UserRole.OPERATOR)": "req.user.roles.includes(UserRole.OPERATOR as string)"
});

// 2. Add UserRole import
const filesWithUserRole = [
    'src/routes/changeRequestRoutes.ts',
    'src/routes/importRoutes.ts',
    'src/routes/masterDataRoutes.ts'
];
for (const f of filesWithUserRole) {
    replaceInFile(f, {
        "import { Router } from 'express';": "import { Router } from 'express';\nimport { UserRole } from '@m1/shared-validation';"
    });
}

// 3. reportRoutes.ts
replaceInFile('src/routes/reportRoutes.ts', {
    "getDb().": "db.",
    "getDb()": "db"
});

// 4. shiftLogRoutes.ts
replaceInFile('src/routes/shiftLogRoutes.ts', {
    "req.user?.id as string": "String(req.user?.id)"
});

// 5. ChangeRequestService.ts
replaceInFile('src/services/ChangeRequestService.ts', {
    "oldValues: existingData || null": "oldValues: (existingData || null) as any",
    "newValues: payload.newData || null": "newValues: (payload.newData || null) as any"
});

// 6. DashboardService.ts
replaceInFile('src/services/DashboardService.ts', {
    "db: Database.Database": "db: any",
    "db?: Database.Database": "db?: any"
});

// 7. overrideService.ts
replaceInFile('src/services/overrideService.ts', {
    "export interface OverrideRequest": "interface OverrideRequest"
});
