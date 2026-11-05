import { runZapLab } from './zap-lab.mjs'
if (process.env.RUN_ZAP_REAL !== 'true' || process.argv.length !== 2) throw new Error('Use RUN_ZAP_REAL=true; custom targets/arguments are unsupported')
const report = await runZapLab()
console.log(JSON.stringify({ passed: report.passed, stage: report.failedStage ?? 'complete', alerts: report.alerts?.length ?? 0, blocking: report.blocking?.length ?? 0, cleanup: report.cleanup }))
process.exitCode = report.passed ? 0 : 1
