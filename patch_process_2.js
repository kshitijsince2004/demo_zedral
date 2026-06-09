const fs = require('fs');

let content = fs.readFileSync('packages/server/src/services/processServices.ts', 'utf8');

// Fix `result.entry_id` references to just `entryId`
content = content.replace(/result\.entry_id/g, 'entryId');
// And `return entryId || entryId;` is redundant, change to `return entryId;`
content = content.replace(/return entryId \|\| entryId;/g, 'return entryId;');

fs.writeFileSync('packages/server/src/services/processServices.ts', content);
console.log('Fixed result.entry_id');
