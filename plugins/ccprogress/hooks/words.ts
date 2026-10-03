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
}

// The plan's own language decides; it is what the person and Claude are speaking.
export function wordsFor(isCjk: boolean): Words {
  return isCjk ? ZH : EN
}
