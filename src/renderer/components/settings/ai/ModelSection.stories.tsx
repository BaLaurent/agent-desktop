import type { Meta, StoryObj } from '@storybook/react'
import { ModelSection, type ModelSectionProps } from './ModelSection'

const noop = () => {}

const SAMPLE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5' },
]

const baseArgs: ModelSectionProps = {
  model: 'claude-sonnet-4-6',
  customModel: '',
  customModels: [],
  customModelContextLengths: {},
  fetchedModels: SAMPLE_MODELS,
  maxTurns: '10',
  maxThinkingTokens: '0',
  showThinking: 'false',
  maxBudgetUsd: '0',
  compactModel: '',
  titleModel: '',
  onModelChange: noop,
  onCustomModelInputChange: noop,
  onSaveCustomModel: noop,
  onRemoveCustomModel: noop,
  onSetCustomModelContextLength: noop,
  onMaxTurnsChange: noop,
  onMaxThinkingTokensChange: noop,
  onShowThinkingChange: noop,
  onMaxBudgetUsdChange: noop,
  onCompactModelChange: noop,
  onTitleModelChange: noop,
}

const meta: Meta<typeof ModelSection> = {
  title: 'Settings/AI/ModelSection',
  component: ModelSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof ModelSection>

export const Default: Story = {}

export const WithCustomModels: Story = {
  args: {
    customModels: ['my-org/custom-llama-70b', 'my-org/custom-mixtral-8x22b'],
    customModelContextLengths: { 'my-org/custom-llama-70b': 32000 },
  },
}

export const PiBackend: Story = {
  args: {
    maxThinkingTokens: '8000',
    maxBudgetUsd: '2',
    compactModel: 'claude-haiku-3-5',
    titleModel: 'claude-haiku-3-5',
  },
}
