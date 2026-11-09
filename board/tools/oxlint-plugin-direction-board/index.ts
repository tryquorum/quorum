import { definePlugin } from '@oxlint/plugins'
import codeBudget from './rules/code-budget.ts'
import noLiveDataPath from './rules/no-live-data-path.ts'
import noHardcodedOrigin from './rules/no-hardcoded-origin.ts'
import noDirectFetch from './rules/no-direct-fetch.ts'
import noRawStyle from './rules/no-raw-style.ts'

export default definePlugin({ meta: { name: 'direction-board' }, rules: {
  'code-budget': codeBudget,
  'no-live-data-path': noLiveDataPath,
  'no-hardcoded-origin': noHardcodedOrigin,
  'no-direct-fetch': noDirectFetch,
  'no-raw-style': noRawStyle,
} })
