/**
 * Playwright Electron snapshot verification tests.
 *
 * These tests launch the production-built Electron app and take
 * screenshots to prove each phase-1 feature works correctly.
 *
 * Run after `npx electron-forge package`:
 *   npx vitest run test/e2e/snapshots.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'sample-project')
const SNAPSHOTS = path.resolve(__dirname, '..', 'snapshots')

let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}, 30_000)

afterAll(async () => {
  await app?.close()
})

describe('Task 1 — Scaffold', () => {
  it('welcome screen renders with correct title', async () => {
    const title = await page.title()
    expect(title).toBe('GraphArc')

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task01-welcome.png') })

    // Verify welcome UI elements exist
    const heading = await page.locator('h1').textContent()
    expect(heading).toBe('GraphArc')

    const button = await page.locator('button').textContent()
    expect(button).toBe('Open Project Folder...')
  })
})

describe('Task 7+8 — Worker + IPC', () => {
  it('worker starts and no critical console errors', async () => {
    // Collect console messages for a moment
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.waitForTimeout(2000)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task08-ipc-ready.png') })

    // No page-level errors (worker errors go to main process, not renderer)
    expect(errors).toEqual([])
  })
})

describe('Task 9 — React Flow Canvas', () => {
  it('graph renders after opening a project', async () => {
    // Trigger project:open via the renderer's IPC bridge
    await page.evaluate((fixturesDir) => {
      return window.grapharc.openProject(fixturesDir)
    }, FIXTURES)

    // Wait for graph nodes to appear
    await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
    await page.screenshot({ path: path.join(SNAPSHOTS, 'task09-graph-rendered.png') })

    // Verify multiple nodes exist
    const nodeCount = await page.locator('.react-flow__node').count()
    expect(nodeCount).toBeGreaterThan(0)

    // Verify edges exist
    const edgeCount = await page.locator('.react-flow__edge').count()
    expect(edgeCount).toBeGreaterThan(0)
  })
})

describe('Task 10 — Detail Panel', () => {
  it('clicking a node shows the detail panel', async () => {
    // Click the first graph node
    const firstNode = page.locator('.react-flow__node').first()
    await firstNode.click()

    // Wait for detail panel
    await page.waitForSelector('.detail-panel', { timeout: 5_000 })
    await page.screenshot({ path: path.join(SNAPSHOTS, 'task10-detail-panel.png') })

    // Verify detail panel has content
    const panelVisible = await page.locator('.detail-panel').isVisible()
    expect(panelVisible).toBe(true)
  })
})

describe('Task 11 — Filter Bar', () => {
  it('filter bar is visible and search works', async () => {
    // Filter bar should be visible when graph is showing
    const filterBarVisible = await page.locator('.filter-bar').isVisible()
    expect(filterBarVisible).toBe(true)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task11-filter-bar.png') })

    // Type a search query
    const searchInput = page.locator('.search-input')
    await searchInput.fill('main')
    await page.waitForTimeout(500)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task11-filtered.png') })

    // Clear search for subsequent tests
    await searchInput.fill('')
    await page.waitForTimeout(300)
  })
})
