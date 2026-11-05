export const PanelIcon = ({ name }: { name: 'search' | 'pin' | 'refresh' | 'plus' | 'close' | 'branch' }) => {
  const paths = {
    search: 'M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
    pin: 'M16 3l5 5-4 1-4 5-1 4-3-3-6 6 6-6-3-3 4-1 5-4z',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    branch: 'M6 7v10M9 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M18 8v2a5 5 0 0 1-5 5H6',
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
};
