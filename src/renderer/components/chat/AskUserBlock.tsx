import { useState } from 'react'
import type { StreamPart, AskUserQuestion } from '../../../shared/types'

type AskUserPart = Extract<StreamPart, { type: 'ask_user' }>

interface AskUserBlockProps {
  askUser: AskUserPart
}

export function AskUserBlock({ askUser }: AskUserBlockProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const handleSelect = (question: AskUserQuestion, value: string) => {
    if (question.multiSelect) {
      const current = answers[question.header] || ''
      const selected = current ? current.split(',') : []
      const idx = selected.indexOf(value)
      if (idx >= 0) {
        selected.splice(idx, 1)
      } else {
        selected.push(value)
      }
      setAnswers({ ...answers, [question.header]: selected.join(',') })
    } else {
      setAnswers({ ...answers, [question.header]: value })
    }
  }

  const handleOtherInput = (header: string, value: string) => {
    setAnswers({ ...answers, [header]: value })
  }

  const handleSubmit = () => {
    setSubmitted(true)
    window.agent.messages.respondToApproval(askUser.requestId, { answers })
  }

  if (submitted) {
    return (
      <div className="my-2 rounded-md px-3 py-2 text-xs status-block-primary">
        <div className="font-semibold mb-1 text-primary">
          {'\u2705'} Answers submitted
        </div>
        {Object.entries(answers).map(([header, value]) => (
          <div key={header} className="mt-0.5 text-muted">
            <span className="font-semibold">{header}:</span> {value}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="my-2 rounded-md px-3 py-3 text-sm status-block-primary"
      role="form"
      aria-label="User questions requiring answers"
    >
      {askUser.questions.map((q) => (
        <div key={q.header} className="mb-3 last:mb-0" role="group" aria-labelledby={`question-${q.header}`}>
          <div id={`question-${q.header}`} className="font-medium mb-1 text-body">
            {q.question}
          </div>
          <div className="text-xs mb-1 font-semibold text-primary">
            {q.header}
          </div>
          <div className="space-y-1">
            {q.options.map((opt) => {
              const isSelected = q.multiSelect
                ? (answers[q.header] || '').split(',').includes(opt.label)
                : answers[q.header] === opt.label
              return (
                <label
                  key={opt.label}
                  className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1 transition-colors ${
                    isSelected ? 'bg-primary-tint' : ''
                  }`}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={q.header}
                    checked={isSelected}
                    onChange={() => handleSelect(q, opt.label)}
                    className="mt-0.5"
                    aria-label={opt.label}
                  />
                  <div>
                    <div className="font-medium text-xs">{opt.label}</div>
                    {opt.description && (
                      <div className="text-xs text-muted">
                        {opt.description}
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
          {/* Other (free-text) option */}
          <div className="mt-1 px-2">
            <input
              type="text"
              placeholder="Other..."
              className="w-full text-xs px-2 py-1 rounded border bg-base border-muted text-body"
              onBlur={(e) => {
                if (e.target.value) handleOtherInput(q.header, e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const target = e.target as HTMLInputElement
                  if (target.value) handleOtherInput(q.header, target.value)
                }
              }}
              aria-label="Other answer option"
            />
          </div>
        </div>
      ))}

      <button
        onClick={handleSubmit}
        className="mt-2 px-3 py-1 rounded text-xs font-medium transition-colors hover:opacity-90 bg-primary text-contrast"
        aria-label="Submit answers"
      >
        Submit
      </button>
    </div>
  )
}
