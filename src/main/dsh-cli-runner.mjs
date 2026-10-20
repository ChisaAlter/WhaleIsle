/** Run the installed dsh CLI with the desktop's Node and pnpm distributions. */
import { pathToFileURL } from 'node:url'

const [cli, pnpm, ...args] = process.argv.slice(2)
if (!cli || !pnpm) throw new Error('Desktop CLI requires the dsh and pnpm entry paths')
process.argv = [process.execPath, cli, ...args]
const { runCli } = await import(pathToFileURL(cli).href)
await runCli({ packageManager: { command: process.execPath, args: [pnpm], env: {} } })
