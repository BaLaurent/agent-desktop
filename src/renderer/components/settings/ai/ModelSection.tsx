import { shortenModelName } from '../../../../shared/constants'
import { tint } from '../../../utils/colorMix'
import { SettingRow } from '../../shared/SettingRow'
import { SearchableModelPicker } from '../../shared/SearchableModelPicker'
import { ToggleRow } from './skills/ToggleRow'

export interface ModelOption {
  value: string
  label: string
}

export interface ModelSectionProps {
  model: string
  customModel: string
  customModels: string[]
  customModelContextLengths: Record<string, number>
  fetchedModels: ModelOption[]
  maxTurns: string
  maxThinkingTokens: string
  showThinking: string
  maxBudgetUsd: string
  compactModel: string
  titleModel: string
  onModelChange: (next: string) => void
  onCustomModelInputChange: (value: string) => void
  onSaveCustomModel: (value: string) => void
  onRemoveCustomModel: (value: string) => void
  onSetCustomModelContextLength: (modelId: string, lengthInK: number | null) => void
  onMaxTurnsChange: (value: string) => void
  onMaxThinkingTokensChange: (value: string) => void
  onShowThinkingChange: (value: string) => void
  onMaxBudgetUsdChange: (value: string) => void
  onCompactModelChange: (value: string) => void
  onTitleModelChange: (value: string) => void
}

/**
 * Model picker, custom-model editor, agentic limits,
 * and global compact/title model overrides.
 */
export function ModelSection(props: ModelSectionProps) {
  const {
    model,
    customModel,
    customModels,
    customModelContextLengths,
    fetchedModels,
    maxTurns,
    maxThinkingTokens,
    showThinking,
    maxBudgetUsd,
    compactModel,
    titleModel,
    onModelChange,
    onCustomModelInputChange,
    onSaveCustomModel,
    onRemoveCustomModel,
    onSetCustomModelContextLength,
    onMaxTurnsChange,
    onMaxThinkingTokensChange,
    onShowThinkingChange,
    onMaxBudgetUsdChange,
    onCompactModelChange,
    onTitleModelChange,
  } = props

  const isCustomModel = !!customModel
  const isCompactModelCustom = compactModel !== '' && !fetchedModels.some((o) => o.value === compactModel)
  const isTitleModelCustom = titleModel !== '' && !fetchedModels.some((o) => o.value === titleModel)

  return (
    <>
      <SettingRow label="Model" description="Claude model used for responses.">
        <div className="flex flex-col items-end gap-1">
          <SearchableModelPicker
            value={(isCustomModel || model === 'custom') ? 'custom' : model}
            options={fetchedModels}
            extraOptions={[
              ...customModels.map((m) => ({ value: m, label: shortenModelName(m) })),
              { value: 'custom', label: 'Other' },
            ]}
            onChange={onModelChange}
            buttonLabel="Model"
            ariaLabel="Select AI model"
          />
          {(isCustomModel || model === 'custom') && (
            <input
              type="text"
              value={customModel}
              onChange={(e) => onCustomModelInputChange(e.target.value)}
              onBlur={() => onSaveCustomModel(customModel)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSaveCustomModel(customModel) }}
              placeholder="model-id (saved on Enter/blur)"
              className="w-48 px-3 py-1.5 rounded text-xs border outline-none font-mono mobile:text-base"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: tint('--color-text-muted', 20),
              }}
              aria-label="Custom model ID"
            />
          )}
          {customModels.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {customModels.map((m) => {
                const persistedK = customModelContextLengths[m] ? customModelContextLengths[m] / 1000 : ''
                return (
                  <div
                    key={m}
                    className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-text-muted) 10%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span className="font-mono flex-1 truncate" title={m}>{shortenModelName(m)}</span>
                    <label className="flex items-center gap-1 text-[0.625rem] whitespace-nowrap">
                      ctx
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="auto"
                        defaultValue={persistedK}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          onSetCustomModelContextLength(m, v === '' ? null : Number(v))
                        }}
                        className="w-14 px-1 py-0.5 rounded border text-right"
                        style={{
                          backgroundColor: 'var(--color-bg)',
                          color: 'var(--color-text)',
                          borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)',
                        }}
                        aria-label={`Context window size for ${m} (thousands of tokens)`}
                        title="Context window size in thousands of tokens. Leave blank to auto-detect."
                      />
                      k
                    </label>
                    <button
                      onClick={() => onRemoveCustomModel(m)}
                      className="hover:opacity-70 leading-none text-sm"
                      aria-label={`Remove custom model ${m}`}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow label="Max Turns" description="Maximum agentic turns per request. 0 = unlimited.">
        <input
          type="number"
          min={0}
          value={maxTurns}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0)
            onMaxTurnsChange(String(v))
          }}
          className="w-20 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Maximum agentic turns"
        />
      </SettingRow>

      <SettingRow label="Max Thinking Tokens" description="Extended thinking budget. 0 = disabled (0-100000).">
        <input
          type="number"
          min={0}
          max={100000}
          step={1000}
          value={maxThinkingTokens}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100000, Number(e.target.value) || 0))
            onMaxThinkingTokensChange(String(v))
          }}
          className="w-24 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Maximum thinking tokens"
        />
      </SettingRow>

      <ToggleRow
        label="Show Reasoning"
        description="Display extended thinking blocks in assistant messages. Always persisted to DB; toggle controls rendering only."
        checked={showThinking === 'true'}
        ariaLabel="Toggle reasoning display"
        onChange={() => onShowThinkingChange(showThinking === 'true' ? 'false' : 'true')}
      />

      <SettingRow label="Max Budget (USD)" description="Cost limit per request. 0 = unlimited (0-10).">
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={maxBudgetUsd}
          onChange={(e) => {
            const v = Math.max(0, Math.min(10, Number(e.target.value) || 0))
            onMaxBudgetUsdChange(String(v))
          }}
          className="w-24 px-3 py-1.5 rounded text-sm border outline-none text-right mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Maximum budget in USD"
        />
      </SettingRow>

      <div
        className="flex flex-col gap-1.5 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Compact Model
        </label>
        <select
          value={isCompactModelCustom ? '__custom__' : compactModel}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__custom__') {
              onCompactModelChange(compactModel || '')
            } else {
              onCompactModelChange(val)
            }
          }}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Compact model"
        >
          <option value="">Auto (current model)</option>
          {fetchedModels.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
        {isCompactModelCustom && (
          <input
            type="text"
            value={compactModel}
            onChange={(e) => onCompactModelChange(e.target.value)}
            placeholder="model-id"
            className="px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Custom compact model"
          />
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Model used when running <code>/compact</code>. Auto = uses the conversation&apos;s active model.
        </span>
      </div>

      <div
        className="flex flex-col gap-1.5 py-3 border-b"
        style={{ borderColor: tint('--color-text-muted', 10) }}
      >
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Title Model
        </label>
        <select
          value={isTitleModelCustom ? '__custom__' : titleModel}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__custom__') {
              onTitleModelChange(titleModel || '')
            } else {
              onTitleModelChange(val)
            }
          }}
          className="px-3 py-1.5 rounded text-sm border outline-none mobile:text-base mobile:py-2"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
            borderColor: tint('--color-text-muted', 20),
          }}
          aria-label="Title model"
        >
          <option value="">Auto (current model)</option>
          {fetchedModels.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
        {isTitleModelCustom && (
          <input
            type="text"
            value={titleModel}
            onChange={(e) => onTitleModelChange(e.target.value)}
            placeholder="model-id"
            className="px-3 py-1.5 rounded text-sm border outline-none font-mono mobile:text-base"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              borderColor: tint('--color-text-muted', 20),
            }}
            aria-label="Custom title model"
          />
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Model used to auto-generate conversation titles. Auto = uses the conversation&apos;s active model.
        </span>
      </div>
    </>
  )
}
