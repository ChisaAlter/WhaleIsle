const fsPromises = require('fs/promises')

const originalWriteFile = fsPromises.writeFile
const retryableCodes = new Set(['EBUSY', 'EACCES', 'EPERM', 'UNKNOWN'])

fsPromises.writeFile = async (...args) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await originalWriteFile(...args)
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt >= 7) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
}

async function run() {
  if (process.platform === 'win32') {
    // The official NSIS decoder uses BCJ; 7za handles the complete staged directory.
    process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
    await require('./windows-directory-installer.cjs').installWindowsDirectoryInstaller()
  }
  require('electron-builder/cli.js')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
