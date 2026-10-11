export function blankMedicineForm() {
  return {
    name: '', dose_amount: '1', dose_unit: 'tablet', dose_other: '', strength: '', route: '', instructions: '',
    times: ['08:00'], frequency: 'daily', days_of_week: [],
    start_date: '', end_date: '', with_food: false, note: '', color: '#2563a8', photo_path: null,
    stock_quantity: '', refill_threshold: '', pharmacy_contact_id: '', prescriber_contact_id: '',
  };
}

export function meaningfulMedicineDraft(form) {
  if (!form) return false;
  return Object.entries(blankMedicineForm()).some(([key, value]) => {
    let entered = form[key] ?? value;
    if (typeof entered === 'string') entered = entered.trim();
    if (key === 'dose_amount') entered = String(entered);
    return JSON.stringify(entered) !== JSON.stringify(value);
  });
}
