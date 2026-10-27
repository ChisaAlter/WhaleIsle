/** Shared, browser-local preference for the desktop directory chooser. */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/**
 * Create the preference shared by the Hero and sidebar directory flows.
 * @returns a persisted store handle; the in-app browser remains the default.
 */
export function createPickerPreferenceStore() {
  return defineStore({
    init: () => ({ useNative: false }),
    persist: 'dsh.directory-picker.v1',
    actions: {
      setUseNative: (draft, enabled: boolean) => { draft.useNative = enabled },
    },
  })
}
