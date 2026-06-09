const fs = require('fs');

let content = fs.readFileSync('packages/server/src/services/processServices.ts', 'utf8');

// HRS
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_hrs'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_hrs', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);
content = content.replace(/return result\.entry_id;/g, "return entryId || result.entry_id;"); // Just to catch both

// PKL
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_pkl'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_pkl', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);

// CRM
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_crm'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_crm', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);

// SKP
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_skp'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_skp', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);

// RWD
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_rwd'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_rwd', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);

// CRS
content = content.replace(
  /const result = await trx\.insertInto\('txn\.prod_crs'\)\.values\(\{([\s\S]*?)\}\)\.returning\('entry_id'\)\.executeTakeFirstOrThrow\(\);/m,
  (match, p1) => {
    let fields = p1.trim().split(',\n').map(l => l.trim()).filter(l => !l.startsWith('shift_log_id:') && !l.startsWith('coil_no:'));
    return `const entryId = await upsertProcessEntry(trx, 'txn.prod_crs', shiftLogId, payload.coilNo, {\n        ${fields.join(',\n        ')}\n      }, userId);`;
  }
);

// PKL Chart (does not have coil_no, skip or implement differently if needed. For now, we skip chart upsert).
// ANN has ann_charge_coil, which is a batch, skip for now or we can implement differently.

fs.writeFileSync('packages/server/src/services/processServices.ts', content);
console.log('Done replacing!');
