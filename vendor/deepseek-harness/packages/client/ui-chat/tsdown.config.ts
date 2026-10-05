import { clientBundle } from '../tsdown.client.ts'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-chat', ['lib/types/index.js'])
const stylesheet = fileURLToPath(new URL('./src/client/chat/ChatView.module.css', import.meta.url)).replaceAll('\\', '/')
const whaleImages = [
  { url: './running-whale-girl.webp', mime: 'image/webp' },
  { url: './running-whale-girl-still.png', mime: 'image/png' },
] as const

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'chat-whale-image',
    async transform(code: string, id: string) {
      if (id.replaceAll('\\', '/') !== `\0dsh-css:${stylesheet}.mjs`) return null
      let compiled = code
      for (const { url, mime } of whaleImages) {
        const file = fileURLToPath(new URL(`./src/client/chat/${url.slice(2)}`, import.meta.url))
        this.addWatchFile(file)
        const image = await readFile(file)
        compiled = compiled.replaceAll(url, `data:${mime};base64,${image.toString('base64')}`)
      }
      return { code: compiled, map: null }
    },
  }],
}))) satisfies typeof bundle
