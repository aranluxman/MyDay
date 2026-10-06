export function selectMedicines(medicines, search = '', sort = 'name') {
  const query = search.trim().toLocaleLowerCase();
  return medicines.filter((m) => m.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
    if (sort === 'newest') return (b.created_at || '').localeCompare(a.created_at || '') || a.name.localeCompare(b.name);
    if (sort === 'time') return (a.times?.[0] || '99:99').localeCompare(b.times?.[0] || '99:99') || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.created_at || '').localeCompare(b.created_at || '');
  });
}
