import fs from 'fs'
import path from 'path'

describe('Exploration notebook height', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'components/stages/ExplorationStage.tsx'),
    'utf8',
  )
  it('drops the cramped fixed 520px height', () => {
    expect(src).not.toContain('h-[520px]')
  })
  it('uses the taller responsive height', () => {
    expect(src).toContain('h-[min(80vh,900px)]')
  })
})
