const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createImageStorage(directory) {
  return {
    async save(buffer, extension) {
      await fs.mkdir(directory, { recursive: true });
      const key = `${randomUUID()}.${extension}`;
      const filename = path.join(directory, key);
      const handle = await fs.open(filename, 'wx');
      try {
        await handle.writeFile(buffer);
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => {});
        await fs.unlink(filename).catch(() => {});
        throw error;
      }
      return { key, url: `/uploads/${key}` };
    },
  };
}

module.exports = { createImageStorage };
