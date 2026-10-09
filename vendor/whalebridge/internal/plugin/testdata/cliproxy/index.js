// A plugin that signs in with a CLI of the vendor's, as the Grok plugin
// runs `grok login`: the link it hands on says the proxy the CLI was
// given, started with the host's environment and with a copy of it.
import { spawn } from "node:child_process"

function proxyOf(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", "process.stdout.write(process.env.HTTPS_PROXY || 'none')"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout.on("data", (b) => (out += b))
    child.on("close", () => resolve(out))
  })
}

export const CLIProxyPlugin = async () => ({
  auth: {
    provider: "cliproxy",
    methods: [
      {
        type: "oauth",
        label: "CLI",
        authorize: async () => {
          const inherited = await proxyOf(undefined)
          const copied = await proxyOf({ ...process.env })
          return {
            url: `https://cliproxy.invalid/?inherited=${encodeURIComponent(inherited)}&copied=${encodeURIComponent(copied)}`,
            instructions: "",
            method: "code",
            callback: async () => ({ type: "failed" }),
          }
        },
      },
    ],
  },
})
