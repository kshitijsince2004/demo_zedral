const fs = require('fs');
const path = require('path');

exports.up = (pgm) => {
  const sqlFilePath = path.join(__dirname, '../../../doc/m1/M1_schema.sql');
  const sql = fs.readFileSync(sqlFilePath, 'utf8');
  pgm.sql(sql);
};

exports.down = (pgm) => {
  // Teardown schemas
  pgm.dropSchema('audit', { cascade: true });
  pgm.dropSchema('security', { cascade: true });
  pgm.dropSchema('planning', { cascade: true });
  pgm.dropSchema('txn', { cascade: true });
  pgm.dropSchema('coil', { cascade: true });
  pgm.dropSchema('master', { cascade: true });
};
