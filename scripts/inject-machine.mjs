import fs from 'fs';
import path from 'path';

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const p = path.join(dir, file);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) {
      let c = fs.readFileSync(p, 'utf8');
      
      // We want to add `machine: machineCode` to apiClient.post and apiClient.patch payload bodies.
      // E.g. apiClient.post('/url', { param: 1 }) -> apiClient.post('/url', { param: 1, machine: machineCode })
      // E.g. apiClient.post('/url', {}) -> apiClient.post('/url', { machine: machineCode })
      // Only for /6hi/ URLs.
      
      // Let's do a simple replace on the file
      let modified = c.replace(/apiClient\.post(\s*<[^>]+>)?\(\s*`?\/6hi\/([^,]+)`?,\s*\{([^}]*)\}\s*\)/g, (m, typeParams, url, body) => {
        if (body.includes('machine')) return m;
        return `apiClient.post${typeParams || ''}(\`/6hi/${url}\`, { ${body.trim() ? body.trim() + ', ' : ''}machine: machineCode })`;
      });
      
      modified = modified.replace(/apiClient\.patch(\s*<[^>]+>)?\(\s*`?\/6hi\/([^,]+)`?,\s*\{([^}]*)\}\s*\)/g, (m, typeParams, url, body) => {
        if (body.includes('machine')) return m;
        return `apiClient.patch${typeParams || ''}(\`/6hi/${url}\`, { ${body.trim() ? body.trim() + ', ' : ''}machine: machineCode })`;
      });
      
      // Also for '/6hi/...' literals without template string
      modified = modified.replace(/apiClient\.post(\s*<[^>]+>)?\(\s*'\/6hi\/([^']+)',\s*\{([^}]*)\}\s*\)/g, (m, typeParams, url, body) => {
        if (body.includes('machine')) return m;
        return `apiClient.post${typeParams || ''}('/6hi/${url}', { ${body.trim() ? body.trim() + ', ' : ''}machine: machineCode })`;
      });
      
      modified = modified.replace(/apiClient\.patch(\s*<[^>]+>)?\(\s*'\/6hi\/([^']+)',\s*\{([^}]*)\}\s*\)/g, (m, typeParams, url, body) => {
        if (body.includes('machine')) return m;
        return `apiClient.patch${typeParams || ''}('/6hi/${url}', { ${body.trim() ? body.trim() + ', ' : ''}machine: machineCode })`;
      });

      if (c !== modified) {
        fs.writeFileSync(p, modified);
        console.log('Modified ' + p);
      }
    }
  });
}

walk('packages/client/src/pages/sixHi');
walk('packages/client/src/components/sixHi');
walk('packages/client/src/store');
