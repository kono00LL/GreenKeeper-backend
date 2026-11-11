function createReminderRepository(db) {
  const fields = `r.id, r.instance_id AS instanceId, p.id AS plantId,
    COALESCE(up.custom_name, p.name_zh) AS displayName, r.care_type AS careType,
    r.repeat_interval AS interval, r.repeat_unit AS unit, r.local_time AS time,
    r.time_zone AS timeZone, r.last_care_choice AS lastCareChoice, r.last_care_date AS lastCareDate,
    r.anchor_date AS anchorDate, r.next_due_date AS nextDueDate, r.created_at AS createdAt, r.updated_at AS updatedAt`;
  const from = ' FROM plant_reminders r JOIN user_plants up ON up.instance_id = r.instance_id JOIN plants p ON p.id = up.plant_id ';
  const one = db.prepare('SELECT ' + fields + from + 'WHERE r.user_id = ? AND r.id = ?');
  return {
    list: (userId) => db.prepare('SELECT ' + fields + from + 'WHERE r.user_id = ? ORDER BY r.next_due_date, r.local_time, r.id').all(userId),
    find: (userId, id) => one.get(userId, id),
    ownsInstance: (userId, instanceId) => Boolean(db.prepare('SELECT 1 FROM user_plants WHERE user_id = ? AND instance_id = ?').get(userId, instanceId)),
    duplicate: (userId, instanceId, careType) => db.prepare('SELECT id FROM plant_reminders WHERE user_id = ? AND instance_id = ? AND care_type = ?').get(userId, instanceId, careType),
    save(userId, value, creating) {
      if (creating) {
        db.prepare(`INSERT INTO plant_reminders (id, user_id, instance_id, care_type, repeat_interval, repeat_unit, local_time, time_zone,
          last_care_choice, last_care_date, anchor_date, next_due_date, created_at, updated_at)
          VALUES (@id, @userId, @instanceId, @careType, @interval, @unit, @time, @timeZone, @lastCareChoice, @lastCareDate, @anchorDate, @nextDueDate, @createdAt, @updatedAt)`).run({ ...value, userId });
      } else {
        db.prepare(`UPDATE plant_reminders SET instance_id=@instanceId, care_type=@careType, repeat_interval=@interval,
          repeat_unit=@unit, local_time=@time, time_zone=@timeZone, last_care_choice=@lastCareChoice,
          last_care_date=@lastCareDate, anchor_date=@anchorDate, next_due_date=@nextDueDate, updated_at=@updatedAt
          WHERE id=@id AND user_id=@userId`).run({ ...value, userId });
      }
      return one.get(userId, value.id);
    },
    remove: (userId, id) => db.prepare('DELETE FROM plant_reminders WHERE user_id=? AND id=?').run(userId, id).changes > 0,
  };
}
module.exports = { createReminderRepository };
