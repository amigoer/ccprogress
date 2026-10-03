export type Words = {
  allDone: string
  viewSteps: string
  hideSteps: string
  dismiss: string
  clear: string
  empty: string
  cleared: string
  stepsDone: (done: number, total: number) => string
  planOf: (total: number) => string
  doneToast: (total: number, goal: string, duration: string) => string
  stuckToast: (title: string, duration: string) => string
  overviewTitle: (count: number) => string
  overviewEmpty: string
  thisSession: string
  allDoneOf: (total: number) => string
  ago: (ms: number) => string
}

const EN: Words = {
  allDone: 'All done',
  viewSteps: 'View steps',
  hideSteps: 'Hide steps',
  dismiss: 'Dismiss',
  clear: 'Clear',
  empty: 'No progress reported yet. It appears once Claude starts a multi-step task.',
  cleared: 'Progress cleared.',
  stepsDone: (done, total) => `${done}/${total} steps done`,
  planOf: total => `Plan: ${total} steps`,
  doneToast: (total, goal, duration) => `All ${total} steps done${goal ? ` · ${goal}` : ''} (${duration})`,
  stuckToast: (title, duration) => `"${title}" has been running for ${duration}; it may be stuck`,
  overviewTitle: count => `${count} ${count === 1 ? 'session' : 'sessions'} with a plan in the last 24 hours:`,
  overviewEmpty: 'No session reported a plan in the last 24 hours.',
  thisSession: 'this session',
  allDoneOf: total => `all ${total} steps done`,
  ago: ms => (ms < 60_000 ? 'just now' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 3_600_000)}h ago`),
}

const ZH: Words = {
  allDone: '全部完成',
  viewSteps: '查看步骤',
  hideSteps: '收起',
  dismiss: '关闭',
  clear: '清空',
  empty: '还没有上报进度。Claude 开始多步骤任务后会显示在这里。',
  cleared: '进度已清空。',
  stepsDone: (done, total) => `已完成 ${done}/${total} 步`,
  planOf: total => `计划 ${total} 步`,
  doneToast: (total, goal, duration) => `全部完成${goal ? ` · ${goal}` : ''}（${total} 步，用时 ${duration}）`,
  stuckToast: (title, duration) => `「${title}」已经进行了 ${duration}，可能卡住了`,
  overviewTitle: count => `最近 24 小时有 ${count} 个会话上报了计划：`,
  overviewEmpty: '最近 24 小时没有会话上报计划。',
  thisSession: '当前会话',
  allDoneOf: total => `全部完成（${total} 步）`,
  ago: ms => (ms < 60_000 ? '刚刚' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)} 分钟前` : `${Math.floor(ms / 3_600_000)} 小时前`),
}

export type Language = 'auto' | 'en' | 'zh'

let preferred: Language = 'auto'

// Set once per load from the plugin's options.
export function setLanguage(language: Language) {
  preferred = language
}

// A language the person picked wins; otherwise the plan's own language decides,
// since it is what the person and Claude are speaking.
export function wordsFor(isCjk: boolean): Words {
  if (preferred === 'en') return EN
  if (preferred === 'zh') return ZH
  return isCjk ? ZH : EN
}
