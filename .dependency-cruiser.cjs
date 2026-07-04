/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'platform-has-no-product-deps',
      severity: 'error',
      comment: 'The platform kernel is the corridor and must not import modules, connectors, server, or client code.',
      from: { path: '^packages/platform/src' },
      to: { path: '^packages/(modules|connectors|server|client)/' },
    },
    {
      name: 'connectors-do-not-import-core-modules',
      severity: 'error',
      comment: 'M1/Manifold connectors are edge-deployed and may import platform contracts only, not product modules or server code.',
      from: { path: '^packages/connectors/src' },
      to: { path: '^packages/(modules|server|client)/' },
    },
    {
      name: 'workspace-modules-are-independent',
      severity: 'error',
      comment: 'Workspace modules may not import another module package directly.',
      from: { path: '^packages/modules/([^/]+)/src' },
      to: {
        path: '^packages/modules/([^/]+)/src',
        pathNot: '^packages/modules/$1/src',
      },
    },
    {
      name: 'server-modules-are-independent',
      severity: 'error',
      comment: 'Server module adapters may not import another server module adapter directly.',
      from: { path: '^packages/server/src/modules/([^/]+)/' },
      to: {
        path: '^packages/server/src/modules/([^/]+)/',
        pathNot: '^packages/server/src/modules/$1/',
      },
    },
    {
      name: 'no-m2-m4-business-imports-from-m1-server',
      severity: 'error',
      comment: 'The M1 server must not reach into M2/M3/M4 business modules.',
      from: { path: '^packages/server/src' },
      to: { path: '^packages/(modules/(m2|m3|m4)|server/src/modules/(m2|m3|m4))' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|dist|coverage|tmp|packages/server/tmp',
    },
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
