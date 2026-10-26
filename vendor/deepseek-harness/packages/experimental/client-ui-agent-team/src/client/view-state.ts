/** Session-owned Project viewing state shared by the header panel and Team Sidebar. */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** Create one handle for both registered Team presentations. @returns shared view handle. */
export function createTeamViewStore() {
  return defineStore({
    init: () => ({
      floatingOpen: false,
      floatingVisited: false,
      scrollTop: 0,
      view: 'current' as 'current' | 'history',
      query: '',
      memberPage: 0,
      taskPage: 0,
      expandedTaskIds: [] as string[],
    }),
    actions: {
      setFloating: (state, open: boolean) => {
        state.floatingOpen = open
        if (open) state.floatingVisited = true
      },
      setScrollTop: (state, scrollTop: number) => { state.scrollTop = scrollTop },
      setView: (state, view: 'current' | 'history') => {
        state.view = view
        state.query = ''
        state.memberPage = 0
        state.taskPage = 0
      },
      setQuery: (state, query: string) => {
        state.query = query
        state.memberPage = 0
        state.taskPage = 0
      },
      setMemberPage: (state, page: number) => { state.memberPage = page },
      setTaskPage: (state, page: number) => { state.taskPage = page },
      setTaskExpanded: (state, taskId: string, expanded: boolean) => {
        state.expandedTaskIds = state.expandedTaskIds.filter(id => id !== taskId)
        if (expanded) state.expandedTaskIds.push(taskId)
      },
    },
  })
}
