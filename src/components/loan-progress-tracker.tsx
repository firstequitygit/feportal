import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type PipelineStage, PIPELINE_STAGES } from '@/lib/types'

const PROGRESS_STAGES = PIPELINE_STAGES.slice(0, 5) // New Application → Submitted

function formatStage(stage: PipelineStage | string | null): string {
  if (!stage) return 'Unknown'
  return stage.split(' /')[0].trim()
}

interface Props {
  stage: PipelineStage | string | null
  fundedMessage?: string
}

export function LoanProgressTracker({
  stage,
  fundedMessage = 'This loan has been funded.',
}: Props) {
  const isFunded = stage === 'Closed'
  const progressIndex = isFunded
    ? PROGRESS_STAGES.length
    : (stage ? PIPELINE_STAGES.indexOf(stage as PipelineStage) : -1)

  // 0–100 for the mobile bar
  const percent = isFunded
    ? 100
    : progressIndex >= 0
      ? Math.round((progressIndex / (PROGRESS_STAGES.length - 1)) * 100)
      : 0

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle className="text-base">Loan Progress</CardTitle></CardHeader>
      <CardContent>
        {isFunded && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <span className="text-green-600 text-lg">🎉</span>
            <p className="text-sm font-semibold text-green-700">{fundedMessage}</p>
          </div>
        )}

        {/* Mobile view: compact label + thin bar */}
        <div className="md:hidden">
          <div className="flex items-baseline justify-between mb-2 gap-3">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {isFunded
                ? 'Funded'
                : progressIndex >= 0
                  ? formatStage(stage)
                  : 'Not started'}
            </p>
            <p className="text-xs text-gray-500 whitespace-nowrap">
              {isFunded
                ? `Stage ${PROGRESS_STAGES.length} of ${PROGRESS_STAGES.length}`
                : progressIndex >= 0
                  ? `Stage ${progressIndex + 1} of ${PROGRESS_STAGES.length}`
                  : ''}
            </p>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${isFunded ? 'bg-green-500' : 'bg-primary'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Desktop view: horizontal stepper */}
        <div className="hidden md:flex items-start px-4">
          {PROGRESS_STAGES.map((s, index) => {
            const isLast = index === PROGRESS_STAGES.length - 1
            const isDone = index < progressIndex
            const isCurrent = !isFunded && index === progressIndex
            return (
              <div key={s} className={`flex items-start ${isLast ? '' : 'flex-1'}`}>
                <div className="flex flex-col items-center w-8 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                    ${isDone ? 'bg-green-500 border-green-500 text-white' :
                      isCurrent ? 'bg-primary border-primary text-white' :
                                  'bg-white border-gray-300 text-gray-400'}`}>
                    {isDone ? '✓' : index + 1}
                  </div>
                  <p className={`text-xs mt-1.5 text-center leading-tight w-20
                    ${isCurrent ? 'text-primary font-semibold' :
                      isDone    ? 'text-green-600' : 'text-gray-400'}`}>
                    {formatStage(s)}
                  </p>
                </div>
                {!isLast && (
                  <div className={`flex-1 h-0.5 mt-4 mx-1 ${index < progressIndex ? 'bg-green-400' : 'bg-gray-200'}`} />
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
