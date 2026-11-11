const offsets = { today: 0, yesterday: 1, one_week_ago: 7, two_weeks_ago: 14, over_two_weeks: null, unknown: null };
class ReminderError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
const invalid = (message) => { throw new ReminderError(400, 'INVALID_REMINDER', message); };
function todayInZone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateSchedule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Invalid reminder');
  if (typeof input.instanceId !== 'string' || !input.instanceId) invalid('Plant instance is required');
  if (!['watering', 'fertilizing'].includes(input.careType)) invalid('Invalid care type');
  if (!['days', 'weeks'].includes(input.unit)) invalid('Invalid repeat unit');
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > (input.unit === 'weeks' ? 52 : 365)) invalid('Invalid repeat interval');
  if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) invalid('Invalid time');
  if (typeof input.timeZone !== 'string' || !input.timeZone) invalid('Time zone is required');
  try { todayInZone(input.timeZone); } catch { invalid('Invalid time zone'); }
  if (!Object.hasOwn(offsets, input.lastCareChoice)) invalid('Invalid last care choice');
  if (input.lastCareDate != null && !isDate(input.lastCareDate)) invalid('Invalid last care date');
}
function resolveSchedule(input, today, existing = null) {
  const days = input.interval * (input.unit === 'weeks' ? 7 : 1);
  let lastCareDate, anchorDate;
  if (existing) {
    lastCareDate = existing.lastCareDate;
    anchorDate = existing.anchorDate;
  } else {
    const offset = offsets[input.lastCareChoice];
    lastCareDate = offset === null ? null : (input.lastCareDate ?? addDays(today, -offset));
    if (lastCareDate && (!isDate(lastCareDate) || lastCareDate > today)) invalid('Last care date must not be in the future');
    anchorDate = lastCareDate ?? today;
  }
  return { lastCareChoice: input.lastCareChoice, lastCareDate, anchorDate, nextDueDate: addDays(anchorDate, days) };
}
module.exports = { ReminderError, validateSchedule, resolveSchedule, todayInZone, addDays };
