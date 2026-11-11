function initializeReminderDatabase(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS plant_reminders (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL REFERENCES user_plants(instance_id) ON DELETE CASCADE,
    care_type TEXT NOT NULL CHECK (care_type IN ('watering', 'fertilizing')),
    repeat_interval INTEGER NOT NULL CHECK (repeat_interval > 0),
    repeat_unit TEXT NOT NULL CHECK (repeat_unit IN ('days', 'weeks')),
    local_time TEXT NOT NULL, time_zone TEXT NOT NULL,
    last_care_choice TEXT NOT NULL, last_care_date TEXT,
    anchor_date TEXT NOT NULL, next_due_date TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (instance_id, care_type)
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_user_due ON plant_reminders(user_id, next_due_date, local_time);`);
}
module.exports = { initializeReminderDatabase };
