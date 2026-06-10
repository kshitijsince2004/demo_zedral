import React from 'react';

export const TemplateImport: React.FC = () => {
  return (
    <div>
      <h2>Template Import</h2>
      <p>Upload a new DPR Excel template here.</p>
      <input type="file" accept=".xlsx" />
      <button>Import Template</button>
    </div>
  );
};
