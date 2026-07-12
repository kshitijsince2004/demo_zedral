exports.up = (pgm) => {
  pgm.addColumns(
    { schema: 'security', name: 'app_user' },
    {
      supertokens_user_id: { type: 'text', notNull: false },
    }
  );
  pgm.createIndex({ schema: 'security', name: 'app_user' }, 'supertokens_user_id');
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'security', name: 'app_user' }, 'supertokens_user_id');
  pgm.dropColumns({ schema: 'security', name: 'app_user' }, ['supertokens_user_id']);
};
