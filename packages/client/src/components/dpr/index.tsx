import React from 'react';

export const MonthSetup: React.FC = () => {
  return (
    <div>
      <h2>Month Setup</h2>
      <p>Configure defaults for the month (Targets, Production Rates, etc.).</p>
    </div>
  );
};

export const DailyEntryGrid: React.FC = () => {
  return (
    <div>
      <h2>Daily Entry Grid</h2>
      <p>Review auto-sourced values and input manual values for the day.</p>
    </div>
  );
};

export const DelayLog: React.FC = () => {
  return (
    <div>
      <h2>Delay Log</h2>
      <p>Enter shift delays, agency, and reasons.</p>
    </div>
  );
};

export const DprExportControls: React.FC = () => {
  return (
    <div>
      <h2>DPR Export Controls</h2>
      <button>Export Current Month to Excel</button>
      <button>Start New Month</button>
    </div>
  );
};
