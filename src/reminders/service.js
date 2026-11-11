const { randomUUID } = require('node:crypto');
const { ReminderError, validateSchedule, resolveSchedule, todayInZone } = require('./schedule');
function createReminderService(repository, now = () => new Date()) {
  const missing = () => { throw new ReminderError(404, 'REMINDER_NOT_FOUND', 'Reminder not found'); };
  function find(userId, id) { return repository.find(userId, id) || missing(); }
  function save(userId, body, id) {
    const existing = id ? find(userId, id) : null;
    const fields = ['instanceId', 'careType', 'interval', 'unit', 'time', 'timeZone', 'lastCareChoice', 'lastCareDate'];
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReminderError(400, 'INVALID_REMINDER', 'Invalid reminder');
    const input = { ...existing, ...Object.fromEntries(fields.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])) };
    validateSchedule(input);
    if (!repository.ownsInstance(userId, input.instanceId)) throw new ReminderError(404, 'PLANT_INSTANCE_NOT_FOUND', 'Plant instance not found');
    const duplicate = repository.duplicate(userId, input.instanceId, input.careType);
    if (duplicate && duplicate.id !== id) throw new ReminderError(409, 'REMINDER_EXISTS', 'Reminder already exists', { reminderId: duplicate.id });
    const timestamp = now();
    const preserve = existing && !Object.hasOwn(body, 'lastCareChoice') && !Object.hasOwn(body, 'lastCareDate');
    const schedule = resolveSchedule(input, todayInZone(input.timeZone, timestamp), preserve ? existing : null);
    return repository.save(userId, { ...input, ...schedule, id: id || randomUUID(), createdAt: existing?.createdAt || timestamp.toISOString(), updatedAt: timestamp.toISOString() }, !existing);
  }
  return {
    list: (userId) => repository.list(userId),
    create: (userId, body) => save(userId, body),
    update: (userId, id, body) => save(userId, body, id),
    complete(userId, id) {
      find(userId, id);
      return save(userId, { lastCareChoice: 'today', lastCareDate: null }, id);
    },
    remove(userId, id) { if (!repository.remove(userId, id)) missing(); return { removed: true }; },
  };
}
module.exports = { createReminderService };
